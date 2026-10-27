const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function moduleFrom(file, dependencies, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022} }).outputText,
    {exports,require:key=>dependencies[key],atob,Blob,Uint8Array,console,...globals});
  return exports;
}
// Same generated 4×6 JPEG used by the Worker integration fixture.
const source = fs.readFileSync('tests/covers.test.mjs','utf8');
const jpeg = Buffer.from(source.match(/const jpeg = Buffer.from\('([^']+)'/)[1],'base64');
const cover = moduleFrom('src/cover.ts',{});
const paper = {id:'a'.repeat(64),contentHash:'b'.repeat(64),bilingual:true,visibility:'public',coverVersion:'v1'};
function setup(status=200) {
  const stored = new Map(), calls=[], uploads=[];
  class ApiError extends Error { constructor(message,status){super(message);this.status=status;} }
  class FileReader { readAsDataURL(blob){blob.arrayBuffer().then(bytes=>{this.result=`data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;this.onload();});} }
  const client=moduleFrom('src/cover-client.ts',{
    './cover':cover,
    './cloud-api':{ApiError,api:async(url,options)=>{uploads.push({url,options});return{paper:{...paper,coverVersion:'saved'}};}},
    './pdf':{loadPdfCover(){throw Error('Unexpected PDF request');}},
    './shelf-lock':{shelfHeaders:()=>({'X-Shelf-Unlock':'test-only-unlock'})},
    './storage':{setting:async(key,value)=>value===undefined?stored.get(key):stored.set(key,value)},
  },{FileReader,fetch:async(url,options)=>{calls.push({url,options});return new Response(status===200?jpeg:null,{status,headers:{'Content-Type':'image/jpeg'}});}});
  return {client,calls,uploads};
}
test('a fresh viewer fetches only the JPEG; repeat views use the versioned image cache',async()=>{
  const s=setup();const signal=new AbortController().signal;
  const image=await s.client.storedCover(paper,undefined,undefined,signal);
  assert.ok(image.startsWith('data:image/jpeg;base64,'));
  assert.equal(s.calls.length,1);assert.match(s.calls[0].url,/\/cover\?v=v1$/);
  assert.equal(await s.client.storedCover(paper,undefined,undefined,signal),image);assert.equal(s.calls.length,1);
  await s.client.storedCover({...paper,coverVersion:'v2'},undefined,undefined,signal);assert.equal(s.calls.length,2);
});
test('private cover requests retain unlock headers; denied requests never fall back to PDF',async()=>{
  const s=setup(403);
  await assert.rejects(s.client.storedCover({...paper,visibility:'private',privateOwner:'owner'},'owner',undefined,new AbortController().signal));
  assert.match(s.calls[0].url,/\/api\/account\/files\//);
  assert.equal(s.calls[0].options.headers['X-Shelf-Unlock'],'test-only-unlock');
});
test('a missing cover does not cause guest/non-owner PDF downloads',async()=>{
  for(const owner of [undefined,'reader']){
    const s=setup(404);assert.equal(await s.client.storedCover({...paper,coverVersion:undefined},owner,undefined,new AbortController().signal),'');
    assert.equal(s.calls.length,1);assert.equal(s.uploads.length,0);
  }
});
test('legacy owner can persist an existing local JPEG without reparsing or re-encoding PDF',async()=>{
  const s=setup(404);const image=`data:image/jpeg;base64,${jpeg.toString('base64')}`;
  assert.equal(await s.client.storedCover({...paper,coverVersion:undefined,canUpdateCover:true},'owner',image,new AbortController().signal),image);
  assert.equal(s.uploads.length,1);assert.equal(s.uploads[0].options.headers['X-Cover-Pdf'],paper.contentHash);
  assert.equal(s.uploads[0].options.headers['X-Cover-Crop'],'zh');
  assert.deepEqual(Buffer.from(await s.uploads[0].options.body.arrayBuffer()),jpeg);
});
test('bundle cover validation rejects wrong binding, dimensions and non-JPEG payloads',()=>{
  const c={mime:'image/jpeg',page:1,crop:'zh',pdfSha256:paper.contentHash,width:4,height:6,data:jpeg.toString('base64')};
  assert.equal(cover.validateCover(c,paper.contentHash),c);
  for(const patch of [{pdfSha256:paper.id},{width:5},{page:2},{mime:'image/svg+xml'},{data:Buffer.from('<svg/>').toString('base64')}])assert.throws(()=>cover.validateCover({...c,...patch},paper.contentHash));
});
