import type { Book } from './types';
import { validateBundle } from './bundle';
import { makeBook } from './pdf';
import { patchBook, putBook, setting } from './storage';

type CatalogItem = { pdf: string; bundle?: string; name: string; sha256?: string; title?: string; author?: string; bilingual?: boolean };
type Catalog = { revision: string; items: CatalogItem[] };

// One import per local catalog revision. Updating bundles must never overwrite
// existing notes, bookmarks or progress. Failed imports retry on the next load.
export async function importLocalCatalog(existing: Book[], progress: (text: string) => void) {
  const response = await fetch('/samples/catalog.json', { cache: 'no-store' });
  if (response.status === 404 || response.headers.get('content-type')?.includes('text/html')) return;
  if (!response.ok) throw new Error('本地文献列表加载失败，请刷新重试。');
  const data = await response.json() as Catalog | CatalogItem[];
  const legacy = Array.isArray(data);
  const revision = legacy ? 'legacy-samples-v1' : data.revision;
  const items = legacy ? data : data.items;
  if (!revision || !Array.isArray(items)) throw new Error('本地文献列表格式不正确。');
  if (legacy && await setting('initialized')) return;
  if (await setting('localCatalogRevision') === revision) return;
  for (const [index, item] of items.entries()) {
    progress(`正在导入本地文献 ${index + 1}/${items.length}：${item.name}`);
    const bundleUrl = item.bundle;
    const bundle = bundleUrl ? await (async () => {
      const res = await fetch(bundleUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${item.name} 的阅读包加载失败。`);
      return validateBundle(await res.json());
    })() : undefined;
    const expectedHash = item.sha256 || bundle?.pdfSha256;
    if (bundle && expectedHash !== bundle.pdfSha256) throw new Error(`${item.name} 的阅读包哈希不匹配。`);
    const found = existing.find(book => book.id === expectedHash);
    let book = found;
    if (!book) {
      const res = await fetch(item.pdf);
      if (!res.ok) throw new Error(`${item.name} 加载失败。`);
      book = await makeBook(await res.blob(), item.name, true);
      if (expectedHash && book.id !== expectedHash) throw new Error(`${item.name} 的 PDF 哈希不匹配。`);
    }
    if (bundle && (book.id !== bundle.pdfSha256 || book.pages !== bundle.pageCount)) {
      throw new Error(`${item.name} 与阅读包不匹配。`);
    }
    const metadata: Partial<Book> = {
      title: bundle?.title || item.title || book.title,
      author: bundle?.author || item.author || book.author,
      ...(item.bilingual !== undefined ? { bilingual: item.bilingual } : {}),
      ...(bundle ? { bundle, bilingual: true } : {}),
    };
    if (found) await patchBook(found.id, metadata);
    else { const added = { ...book, ...metadata }; await putBook(added); existing.push(added); }
  }
  await setting('localCatalogRevision', revision);
  await setting('initialized', true);
}
