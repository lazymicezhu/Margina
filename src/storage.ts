import type { Book } from './types';

let database: Promise<IDBDatabase> | undefined;
function db() {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('yuejian-library', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('books', { keyPath: 'id' });
      request.result.createObjectStore('settings');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('请关闭旧的Margina标签页后重试。'));
  });
}
export async function listBooks(): Promise<Book[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const req = database.transaction('books').objectStore('books').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function putBook(book: Book) {
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction('books', 'readwrite');
    tx.objectStore('books').put(book);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('保存已中断'));
  });
}
export async function patchBook(id: string, patch: Partial<Book>): Promise<void> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('books', 'readwrite');
    const store = tx.objectStore('books');
    const request = store.get(id);
    request.onsuccess = () => { if (request.result) store.put({ ...request.result, ...patch, id }); };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('保存已中断'));
  });
}
export async function deleteBook(id: string) {
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction('books', 'readwrite');
    tx.objectStore('books').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
export async function setting(key: string, value?: unknown): Promise<unknown> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('settings', value === undefined ? 'readonly' : 'readwrite');
    const request = value === undefined ? tx.objectStore('settings').get(key) : tx.objectStore('settings').put(value, key);
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
  });
}
export function saveFile(content: string | Blob, name: string, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function notesMarkdown(book: Book) {
  return `# ${book.title}\n\n${book.author ? `${book.author}\n\n` : ''}导出自Margina · ${new Date().toLocaleDateString('zh-CN')}\n\n` + book.annotations.map(n => `## 第 ${n.page} 页\n\n${n.quote ? '> ' + n.quote.replace(/\n/g, '\n> ') + '\n\n' : ''}${n.text || '（高亮摘录）'}\n`).join('\n---\n\n');
}
