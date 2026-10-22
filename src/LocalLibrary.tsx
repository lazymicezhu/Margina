import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, CloudOff, FilePlus2, FileText, FolderOpen, Highlighter, Library, LoaderCircle, NotebookPen, Plus, Search, Settings2, ShieldCheck, Smartphone, Star, Trash2, Upload, X } from 'lucide-react';
import type { Book, Bundle } from './types';
import { deleteBook, listBooks, notesMarkdown, patchBook, putBook, saveFile } from './storage';
import { makeBook } from './pdf';
import { makeTxtBook } from './txt-book';
import Reader from './Reader';
import { validateBundle } from './bundle';
import { importLocalCatalog } from './catalog';
import { CopyButton, Disclosure, RevealText, useSpringFeedback } from './interactions';

const formatSize = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
export function Logo({ small = false }: { small?: boolean }) {
  return <div className={`brand ${small ? 'small' : ''}`}><span className="brand-icon"><BookOpen size={small ? 21 : 25} strokeWidth={1.5} /></span><div><strong>Margina<span className="brand-dot">.</span></strong></div></div>;
}
export default function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<'library' | 'notes' | 'starred'>('library');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'bilingual' | 'reading'>('all');
  const [message, setMessage] = useState('');
  const [settings, setSettings] = useState(false);
  const [remove, setRemove] = useState<Book | null>(null);
  const [drag, setDrag] = useState(false);
  const dropRef = useSpringFeedback<HTMLDivElement>(drag, 'drag');
  const [sort, setSort] = useState('recent');
  const fileRef = useRef<HTMLInputElement>(null);
  const allBooks = useRef(books); allBooks.current = books;
  const importLock = useRef(false);
  const activeBook = books.find(b => b.id === activeId);

  function notify(text: string) { setMessage(text); }
  useEffect(() => { if (!message) return; const timer = setTimeout(() => setMessage(''), 4500); return () => clearTimeout(timer); }, [message]);
  useEffect(() => {
    (async () => {
      const existing = (await listBooks()).filter(book => !book.privateOwner); setBooks(existing);
      await importLocalCatalog(existing, setBusy);
      setBooks((await listBooks()).filter(book => !book.privateOwner));
    })().catch(e => notify(e.message || '无法读取本地文献库，请检查浏览器的存储权限。')).finally(() => { setLoading(false); setBusy(''); });
  }, []);

  async function update(id: string, patch: Partial<Book>) {
    try { await patchBook(id, patch); setBooks(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b)); }
    catch (e) { notify('保存失败，请导出笔记备份并检查浏览器存储空间。'); throw e; }
  }
  function open(book: Book) { setActiveId(book.id); update(book.id, { opened: Date.now() }).catch(() => {}); }
  async function importFiles(files: FileList | File[]) {
    if (importLock.current) return;
    importLock.current = true;
    let count = 0; let linked = 0; const failures: string[] = [];
    let next = [...allBooks.current];
    try {
      for (const file of Array.from(files).filter(f => /\.(pdf|txt)$/i.test(f.name))) {
        if (file.size > 100 * 1024 * 1024) { failures.push(`${file.name} 超过 100 MB`); continue; }
        setBusy(`正在导入 ${file.name}…`);
        try {
          const book = await (/\.txt$/i.test(file.name) ? makeTxtBook : makeBook)(file, file.name);
          if (next.some(b => b.id === book.id)) { failures.push(`${file.name} 已在文献库中`); continue; }
          await putBook(book); next.push(book); count++; setBooks([...next]);
        } catch (error) { failures.push(`${file.name}：${error instanceof Error ? error.message : '无法读取文件'}`); }
      }
      for (const file of Array.from(files).filter(f => /\.json$/i.test(f.name))) {
        setBusy(`正在关联翻译数据 ${file.name}…`);
        try {
          if (file.size > 20 * 1024 * 1024) throw new Error('数据文件过大');
          const bundle = validateBundle(JSON.parse(await file.text()));
          const book = next.find(b => b.id === bundle.pdfSha256);
          if (!book || book.format === 'txt' || book.pages !== bundle.pageCount) throw new Error('请同时导入与此阅读包匹配的双语 PDF');
          const updated = { ...book, bundle, title: bundle.title, author: bundle.author || book.author, bilingual: true };
          await putBook(updated); next = next.map(b => b.id === book.id ? updated : b); linked++; setBooks([...next]);
        } catch (e) { failures.push(`${file.name}：${e instanceof Error ? e.message : '数据格式不正确'}`); }
      }
      if (!count && !linked && !failures.length) failures.push('请选择 PDF、TXT 或 .yuejian.json 阅读包');
      notify([count ? `已导入 ${count} 篇文献` : '', linked ? `已关联 ${linked} 份翻译数据` : '', ...failures].filter(Boolean).join('；'));
    } finally { setBusy(''); importLock.current = false; if (fileRef.current) fileRef.current.value = ''; }
  }
  const notesCount = books.reduce((sum, b) => sum + b.annotations.length, 0);
  const filtered = books.filter(b => (!query || `${b.title} ${b.author} ${b.fileName} ${b.bundle?.titleEn || ''}`.toLowerCase().includes(query.toLowerCase())) && (view !== 'starred' || b.starred) && (filter !== 'bilingual' || b.bilingual) && (filter !== 'reading' || b.opened)).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'zh-CN') : Math.max(b.opened, b.added) - Math.max(a.opened, a.added));
  const lastRead = [...books].sort((a,b) => b.opened - a.opened)[0];

  return <>
    <input ref={fileRef} type="file" accept=".pdf,.txt,.json" multiple hidden onChange={e => e.target.files && importFiles(e.target.files)} />
    {activeBook ? <Reader book={activeBook} onBack={() => setActiveId(null)} onUpdate={patch => update(activeBook.id, patch)} notify={notify} /> :
      <div className={`app-shell ${drag ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); if (!busy) setDrag(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false); }} onDrop={e => { e.preventDefault(); setDrag(false); if (!busy) importFiles(e.dataTransfer.files); }}>
        <aside className="sidebar">
          <Logo />
          <nav aria-label="主导航">
            <button className={view === 'library' ? 'nav-item active' : 'nav-item'} onClick={() => { setView('library'); setFilter('all'); }}><Library size={19} />文献库<span>{books.length.toString().padStart(2, '0')}</span></button>
            <button className={view === 'notes' ? 'nav-item active' : 'nav-item'} onClick={() => setView('notes')}><NotebookPen size={19} />我的笔记<span>{notesCount.toString().padStart(2, '0')}</span></button>
            <button className={view === 'starred' ? 'nav-item active' : 'nav-item'} onClick={() => setView('starred')}><Star size={19} />星标文献</button>
          </nav>
          <div className="sidebar-bottom"><button className="nav-item" onClick={() => setSettings(true)}><Settings2 size={18} />设置</button></div>
        </aside>
        <main className="library-main">
          <header className="library-top"><div className="mobile-brand"><Logo small /></div><button className="local-pill" onClick={() => setSettings(true)}><span className="status-dot" />本地存储<ChevronRight size={13} /></button></header>
          <div className="library-content">
            <section className="intro"><h1>{view === 'notes' ? '笔记' : view === 'starred' ? '星标' : '文献库'}</h1><button className="primary-button import-button" onClick={() => fileRef.current?.click()} disabled={!!busy}><Plus size={18} />导入</button></section>
            {view === 'library' && lastRead?.opened > 0 && <button className="continue-card" onClick={() => open(lastRead)}><span className="continue-label">继续阅读</span><strong>{lastRead.title}</strong><span>第 {lastRead.page} / {lastRead.pages} 页</span><ArrowRight size={18} /></button>}
            {view === 'notes' ? <><div className="section-heading"><h2>{notesCount} 条</h2><button className="text-button" disabled={!notesCount} onClick={() => saveFile(books.filter(b => b.annotations.length).map(notesMarkdown).join('\n\n---\n\n'), 'Margina-全部笔记.md')}><ArrowDownToLine size={16} />导出全部</button></div><div className="all-notes">{books.flatMap(b => b.annotations.map(n => <article className="global-note" key={n.id}><button className="note-source" onClick={async () => { try { await update(b.id, {page:n.page}); open(b); } catch {} }}><FileText size={14} />{b.title}<ArrowRight size={14} /></button>{n.quote && <blockquote className={`quote-${n.color}`}>{n.quote}</blockquote>}{n.text && <p>{n.text}</p>}<div className="note-copy"><CopyButton text={[n.quote,n.text].filter(Boolean).join('\n\n')} onError={()=>notify('复制失败，请重试')}/></div><footer>第 {n.page} 页 · {n.language === 'en' ? '英文' : n.language === 'zh' ? '中文' : '对照'}<span>{new Date(n.updated).toLocaleDateString('zh-CN')}</span></footer></article>))}{!notesCount && <Empty icon={<NotebookPen size={32}/>} title="暂无笔记" text="在文献中选中文字即可记笔记。" />}</div></> : <>
              <div className="collection-controls"><div className="tabs"><button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>全部文献 <span>{view === 'starred' ? books.filter(b => b.starred).length : books.length}</span></button><button className={filter === 'bilingual' ? 'selected' : ''} onClick={() => setFilter('bilingual')}>中英对照</button><button className={filter === 'reading' ? 'selected' : ''} onClick={() => setFilter('reading')}>最近阅读</button></div><div className="library-tools"><label className="search"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索标题、作者…" aria-label="搜索文献"/>{query && <button className="icon-button" aria-label="清空搜索" onClick={() => setQuery('')}><X size={14}/></button>}</label><select aria-label="排序方式" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">最近打开</option><option value="title">按标题排序</option></select></div></div>
              {loading ? <div className="loading-state"><LoaderCircle className="spin" size={25}/><p>{busy || '正在打开文献库…'}</p></div> : <div className="book-grid">{filtered.map((book, index) => <article className={`book-card tone-${index % 3}`} key={book.id}><button className="book-cover" onClick={() => open(book)} aria-label={`阅读 ${book.title}`}><div className="cover-top"><span>{book.format === 'txt' ? 'TXT 文本' : book.bilingual ? '中英对照' : 'PDF 文献'}</span></div><div className="paper-thumbnail"><img src={book.cover} alt={`${book.title} 首页`} /></div><div className="cover-bottom"><span>{book.format === 'txt' ? 'TXT 阅读' : book.bundle ? '段落阅读 + 原版 PDF' : '原版 PDF'}</span><span>{book.pages} 页</span></div><span className="read-hover">开始阅读 <ArrowRight size={16}/></span></button><div className="book-info"><div className="book-title-row"><button className="book-title" onClick={() => open(book)}>{book.title}</button><button className={`icon-button star-button ${book.starred ? 'is-starred' : ''}`} aria-pressed={book.starred} aria-label={book.starred ? '取消星标' : '添加星标'} onClick={() => update(book.id, { starred: !book.starred }).catch(() => {})}><StarFeedback active={book.starred}/></button></div><p className="book-author">{book.author || book.fileName}</p><div className="book-meta"><span><NotebookPen size={13}/>{book.annotations.length ? `${book.annotations.length} 条笔记` : '0 条笔记'}</span><span>{formatSize(book.size)}</span><button className="icon-button delete-book" aria-label={`移除 ${book.title}`} onClick={() => setRemove(book)}><Trash2 size={14}/></button></div><div className="progress-track"><div style={{width: `${book.opened ? book.page / book.pages * 100 : 0}%`}}/></div></div></article>)}{filter === 'all' && !query && view !== 'starred' && <button className="upload-card" disabled={!!busy} onClick={() => fileRef.current?.click()}><div className="upload-icon"><FilePlus2 size={26} strokeWidth={1.4}/></div><strong>导入文件</strong><p>点击或拖入文件</p><span>PDF ≤ 100 MB · TXT ≤ 10 MB · JSON ≤ 20 MB</span></button>}</div>}
              {!loading && !filtered.length && (query || view === 'starred' || filter !== 'all') && <Empty icon={<FolderOpen size={30}/>} title={query ? '无匹配文献' : '暂无文献'} text={query ? '试试其他关键词。' : ''} />}
            </>}
          </div>
          <nav className="mobile-nav" aria-label="手机导航"><button className={view === 'library' ? 'active' : ''} onClick={() => {setView('library');setFilter('all');}}><Library size={21}/>文献</button><button className={view === 'notes' ? 'active' : ''} onClick={() => setView('notes')}><NotebookPen size={21}/>笔记</button><button className={view === 'starred' ? 'active' : ''} onClick={() => setView('starred')}><Star size={21}/>星标</button><button onClick={() => setSettings(true)}><Settings2 size={21}/>设置</button></nav>
        </main>
        {drag && <div className="drop-overlay" ref={dropRef}><Upload size={42}/><h2>松开以导入</h2><p>PDF / TXT / 阅读包 JSON</p></div>}
      </div>}
    {message && <div className="toast" role="status"><RevealText text={message} key={message}/><button aria-label="关闭提示" onClick={() => setMessage('')}><X size={16}/></button></div>}
    {!!busy && !loading && <div className="busy-toast" role="status"><LoaderCircle className="spin" size={18}/>{busy}</div>}
    {settings && <div className="modal-backdrop" onClick={() => setSettings(false)}><section className="modal" role="dialog" aria-modal="true" aria-label="存储与备份" onClick={e => e.stopPropagation()}><button className="icon-button modal-close" aria-label="关闭设置" onClick={() => setSettings(false)}><X size={20}/></button><div className="modal-symbol"><ShieldCheck size={28}/></div><h2>存储与备份</h2><p>仅存于此浏览器，清理网站数据会删除文献和笔记。</p><div className="storage-row"><span>本地文献</span><strong>{books.length} 篇 · {formatSize(books.reduce((s,b)=>s+b.size,0))}</strong></div><div className="storage-row"><span>云端同步</span><strong className="muted"><CloudOff size={15}/>未启用</strong></div><button className="wide-button" disabled={!notesCount} onClick={() => {saveFile(books.filter(b=>b.annotations.length).map(notesMarkdown).join('\n\n---\n\n'),'Margina-全部笔记.md');notify('已请求下载 Markdown，请检查浏览器下载记录');}}><ArrowDownToLine size={17}/>导出全部笔记（Markdown）</button><Disclosure label="备份说明"><p>Markdown 仅导出笔记，不能恢复文献库。请另行保留原始文件和阅读包。</p></Disclosure></section></div>}
    {remove && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="移除文献"><h2>从本地书架移除？</h2><p>「{remove.title}」及它的 {remove.annotations.length} 条笔记会从此浏览器删除，原始文件不受影响。</p><div className="modal-actions"><button className="secondary-button" onClick={()=>setRemove(null)}>保留</button>{remove.annotations.length > 0 && <button className="secondary-button" onClick={()=>saveFile(notesMarkdown(remove),`${remove.title}-笔记.md`)}>先导出笔记</button>}<button className="danger-button" onClick={async()=>{try{await deleteBook(remove.id);setBooks(prev=>prev.filter(b=>b.id!==remove.id));setRemove(null);}catch{notify('移除失败，请重试');}}}>移除文献</button></div></section></div>}
  </>;
}
function Empty({icon,title,text}:{icon:React.ReactNode;title:string;text:string}) {return <div className="empty-state">{icon}<h3>{title}</h3>{text && <p>{text}</p>}</div>;}

function StarFeedback({active}:{active:boolean}) {
  const ref = useSpringFeedback<HTMLSpanElement>(active);
  return <span className="action-glyph" ref={ref}><Star size={17} fill={active ? 'currentColor' : 'none'}/></span>;
}
