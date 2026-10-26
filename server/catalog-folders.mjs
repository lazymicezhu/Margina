import { check, readJson } from './validation.mjs';

export const paperWithFolder = `SELECT p.*, i.folder_id AS catalog_folder_id, f.name AS catalog_folder_name FROM papers p
  LEFT JOIN catalog_items i ON i.book_id = p.id LEFT JOIN catalog_folders f ON f.id = i.folder_id`;

export async function catalogFolders(env, user) {
  const { results } = await env.DB.prepare(`SELECT f.id, f.name, f.owner,
    (SELECT COUNT(*) FROM catalog_items i JOIN papers p ON p.id = i.book_id
     WHERE i.folder_id = f.id AND p.removed = 0 AND p.visibility = 'public') AS count
    FROM catalog_folders f ORDER BY f.created, f.id`).all();
  return results.map(f => ({ id: f.id, name: f.name, count: f.count, canManage: !!user && (user.admin || f.owner === user.id) }));
}

export async function requireCatalogFolder(env, id) {
  check(typeof id === 'string' && /^[\w-]{1,64}$/.test(id), '文件夹不正确');
  const folder = await env.DB.prepare('SELECT * FROM catalog_folders WHERE id = ?').bind(id).first();
  check(folder, '书库文件夹不存在，请重新选择', 404);
  return folder;
}

export async function catalogFolderRequest(request, env, user, shelf, json) {
  const path = new URL(request.url).pathname;
  if (path === '/api/private/catalog/folders' && request.method === 'POST') {
    const { name } = await readJson(request, 2048);
    check(typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 60, '文件夹名称须为 1–60 字');
    const id = crypto.randomUUID(), now = Date.now();
    const result = await env.DB.prepare(`INSERT INTO catalog_folders(id, name, owner, created, updated)
      SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM catalog_folders WHERE owner = ?) < 100`)
      .bind(id, name.trim(), user.id, now, now, user.id).run();
    check(result.meta.changes === 1, '每个账号最多创建 100 个书库文件夹');
    return json({ id }, 201);
  }
  const match = path.match(/^\/api\/private\/catalog\/folders\/([\w-]+)$/);
  if (match && ['PATCH', 'DELETE'].includes(request.method)) {
    const folder = await requireCatalogFolder(env, match[1]);
    check(folder.owner === user.id || user.admin, '只有创建者或管理员可以管理此文件夹', 403);
    if (request.method === 'DELETE') {
      // Foreign-key cascade removes membership, never papers or personal records.
      await env.DB.prepare('DELETE FROM catalog_folders WHERE id = ?').bind(folder.id).run();
    } else {
      const { name } = await readJson(request, 2048);
      check(typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 60, '文件夹名称须为 1–60 字');
      await env.DB.prepare('UPDATE catalog_folders SET name = ?, updated = ? WHERE id = ?').bind(name.trim(), Date.now(), folder.id).run();
    }
    return json({ ok: true });
  }
  const item = path.match(/^\/api\/private\/catalog\/items\/([a-f0-9]{64})$/);
  if (item && request.method === 'PUT') {
    shelf.requireBook(item[1]);
    const paper = await env.DB.prepare('SELECT * FROM papers WHERE id = ?').bind(item[1]).first();
    check(paper && paper.visibility === 'public' && (paper.removed === 0 || (user.admin && paper.removed === 1)), '公开文献不存在或不可归类', 404);
    check(paper.owner === user.id || user.admin, '只有上传者或管理员可以移动文献', 403);
    const { folderId } = await readJson(request, 2048);
    if (folderId === null) await env.DB.prepare('DELETE FROM catalog_items WHERE book_id = ?').bind(paper.id).run();
    else {
      await requireCatalogFolder(env, folderId);
      await env.DB.prepare(`INSERT INTO catalog_items(book_id, folder_id) VALUES (?, ?)
        ON CONFLICT(book_id) DO UPDATE SET folder_id = excluded.folder_id`).bind(paper.id, folderId).run();
    }
    return json({ ok: true });
  }
  return json({ error: '接口不存在' }, 404);
}
