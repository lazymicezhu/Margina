import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
let mf, db;
const hash = value => createHash('sha256').update(value).digest('hex');
const password = 'Synthetic-password-123';
const email = 'reader@example.test';
const sessionCookie = response => response.headers.getSetCookie().find(c => c.startsWith('__Host-margina_session='))?.split(';')[0];
async function call(path, method='GET', body, cookie='', extra={}) {
  return mf.dispatchFetch(`https://reader.test${path}`, { method, redirect:'manual', headers: { Origin:'https://reader.test', 'CF-Connecting-IP':'192.0.2.1', Cookie:cookie, ...(body === undefined ? {} : { 'Content-Type':'application/json' }), ...extra }, ...(body === undefined ? {} : { body:JSON.stringify(body) }) });
}
async function verify(address=email, mode='register') {
  const start = await call(`/api/auth/start?mode=${mode}`);
  assert.equal(start.status,302);
  const state = start.headers.getSetCookie().find(c=>c.startsWith('__Host-margina_verify=')).split(';')[0];
  const callback = await call(start.headers.get('location'),'GET',undefined,state, { 'X-Test-Verified-Email':address });
  assert.equal(callback.status,302,await callback.clone().text());
  assert.equal(callback.headers.get('location'),'/?auth=setup');
  return callback.headers.getSetCookie().find(c=>c.startsWith('__Host-margina_setup=')).split(';')[0];
}
before(async () => {
  // Email proof is injected only in this isolated harness; production uses signed Access JWTs.
  const result = await build({ stdin:{contents:`import worker from './server/worker.mjs'; import { passwordRequest } from './server/password-auth.mjs'; export default { async fetch(r,e) { if(new URL(r.url).pathname==='/api/private/auth/verify' && r.headers.has('X-Test-Verified-Email')) { try { return await passwordRequest(r,e,async()=>({id:'access-'+r.headers.get('X-Test-Verified-Email'),email:r.headers.get('X-Test-Verified-Email')})); } catch(error) { return Response.json({error:error.message},{status:error.status||500}); } } return worker.fetch(r,e); } };`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',logLevel:'silent' });
  mf = new Miniflare(convertV4MiniflareOptions({ name:'password-tests',modules:true,script:result.outputFiles[0].text,compatibilityDate:'2026-10-22',d1Databases:['DB'],r2Buckets:['FILES'],bindings:{ ENVIRONMENT:'production', PASSWORD_AUTH:'true', AUTH_PEPPER:'synthetic-test-pepper-not-a-real-secret-123456',ADMIN_EMAILS:'admin@example.test' } }));
  db = await mf.getD1Database('DB');
  for(const sql of (await readFile('server/schema.sql','utf8')).replace(/--[^\n]*/g,'').split(';').filter(s=>s.trim())) await db.prepare(sql).run();
});
after(async()=>{await mf?.dispose();});
test('registration requires email proof and binds it to the initiating browser',async()=>{
  const missing = await call('/api/auth/password','POST',{email,password}); assert.equal(missing.status,401);
  const start = await call('/api/auth/start');
  const invalid = await call(start.headers.get('location'),'GET',undefined,'',{'X-Test-Verified-Email':email}); assert.equal(invalid.status,400);
  assert.equal((await call('/api/private/auth/verify?state=forged')).status,400);
  assert.equal((await call('/api/auth/password','POST',{password},'',{Origin:'https://evil.test'})).status,403);
});
test('verified registration creates a normal account with hashed password and persistent secure session',async()=>{
  const proof = await verify();
  const status = await (await call('/api/session','GET',undefined,proof)).json(); assert.equal(status.setupEmail,email); assert.equal(status.user,null);
  assert.equal((await call('/api/auth/password','POST',{password:'short'},proof)).status,400);
  const saved = await call('/api/auth/password','POST',{password,email:'admin@example.test'},proof);
  assert.equal(saved.status,200,await saved.clone().text());
  const user = (await saved.json()).user; assert.equal(user.email,email); assert.equal(user.admin,false);
  const set = saved.headers.getSetCookie().find(c=>c.startsWith('__Host-margina_session='));
  assert.match(set,/HttpOnly/); assert.match(set,/Secure/); assert.match(set,/SameSite=Lax/); assert.match(set,/Max-Age=2592000/);
  const logged = await (await call('/api/session','GET',undefined,sessionCookie(saved))).json(); assert.equal(logged.user.id,user.id);
  const credential = await db.prepare('SELECT * FROM account_credentials WHERE email=?').bind(email).first(); assert.notEqual(credential.password_hash,password); assert.equal(credential.password_hash.length,64);
  assert.equal((await call('/api/auth/password','POST',{password},proof)).status,401);
  assert.equal((await call('/api/account/admin/users','GET',undefined,sessionCookie(saved))).status,403);
});
test('password login rejects forged identities and logout revokes the session',async()=>{
  assert.equal((await call('/api/account/shelf','GET',undefined,'CF_Authorization=forged',{'Cf-Access-Authenticated-User-Email':email})).status,401);
  assert.equal((await call('/api/auth/login','POST',{email,password:'incorrect-password'})).status,401);
  const login = await call('/api/auth/login','POST',{email:email.toUpperCase(),password}); assert.equal(login.status,200);
  const cookie = sessionCookie(login);
  assert.equal((await call('/api/account/shelf','GET',undefined,cookie)).status,200);
  assert.equal((await call('/api/account/shelf','GET',undefined,cookie,{'X-Margina-User':'another-user'})).status,401);
  assert.equal((await call('/api/auth/logout','POST',{},cookie)).status,200);
  assert.equal((await call('/api/account/shelf','GET',undefined,cookie)).status,401);
});
test('email-verified reset revokes old sessions, and registration cannot overwrite a password',async()=>{
  const login = await call('/api/auth/login','POST',{email,password}); const oldCookie = sessionCookie(login);
  const registration = await verify();
  assert.equal((await call('/api/auth/password','POST',{password:'Should-not-replace-123'},registration)).status,409);
  const reset = await verify(email,'reset');
  const saved = await call('/api/auth/password','POST',{password:'New-synthetic-password-456'},reset); assert.equal(saved.status,200);
  assert.equal((await call('/api/account/shelf','GET',undefined,oldCookie)).status,401);
  assert.equal((await call('/api/auth/login','POST',{email,password})).status,401);
  assert.equal((await call('/api/auth/login','POST',{email,password:'New-synthetic-password-456'})).status,200);
  assert.equal((await call('/api/auth/password','POST',{password},registration)).status,401);
});
test('existing verified email keeps its old owner ID and admin identity',async()=>{
  await db.prepare('INSERT INTO users VALUES(?,?,?,?)').bind('legacy-admin','admin@example.test',1,1).run();
  const proof = await verify('admin@example.test');
  const saved = await call('/api/auth/password','POST',{password},proof); assert.equal(saved.status,200,await saved.clone().text());
  const user = (await saved.json()).user; assert.equal(user.id,'legacy-admin'); assert.equal(user.admin,true);
  assert.equal((await call('/api/account/admin/users','GET',undefined,sessionCookie(saved))).status,200);
  await db.prepare('UPDATE account_sessions SET expires=0 WHERE user_id=?').bind(user.id).run();
  assert.equal((await call('/api/account/admin/users','GET',undefined,sessionCookie(saved))).status,401);
});
test('repeated password guesses are rate limited without disclosing account existence',async()=>{
  await db.prepare('DELETE FROM account_auth_limits').run();
  for(let i=0;i<10;i++) assert.equal((await call('/api/auth/login','POST',{email:'unknown@example.test',password})).status,401);
  assert.equal((await call('/api/auth/login','POST',{email:'unknown@example.test',password})).status,429);
  const limits = (await db.prepare('SELECT * FROM account_auth_limits').all()).results; assert.ok(limits.every(row=>!row.key.includes('@')));
});
