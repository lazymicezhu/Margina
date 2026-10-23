import { check, readJson, HASH } from './validation.mjs';
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
const digest = async text => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' }, key, 256));
}
function validPassword(password) { check(typeof password === 'string' && password.length >= 6 && password.length <= 128, '密码须为 6–128 位'); }
export async function shelfAccess(request, env, user) {
  const { results: folders } = await env.DB.prepare('SELECT * FROM shelf_folders WHERE user_id = ?').bind(user.id).all();
  const unlocked = new Set();
  const token = request.headers.get('X-Shelf-Unlock') || '';
  if (token.length > 0 && token.length <= 128) {
    const session = await env.DB.prepare('SELECT folder_id FROM shelf_unlocks WHERE token_hash = ? AND user_id = ? AND expires > ?')
      .bind(await digest(token), user.id, Date.now()).first();
    if (session) unlocked.add(session.folder_id);
  }
  const locked = new Set(folders.filter(f => f.password_hash && !unlocked.has(f.id)).map(f => f.id));
  const { results: items } = await env.DB.prepare('SELECT * FROM shelf_items WHERE user_id = ?').bind(user.id).all();
  const blockedBooks = new Set(items.filter(i => locked.has(i.folder_id)).map(i => i.book_id));
  return { folders, items, locked, blockedBooks, requireBook(id) { check(!blockedBooks.has(id), '请先解锁文件夹', 423); } };
}
export async function shelfRequest(request, env, user, access, json) {
  const path = new URL(request.url).pathname;
  if (path === '/api/private/shelf' && request.method === 'GET') {
    const { results: counts } = await env.DB.prepare(`SELECT i.folder_id, COUNT(*) AS count FROM shelf_items i JOIN reading r ON r.user_id = i.user_id AND r.book_id = i.book_id WHERE i.user_id = ? AND json_extract(r.data, '$.shelf') = 1 GROUP BY i.folder_id`).bind(user.id).all();
    return json({ folders: access.folders.map(f => ({ id: f.id, name: f.name, protected: !!f.password_hash, locked: access.locked.has(f.id), count: counts.find(c => c.folder_id === f.id)?.count || 0 })),
      items: access.items.map(i => ({ bookId: i.book_id, folderId: i.folder_id, remark: access.locked.has(i.folder_id) ? '' : i.remark })) });
  }
  if (path === '/api/private/shelf/folders' && request.method === 'POST') {
    const body = await readJson(request, 2048);
    check(typeof body.name === 'string' && body.name.trim().length > 0 && body.name.trim().length <= 60, '文件夹名称须为 1–60 字');
    check(access.folders.length < 100, '最多创建 100 个文件夹');
    check(body.password === undefined || typeof body.password === 'string', '密码格式不正确');
    if (body.password) validPassword(body.password);
    const id = crypto.randomUUID(), salt = body.password ? crypto.randomUUID() : null, now = Date.now();
    await env.DB.prepare('INSERT INTO shelf_folders(id,user_id,name,salt,password_hash,created,updated) VALUES(?,?,?,?,?,?,?)')
      .bind(id, user.id, body.name.trim(), salt, body.password ? await passwordHash(body.password, salt) : null, now, now).run();
    return json({ id }, 201);
  }
  const match = path.match(/^\/api\/private\/shelf\/folders\/([\w-]+)(?:\/(unlock|lock))?$/);
  if (match) {
    const folder = access.folders.find(f => f.id === match[1]); check(folder, '文件夹不存在', 404);
    if (match[2] === 'unlock' && request.method === 'POST') {
      const { password } = await readJson(request, 1024); validPassword(password);
      check(folder.password_hash, '文件夹未设置密码');
      check(folder.blocked_until <= Date.now(), '尝试过于频繁，请稍后再试', 429);
      if (await passwordHash(password, folder.salt) !== folder.password_hash) {
        await env.DB.prepare('UPDATE shelf_folders SET failures = failures + 1, blocked_until = CASE WHEN failures + 1 >= 5 THEN ? ELSE blocked_until END WHERE id = ?').bind(Date.now() + 60000, folder.id).run();
        check(false, '密码不正确', 403);
      }
      await env.DB.prepare('UPDATE shelf_folders SET failures = 0, blocked_until = 0 WHERE id = ?').bind(folder.id).run();
      const token = hex(crypto.getRandomValues(new Uint8Array(32)));
      const issued = await env.DB.batch([
        env.DB.prepare('DELETE FROM shelf_unlocks WHERE user_id = ? AND expires < ?').bind(user.id, Date.now()),
        env.DB.prepare('INSERT INTO shelf_unlocks(token_hash,user_id,folder_id,expires) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM shelf_folders WHERE id=? AND password_hash=?)').bind(await digest(token), user.id, folder.id, Date.now() + 8 * 3600000, folder.id, folder.password_hash),
      ]);
      check(issued[1].meta.changes === 1, '密码已变更，请重试', 409);
      return json({ token });
    }
    if (match[2] === 'lock' && request.method === 'POST') {
      const token = request.headers.get('X-Shelf-Unlock') || '';
      if (token) await env.DB.prepare('DELETE FROM shelf_unlocks WHERE token_hash = ? AND user_id = ?').bind(await digest(token), user.id).run();
      return json({ ok: true });
    }
    check(!access.locked.has(folder.id), '请先解锁文件夹', 423);
    if (!match[2] && request.method === 'PATCH') {
      const body = await readJson(request, 2048);
      check(typeof body.name === 'string' && body.name.trim().length > 0 && body.name.trim().length <= 60, '文件夹名称须为 1–60 字');
      if (body.password !== undefined) {
        check(typeof body.password === 'string', '密码格式不正确');
        if (body.password) validPassword(body.password);
        const salt = body.password ? crypto.randomUUID() : null;
        await env.DB.batch([
          env.DB.prepare('UPDATE shelf_folders SET name=?,salt=?,password_hash=?,failures=0,blocked_until=0,updated=? WHERE id=? AND user_id=?').bind(body.name.trim(), salt, body.password ? await passwordHash(body.password,salt) : null, Date.now(), folder.id, user.id),
          env.DB.prepare('DELETE FROM shelf_unlocks WHERE folder_id = ?').bind(folder.id),
        ]);
      } else await env.DB.prepare('UPDATE shelf_folders SET name=?,updated=? WHERE id=? AND user_id=?').bind(body.name.trim(), Date.now(), folder.id, user.id).run();
      return json({ ok: true });
    }
    if (!match[2] && request.method === 'DELETE') {
      await env.DB.batch([
        env.DB.prepare('UPDATE shelf_items SET folder_id=NULL WHERE folder_id=? AND user_id=?').bind(folder.id,user.id),
        env.DB.prepare('DELETE FROM shelf_unlocks WHERE folder_id=?').bind(folder.id),
        env.DB.prepare('DELETE FROM shelf_folders WHERE id=? AND user_id=?').bind(folder.id,user.id),
      ]);
      return json({ ok: true });
    }
  }
  const itemMatch = path.match(/^\/api\/private\/shelf\/items\/([a-f0-9]{64})$/);
  if (itemMatch && request.method === 'PUT') {
    const id = itemMatch[1], body = await readJson(request, 4096);
    access.requireBook(id);
    check(HASH.test(id) && await env.DB.prepare('SELECT 1 FROM reading WHERE user_id=? AND book_id=?').bind(user.id,id).first(), '请先加入书架', 404);
    check(body.folderId === null || typeof body.folderId === 'string', '文件夹不正确');
    if (body.folderId) check(access.folders.some(f => f.id === body.folderId), '文件夹不存在', 404);
    // Adding an unlocked book to a protected folder is allowed; moving it out
    // or changing its remark later requires that folder's password.
    check(typeof body.remark === 'string' && body.remark.length <= 200, '书名备注不能超过 200 字');
    await env.DB.prepare('INSERT INTO shelf_items(user_id,book_id,folder_id,remark) VALUES(?,?,?,?) ON CONFLICT(user_id,book_id) DO UPDATE SET folder_id=excluded.folder_id,remark=excluded.remark').bind(user.id,id,body.folderId,body.remark.trim()).run();
    return json({ ok: true });
  }
  return json({ error: '接口不存在' }, 404);
}
