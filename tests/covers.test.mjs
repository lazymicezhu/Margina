import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAGAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD2iiiisTU//9k=', 'base64');
const id = n => n.toString(16).padStart(64, '0');
let db, worker, env, alice, bob, failPut = false, removeDuringPut = false;
const objects = new Map();
const accessed = [];
function statement(sql, args = []) { return {
  bind: (...values) => statement(sql, values),
  first: async () => db.prepare(sql).get(...args) || null,
  all: async () => ({ results: db.prepare(sql).all(...args) }),
  run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...args).changes) } }),
}; }
async function request(path, { method = 'GET', cookie, body, headers = {} } = {}) {
  return worker.fetch(new Request(`http://localhost${path}`, { method,
    headers: { ...(method !== 'GET' ? { Origin: 'http://localhost' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body }), env);
}
const put = (n, cookie = bob, bytes = jpeg, headers = {}) => request(`/api/account/files/${id(n)}/cover`, { method:'PUT', cookie, body:bytes,
  headers:{'Content-Type':'image/jpeg','X-Cover-Pdf':id(n),'X-Cover-Crop':'full',...headers} });
before(async () => {
  db=new DatabaseSync(':memory:'); db.exec(await readFile('server/schema.sql','utf8'));
  db.exec(await readFile('server/migrations/0005-paper-covers.sql','utf8'));
  const bundled=await build({entryPoints:['server/worker.mjs'],bundle:true,write:false,format:'esm',platform:'browser'});
  worker=(await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)).default;
  env={ENVIRONMENT:'local',LOCAL_DEV_AUTH:'true',DB:{prepare:statement},FILES:{
    async put(key,body){if(failPut)throw Error('Transient object error');objects.set(key,Buffer.from(await new Response(body).arrayBuffer()));if(removeDuringPut)db.prepare('UPDATE papers SET removed=1 WHERE id=?').run(id(4));},
    async get(key){accessed.push(key);const bytes=objects.get(key);return bytes?{body:bytes,size:bytes.length,httpEtag:'test'}:null;},
    async delete(key){objects.delete(key);},
  }};
  for(const name of ['alice','bob']){
    const r=await request('/api/dev/login',{method:'POST',body:JSON.stringify({name}),headers:{'Content-Type':'application/json'}});
    if(name==='alice')alice=r.headers.get('set-cookie').split(';')[0];else bob=r.headers.get('set-cookie').split(';')[0];
  }
  for(let n=1;n<=5;n++)db.prepare('INSERT INTO papers(id,title,file_name,size,pages,pdf_key,owner,created,updated,visibility) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id(n),`Book ${n}`,'test.pdf',100,1,`pdf/${n}`,'local-bob',1,1,n===2?'private':'public');
});
after(()=>db?.close());
test('owner saves one separate JPEG; guests load only the image, with conditional revalidation',async()=>{
  const r=await put(1);assert.equal(r.status,200,await r.clone().text());const paper=(await r.json()).paper;assert.ok(paper.coverVersion);
  accessed.length=0;
  const image=await request(`/api/papers/${id(1)}/cover`);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/jpeg');assert.deepEqual(Buffer.from(await image.arrayBuffer()),jpeg);
  assert.ok(accessed.every(key=>key.startsWith('covers/')));
  const cached=await request(`/api/papers/${id(1)}/cover`,{headers:{'If-None-Match':image.headers.get('etag')}});assert.equal(cached.status,304);
  assert.equal((await put(1)).status,200);assert.equal(objects.size,1); // Backfill is idempotent.
});
test('private cover access, folder locks, publication boundaries and source binding are enforced',async()=>{
  assert.equal((await put(2,'')).status,401);
  assert.equal((await put(2)).status,200);
  assert.equal((await request(`/api/papers/${id(2)}/cover`)).status,404);
  const privateImage=await request(`/api/account/files/${id(2)}/cover`,{cookie:bob});assert.equal(privateImage.status,200);assert.equal(privateImage.headers.get('cache-control'),'private, no-store');
  db.prepare('INSERT INTO shelf_folders(id,user_id,name,password_hash,created,updated) VALUES(?,?,?,?,?,?)').run('lock','local-bob','Locked','hash',1,1);
  db.prepare('INSERT INTO shelf_items(user_id,book_id,folder_id) VALUES(?,?,?)').run('local-bob',id(2),'lock');
  assert.equal((await request(`/api/account/files/${id(2)}/cover`,{cookie:bob})).status,423);
  assert.equal((await put(2)).status,423);
  assert.equal((await put(3,bob,jpeg,{'X-Cover-Pdf':id(99)})).status,400);
  assert.equal((await put(3,bob,jpeg,{'X-Cover-Crop':'zh'})).status,400);
  assert.equal((await put(3,bob,Buffer.from('<svg/>'))).status,400);
  assert.equal((await put(3,bob,Buffer.alloc(300*1024+1))).status,413);
  db.prepare('UPDATE papers SET owner=? WHERE id=?').run('local-alice',id(3));
  assert.equal((await put(3)).status,403);
});
test('failed writes and withdrawal races do not publish dangling cover pointers or reservations',async()=>{
  failPut=true;assert.equal((await put(4)).status,503);failPut=false;
  assert.equal(db.prepare('SELECT count(*) AS n FROM storage_allocations WHERE object_key LIKE ?').get(`covers/${id(4)}/%`).n,0);
  removeDuringPut=true;assert.equal((await put(4)).status,409);removeDuringPut=false;
  assert.equal(db.prepare('SELECT count(*) AS n FROM paper_covers WHERE book_id=?').get(id(4)).n,0);
  assert.equal([...objects.keys()].some(key=>key.startsWith(`covers/${id(4)}/`)),false);
});
test('bundle imports extract the Chinese cover and deletion cleans both image objects and accounting',async()=>{
  const cover={mime:'image/jpeg',page:1,crop:'zh',pdfSha256:id(5),width:4,height:6,data:jpeg.toString('base64')};
  const bundle={format:'yuejian-babeldoc-v1',pdfSha256:id(5),title:'Bundle',author:'Author',pageCount:1,segments:[],glossary:{},cover};
  const upload=()=>request(`/api/account/papers/${id(5)}/bundle`,{method:'PUT',cookie:bob,body:JSON.stringify(bundle),headers:{'Content-Type':'application/json','X-Public-Upload':'confirmed'}});
  assert.equal((await upload()).status,200);
  const version=db.prepare('SELECT version FROM paper_covers WHERE book_id=?').get(id(5)).version;
  assert.equal((await request(`/api/papers/${id(5)}/cover`)).status,200);
  assert.equal((await upload()).status,200);
  assert.notEqual(db.prepare('SELECT version FROM paper_covers WHERE book_id=?').get(id(5)).version,version);
  assert.equal([...objects.keys()].filter(key=>key.startsWith(`covers/${id(5)}/`)).length,1);
  assert.equal((await request(`/api/account/admin/papers/${id(5)}`,{method:'DELETE',cookie:alice})).status,200);
  assert.equal([...objects.keys()].some(key=>key.includes(id(5))),false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM paper_covers WHERE book_id=?').get(id(5)).n,0);
  assert.equal((await request(`/api/papers/${id(5)}/cover`)).status,404);
});
