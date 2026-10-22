import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, BookOpen, Check, ChevronRight, Cloud, FolderOpen, Library, LoaderCircle, LogIn, NotebookPen, Plus, RefreshCw, Search, Settings2, Trash2, Upload, User, X } from 'lucide-react';
import type { Book } from './types';
import type { AccountState, Paper, ReadingData, Session } from './cloud-types';
import { emptyReading } from './cloud-types';
import { api, cachePaper, catalog, getPaper, jsonOptions, session, uploadBundle, uploadPdf } from './cloud-api';
import { readCachedPdf, type PdfSource } from './pdf-source';
import { editReading, readAccount, syncAccount } from './sync';
import { mergeReading } from './sync-merge';
import { getBook, listBooks, notesMarkdown, patchBook, saveFile, setting } from './storage';
import { makeBook } from './pdf';
import { makeTxtBook } from './txt-book';
import Reader from './Reader';
import AdminPanel from './AdminPanel';
import LocalLibrary, { Logo } from './LocalLibrary';
import { CopyButton } from './interactions';
import './cloud.css';

type View = 'catalog' | 'shelf' | 'notes' | 'uploads';
const sizeLabel = (size: number) => `${(size / 1024 / 1024).toFixed(1)} MB`;
const problem = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试';
const freshAccount = (): AccountState => ({ cursor: 0, records: {}, lastSynced: 0 });
const paperFromBook = (b: Book): Paper => ({ id: b.id, format: b.format, contentHash: b.contentHash, visibility: b.privateOwner ? 'private' : 'public', privateOwner: b.privateOwner, title: b.title, author: b.author, fileName: b.fileName, size: b.size, pages: b.pages, bilingual: b.bilingual, hasBundle: !!b.bundle, created: b.added, updated: b.added, removed: false });

export default function App() {
  const [localLibrary, setLocalLibrary] = useState(false);
  const [adminOpen, setAdminOpen] = useState(location.pathname === '/admin');
  const [adminRevision, setAdminRevision] = useState(0);
  const [current, setCurrent] = useState<Session>({ user: null, local: false, loginAvailable: false });
  const [connected, setConnected] = useState(false);
  const [account, setAccount] = useState<AccountState>(freshAccount);
  const [view, setView] = useState<View>('catalog');
  const [papers, setPapers] = useState<Paper[]>([]);
  const [known, setKnown] = useState<Record<string, Paper>>({});
  const [cached, setCached] = useState<Book[]>([]);
  const [more, setMore] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [syncError, setSyncError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [settings, setSettings] = useState(false);
  const [login, setLogin] = useState(false);
  const [upload, setUpload] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [publicConsent, setPublicConsent] = useState(false);
  const [uploadVisibility, setUploadVisibility] = useState<'private' | 'public'>('private');
  const [active, setActive] = useState<Book | null>(null);
  const [pdfSource, setPdfSource] = useState<PdfSource>();
  const [withdraw, setWithdraw] = useState<Paper | null>(null);
  const [removeShelf, setRemoveShelf] = useState<Paper | null>(null);
  const userRef = useRef(current.user); userRef.current = current.user;
  const activeRef = useRef(active); activeRef.current = active;
  const actionLock = useRef(false);
  const searchSerial = useRef(0);
  const retryCount = useRef(0);
  const accountId = current.user?.id;
  const dirty = Object.values(account.records).filter(r => r.dirty).length;
  const shelfIds = Object.keys(account.records).filter(id => account.records[id].data.shelf);
  const personalData = (id: string) => account.records[id]?.data || emptyReading();
  const lookup = (id: string) => known[id] || cached.find(b => b.id === id) && paperFromBook(cached.find(b => b.id === id)!);
  const notify = (text: string) => setMessage(text);

  useEffect(() => { if (message) { const timer = setTimeout(() => setMessage(''), 6000); return () => clearTimeout(timer); } }, [message]);
  async function refreshSession() {
    try { const next = await session(); setCurrent(next); setConnected(true); return next; }
    catch { setConnected(false); return null; }
  }
  async function reloadAccount(id: string) {
    const state = await readAccount(id);
    if (userRef.current?.id === id) setAccount(state);
  }
  async function syncNow(id = userRef.current?.id) {
    if (!id) return;
    setSyncing(true);
    try { await syncAccount(id); if (userRef.current?.id === id) { setSyncError(''); retryCount.current = 0; } }
    catch (error) { if (userRef.current?.id === id) { setSyncError(problem(error)); retryCount.current++; } }
    finally { if (userRef.current?.id === id) { await reloadAccount(id); setSyncing(false); } }
  }
  async function refreshCatalog(append = false) {
    const serial = ++searchSerial.current;
    setLoading(true); setCatalogError('');
    try {
      const result = await catalog(query, append ? papers.length : 0);
      if (serial !== searchSerial.current) return;
      setPapers(old => append ? [...old, ...result.papers.filter(p => !old.some(o => o.id === p.id))] : result.papers);
      setKnown(old => ({ ...old, ...Object.fromEntries(result.papers.map(p => [p.id, p])) }));
      setMore(result.more); setConnected(true);
    } catch (error) { if (serial === searchSerial.current) setCatalogError(problem(error)); }
    finally { if (serial === searchSerial.current) setLoading(false); }
  }
  async function refreshUploads() {
    const id = userRef.current?.id;
    if (!id) return;
    setLoading(true); setCatalogError('');
    try {
      const result = await api<{ papers: Paper[] }>('/api/private/uploads', { headers: { 'X-Margina-User': id } });
      if (userRef.current?.id !== id) return;
      setPapers(result.papers); setKnown(old => ({ ...old, ...Object.fromEntries(result.papers.map(p => [p.id, p])) })); setMore(false);
    } catch (error) { setCatalogError(problem(error)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refreshSession(); void listBooks().then(setCached).catch(error => notify(problem(error))); }, []);
  useEffect(() => {
    setActive(null); setPdfSource(undefined); setKnown(old => Object.fromEntries(Object.entries(old).filter(([, paper]) => paper.visibility !== 'private'))); setAccount(freshAccount()); setSyncError(''); setSyncing(false); setPaused(false);
    if (!accountId) return;
    let cancelled = false;
    void setting(`sync-paused:${accountId}`).then(value => { if (!cancelled) { setPaused(value === true); if (value !== true) void syncNow(accountId); } });
    void reloadAccount(accountId);
    return () => { cancelled = true; };
  }, [accountId]);
  useEffect(() => {
    if (view === 'catalog') { const timer = setTimeout(() => void refreshCatalog(), 200); return () => { clearTimeout(timer); searchSerial.current++; }; }
    if (view === 'uploads') void refreshUploads();
    else setLoading(false);
  }, [query, view, accountId]);
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    const missing = Object.keys(account.records).filter(id => !known[id]);
    // Resolve saved shelf metadata without downloading PDFs.
    void (async () => {
      for (const id of missing) {
        try { const paper = await getPaper(id); if (!cancelled) setKnown(old => ({ ...old, [id]: paper })); }
        catch { /* A cached copy can still be read after withdrawal or offline. */ }
      }
    })();
    return () => { cancelled = true; };
  }, [accountId, account]);
  useEffect(() => {
    if (!accountId) return;
    setActive(book => {
      const data = book && account.records[book.id]?.data;
      return book && data ? { ...book, annotations: data.annotations, bookmarks: data.bookmarks, starred: data.starred } : book;
    });
  }, [accountId, account]);
  useEffect(() => {
    if (!accountId) return;
    let timer: ReturnType<typeof setTimeout>;
    const changed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail.user !== accountId) return;
      void reloadAccount(accountId);
      if (detail.edited && !paused) { clearTimeout(timer); timer = setTimeout(() => void syncNow(accountId), 1800); }
    };
    const resume = async () => {
      if (document.visibilityState === 'hidden') return;
      const next = await refreshSession();
      if (next?.user?.id === accountId && !paused) void syncNow(accountId);
    };
    window.addEventListener('margina-account', changed);
    window.addEventListener('online', resume); document.addEventListener('visibilitychange', resume);
    return () => { clearTimeout(timer); window.removeEventListener('margina-account', changed); window.removeEventListener('online', resume); document.removeEventListener('visibilitychange', resume); };
  }, [accountId, paused]);
  useEffect(() => {
    if (!accountId || paused || syncing || !syncError || retryCount.current > 3 || !navigator.onLine) return;
    const timer = setTimeout(() => void syncNow(accountId), Math.min(60000, 5000 * 2 ** retryCount.current));
    return () => clearTimeout(timer);
  }, [accountId, paused, syncing, syncError]);

  async function run(label: string, action: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(label);
    try { await action(); } catch (error) { notify(problem(error)); }
    finally { setBusy(''); actionLock.current = false; }
  }
  async function openPaper(paper: Paper) {
    await run('正在打开文献…', async () => {
      const id = userRef.current?.id;
      if (paper.visibility === 'private' && (paper.privateOwner !== id && !userRef.current?.admin)) throw new Error('请登录上传此文件的账号');
      let book: Book;
      let source: PdfSource;
      try { ({ book, source } = await cachePaper(paper)); }
      catch (error) {
        const local = await getBook(paper.id);
        const bytes = local && await readCachedPdf(local);
        if (!local || !bytes || (local.privateOwner && local.privateOwner !== id && !userRef.current?.admin)) throw error;
        book = local; source = { bytes };
        notify('正在阅读本机缓存，未能获取最新阅读包。');
      }
      if (userRef.current?.id !== id) return;
      setCached(current => [...current.filter(item => item.id !== book.id), book]);
      if (id) {
        await editReading(id, book.id, { opened: Date.now() });
        const state = await readAccount(id);
        if (userRef.current?.id !== id) return;
        setPdfSource(source);
        setActive({ ...book, ...state.records[book.id].data });
      } else {
        await patchBook(book.id, { opened: Date.now() });
        if (userRef.current?.id !== id) return;
        setPdfSource(source); setActive({ ...book, opened: Date.now() });
      }
    });
  }
  async function reloadActivePdf() {
    const activeBook = activeRef.current;
    if (!activeBook) return;
    const userId = userRef.current?.id;
    await run('正在重新加载…', async () => {
      const { book, source } = await cachePaper(await getPaper(activeBook.id), true);
      if (userRef.current?.id !== userId || activeRef.current?.id !== activeBook.id) return;
      setPdfSource(source);
      setActive(current => current?.id === book.id ? { ...current, blob: book.blob, cover: book.cover } : current);
    });
  }
  async function updateReading(patch: Partial<Book>) {
    const book = activeRef.current;
    if (!book) return;
    try {
      const id = userRef.current?.id;
      if (id) {
        const data: Partial<ReadingData> = {};
        if (patch.page !== undefined) data.page = patch.page;
        if (patch.opened !== undefined) data.opened = patch.opened;
        if (patch.annotations !== undefined) data.annotations = patch.annotations;
        if (patch.bookmarks !== undefined) data.bookmarks = patch.bookmarks;
        if (patch.starred !== undefined) data.starred = patch.starred;
        await editReading(id, book.id, data);
      } else await patchBook(book.id, patch);
      if (userRef.current?.id === id) setActive(old => old?.id === book.id ? { ...old, ...patch } : old);
    } catch (error) { notify('保存失败，请导出笔记并检查本机存储空间。'); throw error; }
  }
  async function addToShelf(paper: Paper) {
    if (!userRef.current) { setLogin(true); return; }
    const id = userRef.current.id;
    await run('正在加入书架…', async () => { await editReading(id, paper.id, { shelf: true }); notify('已加入我的书架'); });
  }
  async function doUpload() {
    const user = userRef.current;
    if (!user) { setLogin(true); return; }
    if ((uploadVisibility === 'public' && !publicConsent) || !files.length) return;
    await run('正在上传到书库…', async () => {
      const failures: string[] = []; let count = 0;
      for (const file of [...files.filter(f => /\.(pdf|txt)$/i.test(f.name)), ...files.filter(f => /\.json$/i.test(f.name))]) {
        setBusy(`正在上传 ${file.name}…`);
        try {
          if (/\.(pdf|txt)$/i.test(file.name)) {
            if (file.size > 100 * 1024 * 1024) throw new Error('PDF 不能超过 100 MB');
            const book = await (/\.txt$/i.test(file.name) ? makeTxtBook : makeBook)(file, file.name);
            const result = await uploadPdf(book, user.id, uploadVisibility);
            setKnown(old => ({ ...old, [result.paper.id]: result.paper }));
            await editReading(user.id, result.paper.id, { shelf: true });
          } else {
            const result = await uploadBundle(file, user.id, uploadVisibility);
            setKnown(old => ({ ...old, [result.paper.id]: result.paper }));
          }
          count++;
        } catch (error) { failures.push(`${file.name}：${problem(error)}`); }
      }
      if (count) setAdminRevision(old => old + 1);
      if (!failures.length) { setUpload(false); setFiles([]); setPublicConsent(false); }
      notify([count ? `已处理 ${count} 个文件` : '', ...failures].filter(Boolean).join('；'));
      if (view === 'uploads') await refreshUploads(); else if (uploadVisibility === 'private') setView('shelf'); else { setView('catalog'); await refreshCatalog(); }
    });
  }
  async function localLogin(name: string) {
    await run('正在切换测试账号…', async () => {
      await api('/api/dev/login', jsonOptions('POST', { name }));
      await refreshSession(); setLogin(false); setSettings(false); notify('已登录本地测试账号');
    });
  }
  async function logout() {
    setActive(null); setAccount(freshAccount()); setSettings(false);
    if (current.local) { await api('/api/dev/logout', jsonOptions('POST', {})); await refreshSession(); }
    else window.location.assign('/cdn-cgi/access/logout');
  }
  async function mergeGuest() {
    const user = userRef.current; if (!user) return;
    await run('正在合并本机阅读记录…', async () => {
      let count = 0;
      for (const book of (await listBooks()).filter(b => !b.privateOwner)) {
        if (!book.opened && !book.annotations.length && !book.bookmarks.length) continue;
        try { await getPaper(book.id); } catch { continue; }
        const state = await readAccount(user.id);
        const merged = mergeReading(emptyReading(), { ...emptyReading(), shelf: true, page: book.page, opened: book.opened, bookmarks: book.bookmarks, annotations: book.annotations, starred: book.starred }, state.records[book.id]?.data || emptyReading());
        await editReading(user.id, book.id, merged); count++;
      }
      notify(`已合并 ${count} 篇文献的本机记录；未上传到书库的文献仍只在本机。`);
    });
  }

  if (localLibrary) return <><div className="local-return"><button onClick={() => { setLocalLibrary(false); void listBooks().then(setCached); }}><ArrowRight size={15} />返回公共书库</button><span>本机空间 · 文件不会自动公开</span></div><LocalLibrary /></>;
  const ownRecords = Object.entries(account.records);
  const listed = view === 'shelf' ? shelfIds.map(lookup).filter((p): p is Paper => !!p) : papers;
  const visible = view === 'catalog' ? listed : listed.filter(p => `${p.title} ${p.author}`.toLowerCase().includes(query.toLowerCase()));
  const titles = { catalog: '书库', shelf: '我的书架', notes: '我的笔记', uploads: '我的上传' };
  const navigate = (next: View) => { setView(next); setQuery(''); };
  const privateView = view !== 'catalog' && !current.user;
  const closeAdmin = () => { setAdminOpen(false); history.replaceState(null, '', '/'); void refreshCatalog(); };

  return <>
    {active ? <Reader key={`${accountId || 'guest'}:${active.id}`} book={active} pdfSource={pdfSource} onBack={() => { setActive(null); setPdfSource(undefined); void listBooks().then(setCached); }} onUpdate={updateReading} onReload={reloadActivePdf} notify={notify} /> :
      adminOpen ? current.user?.admin ? <AdminPanel key={accountId} user={current.user} revision={adminRevision} onClose={closeAdmin} onUpload={() => setUpload(true)} onChanged={() => { setKnown({}); void refreshCatalog(); }} /> : <main className="admin-shell"><button className="text-button" onClick={closeAdmin}><ArrowRight size={17} />返回书库</button><div className="empty-state"><h1>管理后台</h1>{current.user ? <p>需要管理员权限</p> : <button className="primary-button" onClick={() => setLogin(true)}>登录</button>}</div></main> :
      <div className="app-shell cloud-shell">
        <aside className="sidebar"><Logo /><nav aria-label="主导航">
          <button className={`nav-item ${view === 'catalog' ? 'active' : ''}`} onClick={() => navigate('catalog')}><Library size={19} />书库</button>
          <button className={`nav-item ${view === 'shelf' ? 'active' : ''}`} onClick={() => navigate('shelf')}><BookOpen size={19} />我的书架<span>{current.user ? shelfIds.length : ''}</span></button>
          <button className={`nav-item ${view === 'notes' ? 'active' : ''}`} onClick={() => navigate('notes')}><NotebookPen size={19} />我的笔记</button>
          <button className={`nav-item ${view === 'uploads' ? 'active' : ''}`} onClick={() => navigate('uploads')}><Upload size={19} />我的上传</button>
        </nav><div className="sidebar-bottom"><button className="nav-item" onClick={() => setSettings(true)}><Settings2 size={18} />设置与账号</button></div></aside>
        <main className="library-main">
          <header className="library-top"><div className="mobile-brand"><Logo small /></div><button className="local-pill" onClick={() => current.user ? setSettings(true) : setLogin(true)}>{current.user ? <><Cloud size={14} />{current.local ? '本地测试账号' : '已登录'}{dirty > 0 && ` · ${dirty} 待同步`}</> : <><User size={14} />登录</>}<ChevronRight size={13} /></button></header>
          <div className="library-content">
            <section className="intro"><div><h1>{titles[view]}</h1><p>{view === 'catalog' ? '自由浏览与阅读，把喜欢的文献加入自己的书架。' : view === 'shelf' ? '你的收藏与阅读进度，登录后可在不同设备间同步。' : view === 'notes' ? '' : '管理你上传的公开与私密文献。'}</p></div><button className="primary-button import-button" disabled={!!busy} onClick={() => current.user ? setUpload(true) : setLogin(true)}><Plus size={18} />上传</button></section>
            {current.local && <div className="cloud-notice"><span className="status-dot" /><span>本地预览 · 文件与测试账号仅在这台电脑的预览服务中保存</span></div>}
            {current.user && (dirty > 0 || syncError) && <div className="cloud-notice" role="status"><span>{syncError || `${dirty} 篇文献有待同步的个人记录${paused ? '，自动同步已暂停' : ''}`}</span><button className="text-button" disabled={syncing} onClick={() => void syncNow()}><RefreshCw size={14} className={syncing ? 'spin' : ''} />{syncing ? '同步中' : '重试同步'}</button></div>}
            {privateView ? <div className="empty-state"><BookOpen size={32} /><h3>登录后拥有自己的书架</h3><p>公开书库无需登录即可阅读。收藏、上传和跨设备同步需要登录。</p><button className="primary-button" onClick={() => setLogin(true)}>登录</button></div> : <>
              {view !== 'notes' && <div className="collection-controls"><label className="search cloud-search"><Search size={17} /><input aria-label="搜索书库" placeholder="搜索标题、作者…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="icon-button" aria-label="清空搜索" onClick={() => setQuery('')}><X size={15} /></button>}</label><button className="text-button" onClick={() => view === 'uploads' ? void refreshUploads() : view === 'catalog' ? void refreshCatalog() : void syncNow()} disabled={loading || syncing}><RefreshCw size={15} />刷新</button></div>}
              {catalogError && (view === 'catalog' || view === 'uploads') && <div className="cloud-error" role="alert"><p>{catalogError}</p><button className="secondary-button" onClick={() => view === 'uploads' ? void refreshUploads() : void refreshCatalog()}>重新连接</button><button className="text-button" onClick={() => setLocalLibrary(true)}>打开本机文献</button></div>}
              {view === 'notes' ? <><div className="section-heading"><h2>{ownRecords.reduce((n, [, r]) => n + r.data.annotations.length, 0)} 条笔记</h2><button className="text-button" onClick={() => saveFile(ownRecords.map(([id, record]) => notesMarkdown({ title: lookup(id)?.title || '文献', annotations: record.data.annotations } as Book)).join('\n\n---\n\n'), 'Margina-我的笔记.md')}><ArrowDownToLine size={16} />导出</button></div><div className="all-notes">{ownRecords.flatMap(([id, record]) => record.data.annotations.map(note => <article className="global-note" key={`${id}:${note.id}`}><button className="note-source" onClick={() => { const p = lookup(id); if (p) void openPaper(p); }}>{lookup(id)?.title || '文献记录'} · 第 {note.page} 页<ArrowRight size={14} /></button>{note.quote && <blockquote>{note.quote}</blockquote>}{note.text && <p>{note.text}</p>}<div className="note-copy"><CopyButton text={[note.quote, note.text].filter(Boolean).join('\n\n')} onError={() => notify('复制失败，请重试')} /></div></article>))}</div>{!ownRecords.some(([, r]) => r.data.annotations.length) && <Empty text="还没有笔记，打开文献选中文字即可记录。" />}</> : loading && !visible.length ? <div className="loading-state"><LoaderCircle className="spin" /><p>正在打开书库…</p></div> : <>
                <div className="book-grid">{visible.map(paper => {
                  const data = personalData(paper.id); const cache = cached.find(b => b.id === paper.id);
                  return <article className="book-card" key={paper.id}>
                    <button className="book-cover public-cover" aria-label={`阅读 ${paper.title}`} disabled={!!busy || (paper.removed && !cache)} onClick={() => void openPaper(paper)}><div className="cover-top"><span>{paper.removed ? '已撤下' : paper.visibility === 'private' ? '私密' : paper.format === 'txt' ? 'TXT 文本' : paper.bilingual ? '中英对照' : 'PDF 文献'}</span></div>{cache ? <div className="paper-thumbnail"><img src={cache.cover} alt="" /></div> : <div className="typographic-cover"><BookOpen size={28} strokeWidth={1.2} /><strong>{paper.title}</strong><span>{paper.author || 'Margina 书库'}</span></div>}<div className="cover-bottom"><span>{paper.format === 'txt' ? 'TXT 阅读' : paper.hasBundle ? 'PDF + 段落阅读' : '原版 PDF'}</span><span>{paper.pages} 页</span></div></button>
                    <div className="book-info"><button className="book-title" onClick={() => void openPaper(paper)} disabled={!!busy || (paper.removed && !cache)}>{paper.title}</button><p className="book-author">{paper.author || paper.fileName}</p><div className="book-meta"><span>{sizeLabel(paper.size)}</span><span>{data.opened ? `读至第 ${data.page} 页` : '尚未阅读'}</span></div><div className="public-card-actions"><button className={`secondary-button ${data.shelf ? 'on-shelf' : ''}`} disabled={!!busy || (paper.removed && !data.shelf)} onClick={() => data.shelf ? setRemoveShelf(paper) : void addToShelf(paper)}>{data.shelf ? <Check size={15} /> : <Plus size={15} />}{data.shelf ? '已加入书架' : '加入书架'}</button>{view === 'uploads' && !paper.removed && <button className="icon-button" aria-label={`撤下 ${paper.title}`} onClick={() => setWithdraw(paper)}><Trash2 size={16} /></button>}</div>{data.opened > 0 && <div className="progress-track"><div style={{ width: `${data.page / paper.pages * 100}%` }} /></div>}</div>
                  </article>;
                })}</div>
                {!visible.length && !catalogError && <Empty text={query ? '没有找到匹配的文献。' : view === 'shelf' ? '书架还是空的，去书库挑选想读的文献吧。' : view === 'uploads' ? '你还没有上传文献。' : '书库还是空的，登录后分享第一篇文献。'} />}
                {more && view === 'catalog' && <button className="wide-button" disabled={loading} onClick={() => void refreshCatalog(true)}>{loading ? '正在加载…' : '加载更多'}</button>}
                {view === 'shelf' && shelfIds.some(id => !lookup(id)) && <p className="fineprint">部分文献暂时不可用，个人记录仍保留，可稍后重试同步。</p>}
              </>}
            </>}
          </div>
          <nav className="mobile-nav" aria-label="手机导航"><button className={view === 'catalog' ? 'active' : ''} onClick={() => navigate('catalog')}><Library size={21} />书库</button><button className={view === 'shelf' ? 'active' : ''} onClick={() => navigate('shelf')}><BookOpen size={21} />书架</button><button className={view === 'notes' ? 'active' : ''} onClick={() => navigate('notes')}><NotebookPen size={21} />笔记</button><button onClick={() => setSettings(true)}><Settings2 size={21} />设置</button></nav>
        </main>
      </div>}
    {message && <div className="toast" role="status"><span>{message}</span><button aria-label="关闭提示" onClick={() => setMessage('')}><X size={16} /></button></div>}
    {busy && <div className="busy-toast" role="status"><LoaderCircle size={17} className="spin" />{busy}</div>}
    {login && <Modal title="登录 Margina" close={() => setLogin(false)}><p>登录后可上传文献、收藏到书架，并同步自己的阅读记录。书库始终可以直接阅读。</p>{current.local ? <><div className="cloud-notice">本地测试身份，不是真实云端账号。</div><button className="wide-button" disabled={!!busy} onClick={() => void localLogin('alice')}><User size={17} />使用测试账号 A</button><button className="wide-button" disabled={!!busy} onClick={() => void localLogin('bob')}><User size={17} />使用测试账号 B</button></> : current.loginAvailable ? <a className="wide-button primary-button" href={adminOpen ? '/api/private/login?next=/admin' : '/api/private/login'}><LogIn size={17} />通过邮箱登录</a> : <p>账号服务尚未配置。请启动本地书库预览服务，或在部署时配置 Cloudflare Access。</p>}</Modal>}
    {upload && <Modal title="上传文献" close={() => !busy && setUpload(false)}><label className="upload-picker">选择 PDF / TXT / JSON 文件<input type="file" accept=".pdf,.txt,.json" multiple disabled={!!busy} onChange={event => { setFiles(Array.from(event.target.files || []).filter(file => /\.(pdf|txt|json)$/i.test(file.name))); setPublicConsent(false); }} /></label><ul className="upload-file-list">{files.map((file, index) => <li key={index}><span>{file.name}</span><small>{sizeLabel(file.size)}</small></li>)}</ul><fieldset className="upload-visibility" disabled={!!busy}><legend>可见范围</legend><label><input type="radio" name="visibility" checked={uploadVisibility === 'private'} onChange={() => { setUploadVisibility('private'); setPublicConsent(false); }} />仅自己可见</label><label><input type="radio" name="visibility" checked={uploadVisibility === 'public'} onChange={() => setUploadVisibility('public')} />公开到书库</label></fieldset><p className="fineprint">PDF ≤ 100 MB · TXT ≤ 10 MB · JSON ≤ 20 MB</p>{uploadVisibility === 'public' && <label className="consent"><input type="checkbox" checked={publicConsent} disabled={!!busy} onChange={event => setPublicConsent(event.target.checked)} /><span>我确认有权公开分享这些文件。</span></label>}<button className="wide-button primary-button" disabled={!files.length || (uploadVisibility === 'public' && !publicConsent) || !!busy} onClick={() => void doUpload()}><Upload size={17} />{busy ? '正在处理…' : uploadVisibility === 'private' ? '私密上传' : '公开上传'}</button></Modal>}
    {settings && <Modal title="设置与账号" close={() => setSettings(false)}><div className="storage-row"><span>当前身份</span><strong>{current.user?.email || '游客'}</strong></div><div className="storage-row"><span>同步服务</span><strong>{connected ? current.local ? '本地测试服务' : '已连接' : '未连接'}</strong></div>{current.user ? <><div className="storage-row"><span>最近成功同步</span><strong>{account.lastSynced ? new Date(account.lastSynced).toLocaleString('zh-CN') : '尚未同步'}</strong></div><p>{syncError || (dirty ? `${dirty} 篇文献的修改待同步，已保存在本机。` : '')}</p><button className="wide-button" disabled={syncing} onClick={() => void syncNow()}><RefreshCw size={17} className={syncing ? 'spin' : ''} />立即同步</button><label className="consent"><input type="checkbox" checked={paused} onChange={event => { const next = event.target.checked; setPaused(next); void setting(`sync-paused:${accountId}`, next); if (!next) void syncNow(); }} />暂停自动同步</label>{current.user.admin && <button className="wide-button" onClick={() => { setSettings(false); setAdminOpen(true); history.replaceState(null, '', '/admin'); }}>管理后台</button>}<button className="wide-button" onClick={() => { setSettings(false); navigate('uploads'); }}><Upload size={17} />管理我的上传</button><button className="wide-button" disabled={!!busy} onClick={() => void mergeGuest()}>合并此浏览器的游客阅读记录</button><p className="fineprint">只合并公共书库中已有文献的记录。本机 PDF 不会因此上传。</p><button className="wide-button" disabled={!!busy || syncing} onClick={() => void run('正在退出…', logout)}>退出登录</button>{current.local && <button className="text-button" onClick={() => { setSettings(false); setLogin(true); }}>切换测试账号</button>}</> : <button className="wide-button" onClick={() => { setSettings(false); setLogin(true); }}><LogIn size={17} />登录</button>}<button className="wide-button" onClick={() => { setSettings(false); setLocalLibrary(true); }}><FolderOpen size={17} />本机文献与导入</button><p className="fineprint">本机空间保留原有文献与笔记。清理网站数据会删除本机缓存及尚未同步的记录。</p></Modal>}
    {removeShelf && <Modal title="从我的书架移除？" close={() => setRemoveShelf(null)}><p>「{removeShelf.title}」的个人笔记和进度会保留，公共书库中的文件不受影响。</p><button className="wide-button" onClick={() => void run('正在移出书架…', async () => { if (accountId) await editReading(accountId, removeShelf.id, { shelf: false }); setRemoveShelf(null); })}>移出书架</button></Modal>}
    {withdraw && <Modal title={withdraw.visibility === 'private' ? '撤下这份私密文献？' : '从公共书库撤下？'} close={() => setWithdraw(null)}><p>「{withdraw.title}」将停止浏览与下载，个人笔记仍保留。</p><button className="wide-button danger-button" disabled={!!busy} onClick={() => void run('正在撤下文献…', async () => { await api(`/api/private/papers/${withdraw.id}`, { method: 'DELETE', headers: { 'X-Margina-User': accountId || '' } }); setWithdraw(null); await refreshUploads(); })}>确认撤下</button></Modal>}
  </>;
}
function Empty({ text }: { text: string }) { return <div className="empty-state"><BookOpen size={32} /><h3>{text}</h3></div>; }
function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key === 'Tab') {
        const targets = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]') || []);
        const first = targets[0], last = targets.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop"><section ref={ref} tabIndex={-1} className="modal cloud-modal" role="dialog" aria-modal="true" aria-label={title}><button className="icon-button modal-close" aria-label="关闭弹窗" onClick={close}><X size={20} /></button><h2>{title}</h2>{children}</section></div>;
}
