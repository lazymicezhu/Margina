import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';

let localKey;
const getLocalKey = () => localKey ||= crypto.getRandomValues(new Uint8Array(32));
const keySets = new Map();
export function localAuth(request, env) {
  return env.LOCAL_DEV_AUTH === 'true' && env.ENVIRONMENT === 'local' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname);
}
export function authConfigured(env) {
  return /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER || '') && !!env.ACCESS_AUD;
}
export async function identity(request, env) {
  if (localAuth(request, env)) {
    const token = request.headers.get('cookie')?.match(/(?:^|;\s*)margina_dev=([^;]+)/)?.[1];
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, getLocalKey(), { algorithms: ['HS256'], issuer: 'margina-local', audience: 'margina-local' });
      return { id: payload.sub, email: payload.email, admin: payload.sub === 'local-alice', local: true };
    } catch { return null; }
  }
  if (!authConfigured(env)) return null;
  // The edge Access policy protects /api/private/*; verification also makes
  // alternate Worker routes fail closed instead of trusting email headers.
  const token = request.headers.get('cf-access-jwt-assertion') || request.headers.get('cookie')?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];
  if (!token) return null;
  try {
    if (!keySets.has(env.ACCESS_ISSUER)) keySets.set(env.ACCESS_ISSUER, createRemoteJWKSet(new URL(`${env.ACCESS_ISSUER}/cdn-cgi/access/certs`)));
    const { payload } = await jwtVerify(token, keySets.get(env.ACCESS_ISSUER), {
      issuer: env.ACCESS_ISSUER, audience: env.ACCESS_AUD, algorithms: ['RS256'],
    });
    if (!payload.sub || typeof payload.email !== 'string') return null;
    const admins = (env.ADMIN_EMAILS || '').split(',').map(x => x.trim().toLowerCase());
    return { id: payload.sub, email: payload.email, admin: admins.includes(payload.email.toLowerCase()), local: false };
  } catch { return null; }
}
export async function devCookie(name) {
  if (!['alice', 'bob'].includes(name)) throw new Error('请选择本地测试账号');
  const token = await new SignJWT({ email: `${name}@local.test` }).setProtectedHeader({ alg: 'HS256' })
    .setSubject(`local-${name}`).setIssuer('margina-local').setAudience('margina-local').setIssuedAt().setExpirationTime('12h').sign(getLocalKey());
  return `margina_dev=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`;
}
