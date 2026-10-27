import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, BookOpen, Check, ChevronRight, Cloud, FolderOpen, FolderPlus, LockKeyhole, Pencil, Library, LoaderCircle, LogIn, NotebookPen, Plus, RefreshCw, Search, Settings2, Trash2, Upload, User, X } from 'lucide-react';
import type { Book } from './types';
import type { AccountState, CatalogFolder, Paper, ReadingData, Session } from './cloud-types';
import { emptyReading } from './cloud-types';
import { api, cachePaper, catalog, getPaper, jsonOptions, session, uploadBundle, uploadPdf } from './cloud-api';
import { readCachedPdf, type PdfSource } from './pdf-source';
import { editReading, readAccount, syncAccount } from './sync';
import { getBook, listBooks, patchBook, saveFile, setting } from './storage';
import { makeBook } from './pdf';
import { makeTxtBook } from './txt-book';
import Reader from './Reader';
import AdminPanel from './AdminPanel';
import AuthForm from './AuthForm';
import { Logo } from './LocalLibrary';
import BookNotes, { NoteCount } from './BookNotes';
import ShelfRating from './ShelfRating';
import { useShelf, type ShelfFolder } from './useShelf';
import { bookLocked } from './shelf-lock';
import { FolderEditor, FolderUnlock, ShelfBookEditor } from './ShelfDialogs';
import { CatalogFolderEditor, UploadFolderPicker } from './CatalogFolders';
import PaperCover from './PaperCover';
import { usePaperMetadata } from './usePaperMetadata';
import { createReaderNavigation, type ReaderEntry } from './reader-navigation';
import './cloud.css';

type View = 'catalog' | 'shelf' | 'notes' | 'uploads';
type ReaderOrigin = { notesBookId: string | null; paper: Paper; owner?: string; view: View; query: string; folderId: string | null; catalogFolderId: string | null; papers: Paper[]; more: boolean; scroll: number };
const sizeLabel = (size: number) => `${(size / 1024 / 1024).toFixed(1)} MB`;
const problem = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试';
const freshAccount = (): AccountState => ({ cursor: 0, records: {}, lastSynced: 0 });
const paperFromBook = (b: Book): Paper => ({ id: b.id, format: b.format, contentHash: b.contentHash, visibility: b.privateOwner ? 'private' : 'public', privateOwner: b.privateOwner, title: b.title, author: b.author, fileName: b.fileName, size: b.size, pages: b.pages, bilingual: b.bilingual, hasBundle: !!b.bundle, created: b.added, updated: b.added, removed: false });

export default function App() {
  const [adminOpen, setAdminOpen] = useState(location.pathname === '/admin');
  const [adminRevision, setAdminRevision] = useState(0);
  const [current, setCurrent] = useState<Session>({ user: null, local: false, loginAvailable: false });
  const [connected, setConnected] = useState(false);
  const [account, setAccount] = useState<AccountState>(freshAccount);
  const [view, setView] = useState<View>('shelf');
  const [notesBookId, setNotesBookId] = useState<string | null>(null);
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
  const [login, setLogin] = useState(new URLSearchParams(location.search).get('auth') === 'setup');
  const [upload, setUpload] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [publicConsent, setPublicConsent] = useState(false);
  const [uploadVisibility, setUploadVisibility] = useState<'private' | 'public'>('private');
  const [catalogFolders, setCatalogFolders] = useState<CatalogFolder[]>([]);
  const [catalogFoldersReady, setCatalogFoldersReady] = useState(false);
  const [catalogFoldersError, setCatalogFoldersError] = useState('');
  const catalogFoldersSerial = useRef(0);
  const [catalogFolderId, setCatalogFolderId] = useState<string | null>(null);
  const [catalogEditor, setCatalogEditor] = useState<CatalogFolder | 'new' | null>(null);
  const [catalogDelete, setCatalogDelete] = useState<CatalogFolder | null>(null);
  const [catalogMove, setCatalogMove] = useState<Paper | null>(null);
  const [moveDestination, setMoveDestination] = useState('');
  const [uploadCatalogFolder, setUploadCatalogFolder] = useState('');
  const [uploadShelfFolder, setUploadShelfFolder] = useState('');
  const catalogFolder = catalogFolders.find(f => f.id === catalogFolderId);
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
  const shelf = useShelf(accountId);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folderEditor, setFolderEditor] = useState<ShelfFolder | 'new' | null>(null);
  const [unlockFolder, setUnlockFolder] = useState<ShelfFolder | null>(null);
  const [deleteFolder, setDeleteFolder] = useState<ShelfFolder | null>(null);
  const [editBook, setEditBook] = useState<Paper | null>(null);
  const [ratingBook, setRatingBook] = useState<Paper | null>(null);
  const folder = shelf.folders.find(f => f.id === folderId);
  const dirty = Object.values(account.records).filter(r => r.dirty).length;
  const shelfIds = Object.keys(account.records).filter(id => account.records[id].data.shelf)
    .sort((a, b) => (account.records[b].data.rating ?? 0) - (account.records[a].data.rating ?? 0) || account.records[b].data.opened - account.records[a].data.opened || a.localeCompare(b));
  const personalData = (id: string) => account.records[id]?.data || emptyReading();
  const metadata = usePaperMetadata(accountId, shelf.ready ? Object.keys(account.records).filter(id => !shelf.locked(id)) : []);
  const lookup = (id: string): Paper | undefined => {
    const local = cached.find(b => b.id === id && (!b.privateOwner || b.privateOwner === accountId || current.user?.admin));
    const paper = metadata.papers[id] || known[id] || (local && paperFromBook(local));
    if (!paper || (paper.visibility === 'private' && (!accountId || shelf.locked(id) || (paper.privateOwner !== accountId && !current.user?.admin)))) return undefined;
    return metadata.status[id] === 'unavailable' ? { ...paper, removed: true } : paper;
  };
  const notify = (text: string) => setMessage(text);
  const navigation = useRef<ReturnType<typeof createReaderNavigation<ReaderOrigin>> | null>(null);
  const openingSerial = useRef(0);
  const [returnScroll, setReturnScroll] = useState<{ y: number } | null>(null);
  const restoredListing = useRef(false);
  const onHistory = useRef<(entry: ReaderEntry<ReaderOrigin>) => void>(() => {});
  onHistory.current = entry => {
    openingSerial.current++;
    actionLock.current = false;
    setBusy(''); setActive(null); setPdfSource(undefined);
    const origin = entry.data;
    if (!origin || origin.owner !== userRef.current?.id) return;
    if (view !== origin.view || query !== origin.query || catalogFolderId !== origin.catalogFolderId) restoredListing.current = true;
    setView(origin.view); setNotesBookId(origin.notesBookId); setQuery(origin.query); setFolderId(origin.folderId); setCatalogFolderId(origin.catalogFolderId);
    setPapers(origin.papers); setMore(origin.more); setLoading(false);
    if (entry.kind === 'reader') void openPaper(origin.paper, entry.ticket);
    else {
      setReturnScroll({ y: origin.scroll });
      void listBooks().then(setCached).catch(() => {});
    }
  };
  useEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    const controller = createReaderNavigation<ReaderOrigin>(window, entry => onHistory.current(entry));
    navigation.current = controller;
    return () => { controller.dispose(); navigation.current = null; history.scrollRestoration = previous; };
  }, []);
  useLayoutEffect(() => {
    if (active) { window.scrollTo(0, 0); return; }
    if (!returnScroll) return;
    window.scrollTo(0, returnScroll.y);
    const frame = requestAnimationFrame(() => window.scrollTo(0, returnScroll.y));
    return () => cancelAnimationFrame(frame);
  }, [active?.id, returnScroll]);

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
    try { await shelf.refresh(); if (userRef.current?.id !== id) return; await syncAccount(id); if (userRef.current?.id === id) { setSyncError(''); retryCount.current = 0; } }
    catch (error) { if (userRef.current?.id === id) { setSyncError(problem(error)); retryCount.current++; } }
    finally { if (userRef.current?.id === id) { await reloadAccount(id); setSyncing(false); } }
  }
  async function refreshCatalog(append = false) {
    const serial = ++searchSerial.current;
    setLoading(true); setCatalogError('');
    try {
      const result = await catalog(query, append ? papers.length : 0, catalogFolderId || (query ? undefined : null));
      if (serial !== searchSerial.current) return;
      setPapers(old => append ? [...old, ...result.papers.filter(p => !old.some(o => o.id === p.id))] : result.papers);
      setKnown(old => ({ ...old, ...Object.fromEntries(result.papers.map(p => [p.id, p])) }));
      setMore(result.more); setConnected(true);
    } catch (error) { if (serial === searchSerial.current) setCatalogError(problem(error)); }
    finally { if (serial === searchSerial.current) setLoading(false); }
  }
  async function refreshCatalogFolders() {
    const serial = ++catalogFoldersSerial.current;
    const user = userRef.current?.id;
    try {
      const result = await api<{ folders: CatalogFolder[] }>('/api/catalog/folders');
      if (serial !== catalogFoldersSerial.current || userRef.current?.id !== user) return;
      setCatalogFolders(result.folders); setCatalogFoldersReady(true); setCatalogFoldersError('');
      setCatalogFolderId(id => id && !result.folders.some(f => f.id === id) ? null : id);
    } catch (error) {
      if (serial === catalogFoldersSerial.current && userRef.current?.id === user) { setCatalogFoldersReady(false); setCatalogFoldersError(problem(error)); }
    }
  }
  async function catalogMutation(path: string, method: string, body?: unknown) {
    const id = userRef.current?.id;
    if (!id) throw new Error('请先登录');
    const options = body === undefined ? { method } : jsonOptions(method, body);
    const result = await api<{ id?: string }>(`/api/private/catalog${path}`, { ...options, headers: { ...options.headers, 'X-Margina-User': id } });
    await refreshCatalogFolders();
    return result;
  }
  function openUpload() {
    if (!current.user) { setLogin(true); return; }
    setUploadCatalogFolder(view === 'catalog' ? catalogFolderId || '' : '');
    setUploadShelfFolder(view === 'shelf' ? folderId || '' : '');
    setPublicConsent(false); setUpload(true);
  }
  function openCatalogMove(paper: Paper) {
    setCatalogMove(paper); setMoveDestination(paper.catalogFolderId || '');
    setCatalogFoldersReady(false); void refreshCatalogFolders();
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
    openingSerial.current++; navigation.current?.reset(); restoredListing.current = false; setReturnScroll(null); setNotesBookId(null); setBusy(''); actionLock.current = false;
    setUpload(false); setFiles([]); setUploadCatalogFolder(''); setUploadShelfFolder('');
    setCatalogEditor(null); setCatalogDelete(null); setCatalogMove(null);
    setCatalogFoldersReady(false); setCatalogFolders([]); catalogFoldersSerial.current++;
    setFolderId(null); setFolderEditor(null); setUnlockFolder(null); setEditBook(null); setRatingBook(null); setDeleteFolder(null);
    setActive(null); setPdfSource(undefined); setKnown(old => Object.fromEntries(Object.entries(old).filter(([, paper]) => paper.visibility !== 'private'))); setAccount(freshAccount()); setSyncError(''); setSyncing(false); setPaused(false);
    if (!accountId) return;
    let cancelled = false;
    void setting(`sync-paused:${accountId}`).then(value => { if (!cancelled) { setPaused(value === true); if (value !== true) void syncNow(accountId); } });
    void reloadAccount(accountId);
    return () => { cancelled = true; };
  }, [accountId]);
  useEffect(() => {
    if (view === 'catalog' || view === 'uploads' || upload || adminOpen) void refreshCatalogFolders();
    if (upload && accountId) void shelf.refresh().catch(() => {});
  }, [view, upload, accountId, adminOpen]);
  useEffect(() => {
    if (restoredListing.current) { restoredListing.current = false; return; }
    if (view === 'catalog') { setPapers([]); setMore(false); setLoading(true); const timer = setTimeout(() => void refreshCatalog(), 200); return () => { clearTimeout(timer); searchSerial.current++; }; }
    if (view === 'uploads') void refreshUploads();
    else setLoading(false);
  }, [query, view, accountId, catalogFolderId]);
  useEffect(() => {
    if (accountId && active && shelf.locked(active.id)) { navigation.current?.back(); setActive(null); setPdfSource(undefined); }
    if (folder && folder.locked) setFolderId(null);
    if (editBook && shelf.locked(editBook.id)) setEditBook(null);
    if (ratingBook && shelf.locked(ratingBook.id)) setRatingBook(null);
  }, [shelf.ready, shelf.folders, shelf.items]);
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
    if (actionLock.current) return false;
    actionLock.current = true; setBusy(label);
    try { await action(); return true; } catch (error) { notify(problem(error)); return false; }
    finally { setBusy(''); actionLock.current = false; }
  }
  async function openPaper(paper: Paper, restoredTicket?: number, notePage?: number) {
    if (restoredTicket === undefined && actionLock.current) return;
    const id = userRef.current?.id;
    const ticket = restoredTicket ?? navigation.current?.enter({ notesBookId, paper, owner: id, view, query, folderId, catalogFolderId, papers, more, scroll: window.scrollY });
    if (ticket === undefined) return;
    const serial = ++openingSerial.current;
    const valid = () => serial === openingSerial.current && navigation.current?.isCurrent(ticket) && userRef.current?.id === id;
    actionLock.current = true; setBusy('正在打开文献…'); setReturnScroll(null);
    try {
      let remark = '';
      if (id) {
        const next = await shelf.refresh();
        if (!valid()) return;
        if (!next) throw new Error('无法读取书架，请重试');
        remark = next.items.find(i => i.bookId === paper.id)?.remark || '';
        if (bookLocked(paper.id)) {
          const target = next.folders.find(f => f.id === next.items.find(i => i.bookId === paper.id)?.folderId);
          if (target) setUnlockFolder(target);
          navigation.current?.back(); return;
        }
      }
      if (paper.visibility === 'private' && (paper.privateOwner !== id && !userRef.current?.admin)) throw new Error('请登录上传此文件的账号');
      let book: Book;
      let source: PdfSource;
      try { ({ book, source } = await cachePaper(paper)); }
      catch (error) {
        if (!valid()) return;
        const local = await getBook(paper.id);
        const bytes = local && await readCachedPdf(local);
        if (!valid()) return;
        if (!local || !bytes || (local.privateOwner && local.privateOwner !== id && !userRef.current?.admin)) throw error;
        book = local; source = { bytes };
        notify('正在阅读本机缓存，未能获取最新阅读包。');
      }
      if (!valid()) return;
      if (id && bookLocked(paper.id)) { navigation.current?.back(); return; }
      const pagePatch = notePage === undefined ? {} : { page: Math.max(1, Math.min(book.pages, notePage)) };
      setCached(current => [...current.filter(item => item.id !== book.id), book]);
      if (id) {
        await editReading(id, book.id, { opened: Date.now(), ...pagePatch });
        const state = await readAccount(id);
        if (!valid()) return;
        setPdfSource(source);
        setAccount(state); setActive({ ...book, ...state.records[book.id].data, title: remark || book.title });
      } else {
        await patchBook(book.id, { opened: Date.now(), ...pagePatch });
        if (!valid()) return;
        setPdfSource(source); setActive({ ...book, opened: Date.now(), ...pagePatch });
      }
    } catch (error) {
      if (valid()) { notify(problem(error)); navigation.current?.back(); }
    } finally {
      if (serial === openingSerial.current) { setBusy(''); actionLock.current = false; }
    }
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
        if (bookLocked(book.id)) throw new Error('请先解锁文件夹');
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
    await run('正在加入书架…', async () => { await shelf.refresh(); if (bookLocked(paper.id)) throw new Error('请先解锁文件夹'); await editReading(id, paper.id, { shelf: true }); notify('已加入我的书架'); });
  }
  async function rateBook(paper: Paper, rating: number) {
    const id = userRef.current?.id;
    if (!id) { setLogin(true); return false; }
    return run('正在保存评分…', async () => {
      if (bookLocked(paper.id)) throw new Error('请先解锁文件夹');
      await editReading(id, paper.id, { rating });
      await reloadAccount(id);
    });
  }
  async function doUpload() {
    const user = userRef.current;
    if (!user) { setLogin(true); return; }
    if ((uploadVisibility === 'public' && !publicConsent) || !files.length) return;
    await run('正在上传到书库…', async () => {
      const failures: string[] = []; let count = 0;
      const toFile: { id: string; name: string }[] = [];
      let keptLocation = false;
      if (uploadVisibility === 'public' && (!catalogFoldersReady || (uploadCatalogFolder && !catalogFolders.some(f => f.id === uploadCatalogFolder)))) throw new Error('请刷新并重新选择书库文件夹');
      if (uploadVisibility === 'private' && (!shelf.ready || (uploadShelfFolder && !shelf.folders.some(f => f.id === uploadShelfFolder)))) throw new Error('请刷新并重新选择书架文件夹');
      for (const file of [...files.filter(f => /\.(pdf|txt)$/i.test(f.name)), ...files.filter(f => /\.json$/i.test(f.name))]) {
        setBusy(`正在上传 ${file.name}…`);
        try {
          if (/\.(pdf|txt)$/i.test(file.name)) {
            if (file.size > 100 * 1024 * 1024) throw new Error('PDF 不能超过 100 MB');
            const book = await (/\.txt$/i.test(file.name) ? makeTxtBook : makeBook)(file, file.name);
            const result = await uploadPdf(book, user.id, uploadVisibility, uploadCatalogFolder);
            setKnown(old => ({ ...old, [result.paper.id]: result.paper }));
            await editReading(user.id, result.paper.id, { shelf: true });
            if (result.coverWarning) failures.push(`${file.name}：${result.coverWarning}`);
            if (uploadVisibility === 'private' && !toFile.some(item => item.id === result.paper.id)) toFile.push({ id: result.paper.id, name: file.name });
            if (result.duplicate && uploadVisibility === 'public' && (result.paper.catalogFolderId || '') !== uploadCatalogFolder) keptLocation = true;
          } else {
            const result = await uploadBundle(file, user.id, uploadVisibility);
            setKnown(old => ({ ...old, [result.paper.id]: result.paper }));
          }
          count++;
        } catch (error) { failures.push(`${file.name}：${problem(error)}`); }
      }
      // Finish bundles and persist reading records before a protected destination
      // locks the uploaded books. A failed classification remains retryable.
      if (toFile.length) {
        try {
          await syncAccount(user.id);
          for (const item of toFile) {
            try { await shelf.mutate(`/items/${item.id}`, 'PUT', { folderId: uploadShelfFolder || null, remark: shelf.item(item.id)?.remark || '' }); }
            catch (error) { failures.push(`${item.name} 已上传，归类失败：${problem(error)}`); }
          }
        } catch (error) { failures.push(`文件已上传，归类失败：${problem(error)}`); }
        await reloadAccount(user.id);
      }
      if (count) { setAdminRevision(old => old + 1); metadata.retry(); }
      if (!failures.length) { setUpload(false); setFiles([]); setPublicConsent(false); }
      notify([count ? `已处理 ${count} 个文件` : '', keptLocation ? '重复文献保留原书库位置，可在「我的上传」中调整归类' : '', ...failures].filter(Boolean).join('；'));
      await refreshCatalogFolders();
      if (view === 'uploads') await refreshUploads();
      else if (uploadVisibility === 'private') { setView('shelf'); setFolderId(shelf.folders.find(f => f.id === uploadShelfFolder)?.locked ? null : uploadShelfFolder || null); }
      else { setView('catalog'); setQuery(''); setCatalogFolderId(uploadCatalogFolder || null); await refreshCatalog(); }
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
    else if (current.passwordLogin) { await api('/api/auth/logout', jsonOptions('POST', {})); await refreshSession(); }
    else window.location.assign('/cdn-cgi/access/logout');
  }
  const ownRecords = Object.entries(account.records).filter(([id]) => !shelf.locked(id));
  const listed = view === 'shelf' ? shelfIds.filter(id => !shelf.locked(id) && (shelf.folders.some(f => f.id === shelf.item(id)?.folderId) ? shelf.item(id)?.folderId : null) === folderId).map(id => lookup(id) || { id, title: metadata.status[id] === 'unavailable' ? '文献已撤下或无权访问' : metadata.status[id] === 'error' ? '书籍信息加载失败' : '正在加载书籍信息…', author: '', fileName: '', size: 0, pages: personalData(id).page, bilingual: false, hasBundle: false, created: 0, updated: 0, removed: metadata.status[id] === 'unavailable' } as Paper) : papers;
  const visible = view === 'catalog' ? listed : listed.filter(p => !shelf.locked(p.id) && `${p.title} ${shelf.item(p.id)?.remark || ''} ${p.author}`.toLowerCase().includes(query.toLowerCase()));
  const titles = { catalog: '书库', shelf: '我的书架', notes: '我的笔记', uploads: '我的上传' };
  const navigate = (next: View) => { setView(next); setNotesBookId(null); setQuery(''); setFolderId(null); setCatalogFolderId(null); if (accountId) void shelf.refresh().catch(() => {}); };
  const privateView = view !== 'catalog' && !current.user;
  const closeAdmin = () => { setAdminOpen(false); history.replaceState(null, '', '/'); void refreshCatalog(); };

  return <>
    {active ? <Reader key={`${accountId || 'guest'}:${active.id}`} book={active} pdfSource={pdfSource} onBack={() => navigation.current?.back()} onUpdate={updateReading} onReload={reloadActivePdf} notify={notify} /> :
      adminOpen ? current.user?.admin ? <AdminPanel key={accountId} user={current.user} revision={adminRevision} onClose={closeAdmin} onUpload={openUpload} onOrganize={openCatalogMove} onChanged={() => { setKnown({}); metadata.retry(); void refreshCatalogFolders(); }} /> : <main className="admin-shell"><button className="text-button" onClick={closeAdmin}><ArrowRight size={17} />返回书库</button><div className="empty-state"><h1>管理后台</h1>{current.user ? <p>需要管理员权限</p> : <button className="primary-button" onClick={() => setLogin(true)}>登录</button>}</div></main> :
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
            <section className="intro"><div><h1>{titles[view]}</h1>{view !== 'notes' && <p>{view === 'catalog' ? '自由浏览与阅读，把喜欢的文献加入自己的书架。' : view === 'shelf' ? '你的收藏与阅读进度，登录后可在不同设备间同步。' : '管理你上传的公开与私密文献。'}</p>}</div>{view !== 'notes' && <div className="shelf-top-actions">{view === 'catalog' && current.user && <button className="secondary-button" disabled={!!busy || !catalogFoldersReady} onClick={() => setCatalogEditor('new')}><FolderPlus size={18} />新建文件夹</button>}{view === 'shelf' && current.user && <button className="secondary-button" disabled={!!busy || !shelf.ready} onClick={() => setFolderEditor('new')}><FolderPlus size={18} />新建文件夹</button>}<button className="primary-button import-button" disabled={!!busy} onClick={openUpload}><Plus size={18} />上传</button></div>}</section>
            {current.local && <div className="cloud-notice"><span className="status-dot" /><span>本地预览 · 文件与测试账号仅在这台电脑的预览服务中保存</span></div>}
            {current.user && (dirty > 0 || syncError) && <div className="cloud-notice" role="status"><span>{syncError || `${dirty} 篇文献有待同步的个人记录${paused ? '，自动同步已暂停' : ''}`}</span><button className="text-button" disabled={syncing} onClick={() => void syncNow()}><RefreshCw size={14} className={syncing ? 'spin' : ''} />{syncing ? '同步中' : '重试同步'}</button></div>}
            {privateView ? <div className="empty-state"><BookOpen size={32} /><h3>登录后拥有自己的书架</h3><p>公开书库无需登录即可阅读。收藏、上传和跨设备同步需要登录。</p><button className="primary-button" onClick={() => setLogin(true)}>登录</button></div> : <>
              {view !== 'notes' && <div className="collection-controls"><label className="search cloud-search"><Search size={17} /><input aria-label="搜索书库" placeholder="搜索标题、作者…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="icon-button" aria-label="清空搜索" onClick={() => setQuery('')}><X size={15} /></button>}</label><button className="text-button" onClick={() => view === 'uploads' ? void refreshUploads() : view === 'catalog' ? void Promise.all([refreshCatalog(), refreshCatalogFolders()]) : (metadata.retry(), void syncNow())} disabled={loading || syncing}><RefreshCw size={15} />刷新</button></div>}
              {catalogError && (view === 'catalog' || view === 'uploads') && <div className="cloud-error" role="alert"><p>{catalogError}</p><button className="secondary-button" onClick={() => view === 'uploads' ? void refreshUploads() : void refreshCatalog()}>重新连接</button></div>}
              {view === 'catalog' && <>
                <div className="folder-toolbar">{catalogFolderId && <><button className="text-button" onClick={() => { setCatalogFolderId(null); setQuery(''); }}>‹ 书库</button><strong>{catalogFolder?.name || '文件夹'}</strong>{catalogFolder?.canManage && <button className="icon-button" aria-label="管理书库文件夹" disabled={!!busy} onClick={() => setCatalogEditor(catalogFolder)}><Settings2 size={18} /></button>}</>}</div>
                {catalogFoldersError && <div className="cloud-error" role="alert"><p>{catalogFoldersError}</p><button className="secondary-button" onClick={() => void refreshCatalogFolders()}>重新加载文件夹</button></div>}
                {!catalogFolderId && <div className="folder-grid">{catalogFolders.filter(f => f.name.toLowerCase().includes(query.toLowerCase())).map(f => <button className="folder-card" key={f.id} onClick={() => { setCatalogFolderId(f.id); setQuery(''); }}><FolderOpen size={23} /><span><strong>{f.name}</strong><small>{f.count} 本</small></span><ChevronRight size={17} /></button>)}</div>}
                {!!query && !catalogFolderId && <p className="fineprint">搜索所有书库文件夹中的文献</p>}
              </>}
              {current.user && view !== 'catalog' && !shelf.ready ? <div className="empty-state"><p>{shelf.error || '正在加载书架…'}</p>{shelf.error && <button className="secondary-button" onClick={() => void run('正在刷新…', async () => { await shelf.refresh(); await syncNow(); })}>重试</button>}</div> : view === 'notes' ? <BookNotes books={ownRecords.map(([id, record]) => { const paper = lookup(id); return { id, title: shelf.item(id)?.remark || paper?.title || '文献信息待更新', author: paper?.author || '', annotations: record.data.annotations, readable: !!paper && (!paper.removed || cached.some(book => book.id === id)) }; })} expanded={notesBookId} onExpand={setNotesBookId} onRead={(id, page) => { const paper = lookup(id); if (paper) void openPaper(paper, undefined, page); }} busy={!!busy} notify={notify} /> : loading && !visible.length ? <div className="loading-state"><LoaderCircle className="spin" /><p>正在打开书库…</p></div> : <>
                {view === 'shelf' && <>
                  <div className="folder-toolbar">{folder ? <><button className="text-button" onClick={() => setFolderId(null)}>‹ 书架</button><strong>{folder.name}</strong><button className="icon-button" aria-label="管理文件夹" onClick={() => setFolderEditor(folder)}><Settings2 size={18} /></button>{folder.protected && <button className="text-button" disabled={!!busy} onClick={() => void run('正在锁定…', async () => { await syncNow(); await shelf.mutate(`/folders/${folder.id}/lock`, 'POST'); setFolderId(null); })}><LockKeyhole size={16} />锁定</button>}</> : null}</div>
                  {!folderId && <div className="folder-grid">{shelf.folders.filter(f => f.name.toLowerCase().includes(query.toLowerCase())).map(f => <button className="folder-card" key={f.id} onClick={() => { if (f.locked) setUnlockFolder(f); else setFolderId(f.id); }}>{f.locked ? <LockKeyhole size={23} /> : <FolderOpen size={23} />}<span><strong>{f.name}</strong><small>{f.count} 本</small></span><ChevronRight size={17} /></button>)}</div>}
                </>}
                <div className="book-grid">{visible.map(paper => {
                  const title = view === 'shelf' ? shelf.item(paper.id)?.remark || paper.title : paper.title;
                  const data = accountId && shelf.locked(paper.id) ? emptyReading() : personalData(paper.id); const cache = cached.find(b => b.id === paper.id);
                  const unresolved = view === 'shelf' && !lookup(paper.id);
                  return <article className="book-card" key={paper.id}>
                    <button className="book-cover public-cover" aria-label={`阅读 ${title}${current.user && data.annotations.length ? `，${data.annotations.length} 条笔记` : ''}`} disabled={!!busy || unresolved || (paper.removed && !cache)} onClick={() => void openPaper(paper)}>
                      {!unresolved && (paper.removed || paper.visibility === 'private') && <div className="cover-top"><span>{paper.removed ? (metadata.status[paper.id] === 'unavailable' ? '无法访问' : '已撤下') : '私密'}</span></div>}
                      <PaperCover owner={accountId} key={`${accountId || 'guest'}:${paper.id}`} paper={paper} title={title} cachedCover={cache?.bilingual === paper.bilingual ? cache.cover : undefined} allowed={!unresolved && (paper.visibility !== 'private' || (!!current.user && !shelf.locked(paper.id) && (paper.privateOwner === accountId || current.user.admin)))} />
                      {!!current.user && <NoteCount count={data.annotations.length} />}
                      {!unresolved && <div className="cover-bottom"><span>{paper.pages} 页</span></div>}
                    </button>
                    <div className="book-info">
                      <button className="book-title" onClick={() => void openPaper(paper)} disabled={!!busy || unresolved || (paper.removed && !cache)}>{title}</button>
                      {paper.author && <p className="book-author">{paper.author}</p>}
                      <div className="book-meta"><span>{unresolved ? '书籍信息待更新' : sizeLabel(paper.size)}</span><span>{data.opened ? `读至第 ${data.page} 页` : '尚未阅读'}</span></div>
                      {view === 'shelf' && <div className="shelf-card-tools">
                        <div className="shelf-card-icons">
                          <ShelfRating key={`${accountId}:${paper.id}`} title={title} rating={data.rating || 0} expanded={ratingBook?.id === paper.id} busy={!!busy} open={() => setRatingBook(paper)} close={() => setRatingBook(current => current?.id === paper.id ? null : current)} change={rating => void rateBook(paper, rating).then(saved => { if (saved) setRatingBook(current => current?.id === paper.id ? null : current); })} />
                          <button className="icon-button" aria-label={`书名备注与归类 ${title}`} title="书名备注与归类" disabled={!!busy} onClick={() => setEditBook(lookup(paper.id) || paper)}><Pencil size={17} /></button>
                          <button className="icon-button" aria-label={`移出书架 ${title}`} title="移出书架" disabled={!!busy} onClick={() => setRemoveShelf(paper)}><Trash2 size={17} /></button>
                        </div>
                      </div>}
                      {view !== 'shelf' && <div className="public-card-actions">
                        <button className={`secondary-button ${data.shelf ? 'on-shelf' : ''}`} disabled={!!busy || (paper.removed && !data.shelf)} onClick={() => data.shelf ? setRemoveShelf(paper) : void addToShelf(paper)}>{data.shelf ? <Check size={15} /> : <Plus size={15} />}{data.shelf ? '已加入书架' : '加入书架'}</button>
                        {(view === 'catalog' || view === 'uploads') && current.user && paper.canOrganize && <button className="secondary-button" aria-label={`书库归类 ${title}`} disabled={!!busy} onClick={() => openCatalogMove(paper)}><FolderOpen size={16} />归类</button>}
                        {view === 'uploads' && !paper.removed && <button className="icon-button" aria-label={`撤下 ${title}`} onClick={() => setWithdraw(paper)}><Trash2 size={16} /></button>}
                      </div>}
                      {!unresolved && data.opened > 0 && <div className="progress-track"><div style={{ width: `${data.page / paper.pages * 100}%` }} /></div>}
                    </div>
                  </article>;
                })}</div>
                {!visible.length && !catalogError && !(view === 'shelf' && !folderId && shelf.folders.length) && !(view === 'catalog' && !catalogFolderId && !query && catalogFolders.length) && <Empty text={query ? '没有找到匹配的文献。' : view === 'shelf' ? folderId ? '文件夹里还没有书籍。' : '书架还是空的，去书库挑选想读的文献吧。' : view === 'uploads' ? '你还没有上传文献。' : catalogFolderId ? '文件夹里还没有文献，上传时可以选择此文件夹。' : '书库还是空的，登录后分享第一篇文献。'} />}
                {more && view === 'catalog' && <button className="wide-button" disabled={loading} onClick={() => void refreshCatalog(true)}>{loading ? '正在加载…' : '加载更多'}</button>}
                {view === 'shelf' && shelfIds.some(id => !shelf.locked(id) && metadata.status[id] === 'error') && <div className="cloud-error" role="alert"><p>部分书籍信息加载失败，已加载的书名和个人记录仍保留。</p><button className="secondary-button" onClick={metadata.retry}>重试书籍信息</button></div>}
                {view === 'shelf' && shelfIds.some(id => !shelf.locked(id) && metadata.status[id] === 'unavailable') && <p className="fineprint">部分文献已撤下或当前账号无权访问，个人记录仍保留。</p>}
              </>}
            </>}
          </div>
          <nav className="mobile-nav" aria-label="手机导航"><button className={view === 'catalog' ? 'active' : ''} onClick={() => navigate('catalog')}><Library size={21} />书库</button><button className={view === 'shelf' ? 'active' : ''} onClick={() => navigate('shelf')}><BookOpen size={21} />书架</button><button className={view === 'notes' ? 'active' : ''} onClick={() => navigate('notes')}><NotebookPen size={21} />笔记</button><button className={view === 'uploads' ? 'active' : ''} onClick={() => navigate('uploads')}><Upload size={21} />我的上传</button><button onClick={() => setSettings(true)}><Settings2 size={21} />设置</button></nav>
        </main>
      </div>}
    {message && <div className="toast" role="status"><span>{message}</span><button aria-label="关闭提示" onClick={() => setMessage('')}><X size={16} /></button></div>}
    {busy && <div className="busy-toast" role="status"><LoaderCircle size={17} className="spin" />{busy}</div>}
    {login && <Modal title={current.setupEmail ? '设置密码' : '登录 Margina'} close={() => { setLogin(false); if (location.search) history.replaceState(null, '', location.pathname); }}>{current.local ? <><button className="wide-button" disabled={!!busy} onClick={() => void localLogin('alice')}><User size={17} />使用测试账号 A</button><button className="wide-button" disabled={!!busy} onClick={() => void localLogin('bob')}><User size={17} />使用测试账号 B</button></> : current.passwordLogin ? <AuthForm setupEmail={current.setupEmail} onSuccess={async () => { await refreshSession(); setLogin(false); history.replaceState(null, '', location.pathname); }} /> : current.loginAvailable ? <a className="wide-button primary-button" href={adminOpen ? '/api/private/login?next=/admin' : '/api/private/login'}><LogIn size={17} />通过邮箱登录</a> : <p>账号服务尚未配置。</p>}</Modal>}
    {upload && <Modal title="上传文献" close={() => !busy && setUpload(false)}><label className="upload-picker">选择 PDF / TXT / JSON 文件<input type="file" accept=".pdf,.txt,.json" multiple disabled={!!busy} onChange={event => { setFiles(Array.from(event.target.files || []).filter(file => /\.(pdf|txt|json)$/i.test(file.name))); setPublicConsent(false); }} /></label><ul className="upload-file-list">{files.map((file, index) => <li key={index}><span>{file.name}</span><small>{sizeLabel(file.size)}</small></li>)}</ul><fieldset className="upload-visibility" disabled={!!busy}><legend>可见范围</legend><label><input type="radio" name="visibility" checked={uploadVisibility === 'private'} onChange={() => { setUploadVisibility('private'); setPublicConsent(false); }} />仅自己可见</label><label><input type="radio" name="visibility" checked={uploadVisibility === 'public'} onChange={() => setUploadVisibility('public')} />公开到书库</label></fieldset><UploadFolderPicker key={uploadVisibility} isPublic={uploadVisibility === 'public'} folders={uploadVisibility === 'public' ? catalogFolders : shelf.folders} value={uploadVisibility === 'public' ? uploadCatalogFolder : uploadShelfFolder} change={uploadVisibility === 'public' ? setUploadCatalogFolder : setUploadShelfFolder} busy={!!busy} ready={uploadVisibility === 'public' ? catalogFoldersReady : shelf.ready} error={uploadVisibility === 'public' ? catalogFoldersError : shelf.error} retry={() => { if (uploadVisibility === 'public') void refreshCatalogFolders(); else void shelf.refresh().catch(() => {}); }} create={async name => {
      const saved = await run('正在创建文件夹…', async () => {
        if (uploadVisibility === 'public') { const result = await catalogMutation('/folders', 'POST', { name }); if (result.id) setUploadCatalogFolder(result.id); }
        else { const result = await shelf.mutate('/folders', 'POST', { name }); if (result?.id) setUploadShelfFolder(result.id); }
      });
      if (!saved) throw new Error('文件夹未创建');
    }} /><p className="fineprint">阅读包跟随对应 PDF 的位置。重复公开文献保留原归类。</p><p className="fineprint">PDF ≤ 100 MB · TXT ≤ 10 MB · JSON ≤ 20 MB</p>{uploadVisibility === 'public' && <label className="consent"><input type="checkbox" checked={publicConsent} disabled={!!busy} onChange={event => setPublicConsent(event.target.checked)} /><span>我确认有权公开分享这些文件。</span></label>}<button className="wide-button primary-button" disabled={!files.length || (uploadVisibility === 'public' ? !publicConsent || !catalogFoldersReady : !shelf.ready) || !!busy} onClick={() => void doUpload()}><Upload size={17} />{busy ? '正在处理…' : uploadVisibility === 'private' ? '私密上传' : '公开上传'}</button></Modal>}
    {settings && <Modal title="设置与账号" close={() => setSettings(false)}><div className="storage-row"><span>当前身份</span><strong>{current.user?.email || '游客'}</strong></div><div className="storage-row"><span>同步服务</span><strong>{connected ? current.local ? '本地测试服务' : '已连接' : '未连接'}</strong></div>{current.user ? <><div className="storage-row"><span>最近成功同步</span><strong>{account.lastSynced ? new Date(account.lastSynced).toLocaleString('zh-CN') : '尚未同步'}</strong></div><p>{syncError || (dirty ? `${dirty} 篇文献的修改待同步，已保存在本机。` : '')}</p><button className="wide-button" disabled={syncing} onClick={() => void syncNow()}><RefreshCw size={17} className={syncing ? 'spin' : ''} />立即同步</button><label className="consent"><input type="checkbox" checked={paused} onChange={event => { const next = event.target.checked; setPaused(next); void setting(`sync-paused:${accountId}`, next); if (!next) void syncNow(); }} />暂停自动同步</label>{current.user.admin && <button className="wide-button" onClick={() => { setSettings(false); setAdminOpen(true); history.replaceState(null, '', '/admin'); }}>管理后台</button>}{current.passwordLogin && <a className="wide-button" href="/api/auth/start?mode=reset">修改密码</a>}<button className="wide-button" disabled={!!busy || syncing} onClick={() => void run('正在退出…', logout)}>退出登录</button>{current.local && <button className="text-button" onClick={() => { setSettings(false); setLogin(true); }}>切换测试账号</button>}</> : <button className="wide-button" onClick={() => { setSettings(false); setLogin(true); }}><LogIn size={17} />登录</button>}</Modal>}
    {catalogEditor && <Modal title={catalogEditor === 'new' ? '新建书库文件夹' : '管理书库文件夹'} close={() => !busy && setCatalogEditor(null)}><CatalogFolderEditor folder={catalogEditor === 'new' ? undefined : catalogEditor} busy={!!busy} save={name => void run('正在保存文件夹…', async () => { await catalogMutation(catalogEditor === 'new' ? '/folders' : `/folders/${catalogEditor.id}`, catalogEditor === 'new' ? 'POST' : 'PATCH', { name }); setCatalogEditor(null); })} remove={catalogEditor === 'new' ? undefined : () => { setCatalogDelete(catalogEditor); setCatalogEditor(null); }} /></Modal>}
    {catalogDelete && <Modal title="删除书库文件夹？" close={() => !busy && setCatalogDelete(null)}><p>「{catalogDelete.name}」中的文献会移回书库首页，文献和阅读记录都会保留。</p><button className="wide-button danger-button" disabled={!!busy} onClick={() => void run('正在删除文件夹…', async () => { await catalogMutation(`/folders/${catalogDelete.id}`, 'DELETE'); setCatalogDelete(null); setCatalogFolderId(null); setQuery(''); })}>删除文件夹</button></Modal>}
    {catalogMove && <Modal title="书库归类" close={() => !busy && setCatalogMove(null)}>
      <p className="classification-title">{catalogMove.title}</p>
      <UploadFolderPicker key={catalogMove.id} label="目标书库文件夹" isPublic folders={catalogFolders} value={moveDestination} change={setMoveDestination} busy={!!busy} ready={catalogFoldersReady} error={catalogFoldersError} retry={() => void refreshCatalogFolders()} create={async name => {
        const saved = await run('正在创建文件夹…', async () => { const result = await catalogMutation('/folders', 'POST', { name }); if (result.id) setMoveDestination(result.id); });
        if (!saved) throw new Error('文件夹未创建');
      }} />
      <p className="fineprint">只调整公开书库中的位置，文献内容和个人阅读记录都会保留。</p>
      <button className="wide-button primary-button" disabled={!!busy || !catalogFoldersReady || (!!moveDestination && !catalogFolders.some(f => f.id === moveDestination))} onClick={() => void run('正在归类…', async () => {
        await catalogMutation(`/items/${catalogMove.id}`, 'PUT', { folderId: moveDestination || null });
        setKnown(old => ({ ...old, [catalogMove.id]: { ...catalogMove, catalogFolderId: moveDestination || null, catalogFolderName: catalogFolders.find(f => f.id === moveDestination)?.name || null } }));
        setCatalogMove(null);
        if (adminOpen) setAdminRevision(old => old + 1);
        else if (view === 'uploads') await refreshUploads();
        else await refreshCatalog();
        notify('已更新文献归类');
      })}>保存归类</button>
    </Modal>}
    {folderEditor && <Modal title={folderEditor === 'new' ? '新建文件夹' : '管理文件夹'} close={() => !busy && setFolderEditor(null)}><FolderEditor folder={folderEditor === 'new' ? undefined : folderEditor} busy={!!busy} save={(name, password) => void run('正在保存…', async () => { await syncNow(); await shelf.mutate(folderEditor === 'new' ? '/folders' : `/folders/${folderEditor.id}`, folderEditor === 'new' ? 'POST' : 'PATCH', { name, ...(password !== undefined ? { password } : {}) }); setFolderEditor(null); })} remove={folderEditor === 'new' ? undefined : () => { setDeleteFolder(folderEditor); setFolderEditor(null); }} /></Modal>}
    {unlockFolder && <Modal title={`解锁 ${unlockFolder.name}`} close={() => !busy && setUnlockFolder(null)}><FolderUnlock busy={!!busy} submit={password => void run('正在解锁…', async () => { await syncNow(); await shelf.mutate(`/folders/${unlockFolder.id}/unlock`, 'POST', { password }); setFolderId(unlockFolder.id); setView('shelf'); setQuery(''); setUnlockFolder(null); await syncNow(); })} /></Modal>}
    {deleteFolder && <Modal title="删除文件夹？" close={() => !busy && setDeleteFolder(null)}><p>文件夹内的书籍会移回书架首页。</p><button className="wide-button danger-button" disabled={!!busy} onClick={() => void run('正在删除…', async () => { await shelf.mutate(`/folders/${deleteFolder.id}`, 'DELETE'); setDeleteFolder(null); setFolderId(null); })}>删除文件夹</button></Modal>}
    {editBook && <Modal title="书名备注与归类" close={() => !busy && setEditBook(null)}><ShelfBookEditor title={editBook.title} remark={shelf.item(editBook.id)?.remark || ''} folderId={shelf.item(editBook.id)?.folderId || null} folders={shelf.folders} busy={!!busy} save={(remark, targetFolder) => void run('正在保存…', async () => { await syncNow(); await shelf.mutate(`/items/${editBook.id}`, 'PUT', { remark, folderId: targetFolder }); setEditBook(null); })} /></Modal>}
    {removeShelf && <Modal title="从我的书架移除？" close={() => setRemoveShelf(null)}><p>「{removeShelf.title}」的个人笔记和进度会保留，公共书库中的文件不受影响。</p><button className="wide-button danger-button" disabled={!!busy} onClick={() => void run('正在移出书架…', async () => { if (!accountId || userRef.current?.id !== accountId) return; await shelf.refresh(); if (bookLocked(removeShelf.id)) throw new Error('请先解锁文件夹'); await editReading(accountId, removeShelf.id, { shelf: false }); await reloadAccount(accountId); setRemoveShelf(null); })}>移出书架</button></Modal>}
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
        const targets = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]') || []);
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
