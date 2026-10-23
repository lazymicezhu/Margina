import { check, readJson } from './validation.mjs';
import { rememberUser } from './admin.mjs';
const enc = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const digest = async value => hex(await crypto.subtle.digest('SHA-256', enc.encode(value)));
const cookies = { session: '__Host-margina_session', state: '__Host-margina_verify', grant: '__Host-margina_setup' };
const cookieValue = (request, key) => request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(`${cookies[key]}=`))?.slice(cookies[key].length + 1) || '';
const cookie = (key, value, seconds) => `${cookies[key]}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
const enabled = env => env.PASSWORD_AUTH === 'true' && typeof env.AUTH_PEPPER === 'string' && env.AUTH_PEPPER.length >= 32;
export const passwordAuthEnabled = enabled;
function response(data, status = 200, setCookies = [], location) {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  for (const item of setCookies) headers.append('Set-Cookie', item);
  if (location) { headers.set('Location', location); return new Response(null, { status, headers }); }
  headers.set('Content-Type', 'application/json'); return new Response(JSON.stringify(data), { status, headers });
}
const equal = (a, b) => { if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false; let difference = 0; for (let i=0;i<a.length;i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i); return difference === 0; };
const role = (id, email, env) => ({ id, email, admin: (env.ADMIN_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).includes(email.toLowerCase()), local: false });
function validPassword(password) { check(typeof password === 'string' && password.length >= 10 && password.length <= 128, '密码须为 10–128 位'); }
async function hashPassword(password, salt, env) {
  // The secret pepper is separate from D1; Workers limits each PBKDF2 call to 100k.
  const pepper = await crypto.subtle.importKey('raw', enc.encode(env.AUTH_PEPPER), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const input = await crypto.subtle.sign('HMAC', pepper, enc.encode(password));
  const key = await crypto.subtle.importKey('raw', input, 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256));
}
async function limit(env, key, maximum, windowMs) {
  const now = Date.now();
  const row = await env.DB.prepare(`INSERT INTO account_auth_limits(key,attempts,expires) VALUES(?,1,?)
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires<=? THEN 1 ELSE attempts+1 END,
    expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END RETURNING attempts`)
    .bind(await digest(key), now+windowMs, now, now).first();
  check(row.attempts <= maximum, '尝试过于频繁，请稍后再试', 429);
}
async function ipLimit(request, env) {
  await limit(env, `ip:${request.headers.get('CF-Connecting-IP') || 'unknown'}`, 30, 15*60000);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM account_auth_limits WHERE expires<?').bind(Date.now()-86400000),
    env.DB.prepare('DELETE FROM account_auth_grants WHERE expires<?').bind(Date.now()),
    env.DB.prepare('DELETE FROM account_sessions WHERE expires<?').bind(Date.now()),
  ]);
}
async function grant(request, env, key='grant') {
  const token = cookieValue(request, key);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return env.DB.prepare('SELECT * FROM account_auth_grants WHERE token_hash=? AND expires>?').bind(await digest(token), Date.now()).first();
}
export async function passwordIdentity(request, env) {
  if (!enabled(env)) return null;
  const token = cookieValue(request, 'session');
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await env.DB.prepare(`SELECT s.user_id,c.email FROM account_sessions s JOIN account_credentials c ON c.user_id=s.user_id WHERE s.token_hash=? AND s.expires>?`).bind(await digest(token), Date.now()).first();
  return row ? role(row.user_id, row.email, env) : null;
}
export async function passwordStatus(request, env) {
  const proof = enabled(env) && await grant(request, env);
  return { passwordLogin: enabled(env), setupEmail: proof?.email || null };
}
async function sessionStatement(env, userId) {
  const token = random();
  return { token, statement: env.DB.prepare('INSERT INTO account_sessions(token_hash,user_id,expires) VALUES(?,?,?)').bind(await digest(token), userId, Date.now()+30*86400000) };
}
export async function passwordRequest(request, env, accessIdentity) {
  const url = new URL(request.url), path = url.pathname;
  check(enabled(env), '密码登录尚未启用', 503);
  if (path === '/api/auth/start' && request.method === 'GET') {
    await ipLimit(request, env);
    const purpose = url.searchParams.get('mode') === 'reset' ? 'reset' : 'register';
    const token = random();
    await env.DB.prepare('INSERT INTO account_auth_grants(token_hash,purpose,expires) VALUES(?,?,?)').bind(await digest(token),purpose,Date.now()+15*60000).run();
    return response(null,302,[cookie('state',token,900),cookie('grant','',0)],`/api/private/auth/verify?state=${token}`);
  }
  if (path === '/api/private/auth/verify' && request.method === 'GET') {
    const state = url.searchParams.get('state') || '';
    const proof = await grant(request, env, 'state');
    check(proof && !proof.user_id && equal(cookieValue(request,'state'),state), '验证已过期，请重新注册或找回密码', 400);
    const access = await accessIdentity(request, env);
    check(access, '请先验证邮箱', 401);
    const email = access.email.trim().toLowerCase();
    check(email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), '邮箱格式不正确');
    const credential = await env.DB.prepare('SELECT user_id FROM account_credentials WHERE email=?').bind(email).first();
    const { results: existing } = await env.DB.prepare('SELECT id FROM users WHERE lower(email)=? LIMIT 2').bind(email).all();
    check(existing.length < 2 || credential, '账号记录重复，请联系管理员', 409);
    const userId = credential?.user_id || existing[0]?.id || access.id;
    const consumed = await env.DB.prepare('DELETE FROM account_auth_grants WHERE token_hash=? AND expires>? RETURNING token_hash').bind(proof.token_hash,Date.now()).first();
    check(consumed, '验证已使用，请重试', 409);
    const token = random();
    await env.DB.prepare('INSERT INTO account_auth_grants(token_hash,user_id,email,purpose,expires) VALUES(?,?,?,?,?)').bind(await digest(token),userId,email,proof.purpose,Date.now()+15*60000).run();
    return response(null,302,[cookie('state','',0),cookie('grant',token,900)],'/?auth=setup');
  }
  if (path === '/api/auth/password' && request.method === 'POST') {
    await ipLimit(request, env);
    const body = await readJson(request,2048); validPassword(body.password);
    const proof = await grant(request,env);
    check(proof?.user_id && proof.email,'请先验证邮箱',401);
    const credential = await env.DB.prepare('SELECT user_id FROM account_credentials WHERE email=?').bind(proof.email).first();
    check(proof.purpose === 'reset' || !credential, '此邮箱已注册，请登录或找回密码',409);
    const salt = random(), passwordHash = await hashPassword(body.password,salt,env);
    const consumed = await env.DB.prepare('DELETE FROM account_auth_grants WHERE token_hash=? AND expires>? RETURNING token_hash').bind(proof.token_hash,Date.now()).first();
    check(consumed,'验证已使用，请重新验证邮箱',409);
    const next = await sessionStatement(env,proof.user_id);
    // Conditional registration prevents a simultaneous register from overwriting a password.
    const save = proof.purpose === 'register'
      ? env.DB.prepare('INSERT INTO account_credentials(email,user_id,salt,password_hash,updated) VALUES(?,?,?,?,?)')
      : env.DB.prepare('INSERT INTO account_credentials(email,user_id,salt,password_hash,updated) VALUES(?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET salt=excluded.salt,password_hash=excluded.password_hash,updated=excluded.updated');
    await env.DB.batch([
      save.bind(proof.email,proof.user_id,salt,passwordHash,Date.now()),
      env.DB.prepare('DELETE FROM account_sessions WHERE user_id=?').bind(proof.user_id),
      env.DB.prepare('DELETE FROM account_auth_grants WHERE user_id=?').bind(proof.user_id),
      next.statement,
    ]);
    const user = role(proof.user_id,proof.email,env); await rememberUser(env,user);
    return response({ user },200,[cookie('session',next.token,30*86400),cookie('grant','',0)]);
  }
  if (path === '/api/auth/login' && request.method === 'POST') {
    await ipLimit(request, env);
    const body = await readJson(request,2048);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    check(email.length <= 254 && email.includes('@') && typeof body.password === 'string' && body.password.length <= 128,'邮箱或密码不正确',401);
    await limit(env,`email:${email}`,10,15*60000);
    const credential = await env.DB.prepare('SELECT * FROM account_credentials WHERE email=?').bind(email).first();
    const hash = await hashPassword(body.password,credential?.salt || 'margina-nonexistent-account',env);
    check(credential && equal(hash,credential.password_hash),'邮箱或密码不正确',401);
    const next = await sessionStatement(env,credential.user_id);
    // Password reset racing with login must not create a session for an old password.
    const issued = await env.DB.prepare('INSERT INTO account_sessions(token_hash,user_id,expires) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM account_credentials WHERE email=? AND password_hash=?)')
      .bind(await digest(next.token),credential.user_id,Date.now()+30*86400000,email,credential.password_hash).run();
    check(issued.meta.changes === 1,'密码已更新，请重新登录',401);
    return response({ user: role(credential.user_id,credential.email,env) },200,[cookie('session',next.token,30*86400)]);
  }
  if (path === '/api/auth/logout' && request.method === 'POST') {
    const token = cookieValue(request,'session');
    if (token) await env.DB.prepare('DELETE FROM account_sessions WHERE token_hash=?').bind(await digest(token)).run();
    const proof = await grant(request,env);
    if (proof) await env.DB.prepare('DELETE FROM account_auth_grants WHERE token_hash=?').bind(proof.token_hash).run();
    return response({ ok:true },200,[cookie('session','',0),cookie('grant','',0),cookie('state','',0)]);
  }
  return response({ error:'接口不存在' },404);
}
