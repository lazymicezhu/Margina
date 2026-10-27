import { check } from './validation.mjs';

export async function rememberUser(env, user) {
  if (!user) return;
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO users(id, email, created, last_seen) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET email = excluded.email, last_seen = excluded.last_seen
    WHERE users.email <> excluded.email OR users.last_seen < ?`)
    .bind(user.id, user.email, now, now, now - 3600000).run();
}

export async function adminRequest(request, env, user, { json, publicPaper, publicRecord, discard }) {
  check(user.admin, '需要管理员权限', 403);
  const url = new URL(request.url);
  const path = url.pathname;
  const q = (url.searchParams.get('q') || '').slice(0, 120);
  const offset = Math.max(0, Math.min(1000000, Math.floor(Number(url.searchParams.get('offset')) || 0)));
  if (path === '/api/private/admin/users' && request.method === 'GET') {
    const { results } = await env.DB.prepare(`SELECT u.id, u.email, u.last_seen AS lastSeen,
      (SELECT COUNT(*) FROM reading r WHERE r.user_id = u.id) AS papers,
      (SELECT COALESCE(SUM(json_array_length(r.data, '$.annotations')), 0) FROM reading r WHERE r.user_id = u.id) AS notes
      FROM users u WHERE instr(lower(u.email), lower(?)) > 0 OR instr(u.id, ?) > 0
      ORDER BY u.last_seen DESC, u.id LIMIT 51 OFFSET ?`).bind(q, q, offset).all();
    return json({ users: results.slice(0, 50), more: results.length > 50 });
  }
  if (path === '/api/private/admin/records' && request.method === 'GET') {
    const id = url.searchParams.get('user');
    check(id && id.length <= 256, '请选择账号');
    const after = Number(url.searchParams.get('after') || 0);
    check(Number.isSafeInteger(after) && after >= 0, '游标不正确');
    const { results } = await env.DB.prepare(`SELECT r.*, p.title, p.removed FROM reading r
      LEFT JOIN papers p ON p.id = r.book_id WHERE r.user_id = ? AND r.seq > ? ORDER BY r.seq LIMIT 11`)
      .bind(id, after).all();
    const rows = results.slice(0, 10);
    return json({ records: rows.map(r => ({ ...publicRecord(r), title: r.title || '文献记录', removed: !!r.removed })),
      cursor: rows.at(-1)?.seq || after, more: results.length > 10 });
  }
  if (path === '/api/private/admin/papers' && request.method === 'GET') {
    const status = url.searchParams.get('status') || 'all';
    check(['all', 'active', 'withdrawn', 'incomplete', 'deleted'].includes(status), '状态不正确');
    const filter = { all: 'p.removed <> 2', active: 'p.removed = 0', withdrawn: 'p.removed = 1', incomplete: 'p.removed = 3', deleted: 'p.removed = 3' }[status];
    const { results } = await env.DB.prepare(`SELECT p.*, u.email AS owner_email, i.folder_id AS catalog_folder_id, f.name AS catalog_folder_name FROM papers p
      LEFT JOIN users u ON u.id = p.owner LEFT JOIN catalog_items i ON i.book_id = p.id
      LEFT JOIN catalog_folders f ON f.id = i.folder_id WHERE ${filter} AND
      (instr(lower(p.title), lower(?)) > 0 OR instr(lower(p.author), lower(?)) > 0)
      ORDER BY p.created DESC, p.id LIMIT 41 OFFSET ?`).bind(q, q, offset).all();
    return json({ papers: results.slice(0, 40).map(p => ({ ...publicPaper(p, user), status: p.removed,
      owner: p.owner_email || p.owner })), more: results.length > 40 });
  }
  const match = path.match(/^\/api\/private\/admin\/papers\/([a-f0-9]{64})(?:\/(restore))?$/);
  if (match && request.method === 'POST' && match[2]) {
    const row = await env.DB.prepare('UPDATE papers SET removed = 0, updated = ? WHERE id = ? AND removed = 1 RETURNING id')
      .bind(Date.now(), match[1]).first();
    check(row, '只有已撤下的文献可以恢复', 409);
    return json({ ok: true });
  }
  if (match && request.method === 'DELETE' && !match[2]) {
    // State 3 prevents restore/bundle replacement while deletion is in flight.
    // Keep the keys until completion so an interrupted deletion can be retried.
    const paper = await env.DB.prepare('UPDATE papers SET removed = 3, updated = ? WHERE id = ? AND removed <> 2 RETURNING *')
      .bind(Date.now(), match[1]).first();
    if (!paper) {
      check(await env.DB.prepare('SELECT id FROM papers WHERE id = ?').bind(match[1]).first(), '文献不存在', 404);
      return json({ ok: true });
    }
    await discard(env, paper.pdf_key);
    if (paper.bundle_key) await discard(env, paper.bundle_key);
    const { results: covers } = await env.DB.prepare('SELECT object_key FROM paper_covers WHERE book_id = ?').bind(paper.id).all();
    for (const cover of covers) await discard(env, cover.object_key);
    await env.DB.prepare('DELETE FROM paper_covers WHERE book_id = ?').bind(paper.id).run();
    await env.DB.prepare('UPDATE papers SET removed = 2, updated = ? WHERE id = ? AND removed = 3')
      .bind(Date.now(), paper.id).run();
    return json({ ok: true });
  }
  return json({ error: '接口不存在' }, 404);
}
