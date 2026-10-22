import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Plus, RefreshCw, Search } from 'lucide-react';
import { api } from './cloud-api';
import type { Account, Paper, RemoteRecord } from './cloud-types';
import './admin.css';

type UserRow = { id: string; email: string; lastSeen: number; papers: number; notes: number };
type AdminPaper = Paper & { status: number; owner: string };
type AdminRecord = RemoteRecord & { title: string; removed: boolean };
const failure = (e: unknown) => e instanceof Error ? e.message : '操作失败';
const statusLabel = ['公开', '已撤下', '已删除', '删除未完成'];

export default function AdminPanel({ user, revision, onClose, onUpload, onChanged }: {
  user: Account; revision: number; onClose: () => void; onUpload: () => void; onChanged: () => void;
}) {
  const [tab, setTab] = useState<'papers' | 'users'>('papers');
  return <main className="admin-shell">
    <header className="admin-header"><button className="text-button" onClick={onClose}><ArrowLeft size={17} />返回书库</button><h1>管理后台</h1></header>
    <nav className="admin-tabs" aria-label="后台导航"><button aria-pressed={tab === 'papers'} onClick={() => setTab('papers')}>文献库</button><button aria-pressed={tab === 'users'} onClick={() => setTab('users')}>账号笔记</button></nav>
    {tab === 'papers' ? <Papers user={user} revision={revision} onUpload={onUpload} onChanged={onChanged} /> : <Users user={user} />}
  </main>;
}

function Papers({ user, revision, onUpload, onChanged }: { user: Account; revision: number; onUpload: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<AdminPaper[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const serial = useRef(0);
  const actionLock = useRef(false);
  async function load(append = false) {
    const n = ++serial.current;
    setLoading(true); setError('');
    try {
      const result = await api<{ papers: AdminPaper[]; more: boolean }>(`/api/private/admin/papers?q=${encodeURIComponent(q)}&status=${status}&offset=${append ? rows.length : 0}`, { headers: { 'X-Margina-User': user.id } });
      if (n !== serial.current) return;
      setRows(old => append ? [...old, ...result.papers.filter(p => !old.some(o => o.id === p.id))] : result.papers); setMore(result.more);
    } catch (e) { if (n === serial.current) setError(failure(e)); }
    finally { if (n === serial.current) setLoading(false); }
  }
  useEffect(() => { const timer = setTimeout(() => void load(), 200); return () => { clearTimeout(timer); serial.current++; }; }, [q, status, revision, user.id]);
  async function change(paper: AdminPaper, action: 'delete' | 'withdraw' | 'restore') {
    if (actionLock.current) return;
    if (action === 'delete' && !window.confirm(`删除《${paper.title}》的 PDF 和阅读包？用户笔记保留。`)) return;
    actionLock.current = true; setBusy(true); setError('');
    try {
      const path = action === 'withdraw' ? `/api/private/papers/${paper.id}` : `/api/private/admin/papers/${paper.id}${action === 'restore' ? '/restore' : ''}`;
      await api(path, { method: action === 'restore' ? 'POST' : 'DELETE', headers: { 'X-Margina-User': user.id } });
      await load(); onChanged();
    } catch (e) { setError(failure(e)); }
    finally { actionLock.current = false; setBusy(false); }
  }
  return <section>
    <div className="admin-toolbar"><label className="search cloud-search"><Search size={17} /><input aria-label="搜索文献" placeholder="搜索标题、作者" value={q} onChange={e => setQ(e.target.value)} /></label><select aria-label="文献状态" value={status} onChange={e => setStatus(e.target.value)}><option value="all">全部</option><option value="active">公开</option><option value="withdrawn">已撤下</option><option value="deleted">已删除</option></select><button className="primary-button" onClick={onUpload}><Plus size={17} />上传</button><button className="icon-button" aria-label="刷新文献库" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={17} /></button></div>
    {error && <p className="cloud-error" role="alert">{error}</p>}
    <div className="admin-paper-list">{rows.map(p => <article className="admin-paper" key={p.id}><div><h2>{p.title}</h2><p>{p.author || p.fileName}</p><small>{p.owner} · {p.pages} 页 · {(p.size / 1024 / 1024).toFixed(1)} MB</small></div><div className="admin-paper-actions"><span>{statusLabel[p.status]}</span>{p.status === 0 && <button className="secondary-button" disabled={busy || loading} onClick={() => void change(p, 'withdraw')}>撤下</button>}{p.status === 1 && <button className="secondary-button" disabled={busy || loading} onClick={() => void change(p, 'restore')}>恢复</button>}{p.status !== 2 && <button className="secondary-button danger-button" disabled={busy || loading} onClick={() => void change(p, 'delete')}>{p.status === 3 ? '重试删除' : '删除'}</button>}</div></article>)}</div>
    {!rows.length && !error && <p className="admin-empty">{loading ? '正在加载…' : '没有文献'}</p>}
    {more && <button className="wide-button" disabled={loading || busy} onClick={() => void load(true)}>{loading ? '正在加载…' : '加载更多'}</button>}
  </section>;
}

function Users({ user }: { user: Account }) {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const serial = useRef(0);
  async function load(append = false) {
    const n = ++serial.current; setLoading(true); setError('');
    try {
      const result = await api<{ users: UserRow[]; more: boolean }>(`/api/private/admin/users?q=${encodeURIComponent(q)}&offset=${append ? rows.length : 0}`, { headers: { 'X-Margina-User': user.id } });
      if (n !== serial.current) return;
      setRows(old => append ? [...old, ...result.users.filter(u => !old.some(o => o.id === u.id))] : result.users); setMore(result.more);
    } catch (e) { if (n === serial.current) setError(failure(e)); }
    finally { if (n === serial.current) setLoading(false); }
  }
  useEffect(() => { const timer = setTimeout(() => void load(), 200); return () => { clearTimeout(timer); serial.current++; }; }, [q, user.id]);
  if (selected) return <UserNotes key={selected.id} user={user} selected={selected} onBack={() => setSelected(null)} />;
  return <section>
    <div className="admin-toolbar"><label className="search cloud-search"><Search size={17} /><input aria-label="搜索账号" placeholder="搜索邮箱" value={q} onChange={e => setQ(e.target.value)} /></label><button className="text-button" disabled={loading} onClick={() => void load()}><RefreshCw size={17} />刷新</button></div>
    {error && <p className="cloud-error" role="alert">{error}</p>}
    <div className="admin-user-list">{rows.map(u => <button className="admin-user" key={u.id} onClick={() => setSelected(u)}><strong>{u.email || u.id}</strong><span>{u.notes} 条笔记 · {u.papers} 篇阅读记录</span><small>{u.lastSeen ? `最近登录 ${new Date(u.lastSeen).toLocaleDateString('zh-CN')}` : ''}</small></button>)}</div>
    {!rows.length && !error && <p className="admin-empty">{loading ? '正在加载…' : '没有账号'}</p>}
    {more && <button className="wide-button" disabled={loading} onClick={() => void load(true)}>加载更多</button>}
  </section>;
}

function UserNotes({ user, selected, onBack }: { user: Account; selected: UserRow; onBack: () => void }) {
  const [rows, setRows] = useState<AdminRecord[]>([]);
  const [cursor, setCursor] = useState(0);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const serial = useRef(0);
  async function load(append = false) {
    const n = ++serial.current; setLoading(true); setError('');
    try {
      const result = await api<{ records: AdminRecord[]; cursor: number; more: boolean }>(`/api/private/admin/records?user=${encodeURIComponent(selected.id)}&after=${append ? cursor : 0}`, { headers: { 'X-Margina-User': user.id } });
      if (n !== serial.current) return;
      setRows(old => append ? [...old.filter(r => !result.records.some(next => next.bookId === r.bookId)), ...result.records] : result.records); setCursor(result.cursor); setMore(result.more);
    } catch (e) { if (n === serial.current) setError(failure(e)); }
    finally { if (n === serial.current) setLoading(false); }
  }
  useEffect(() => { void load(); return () => { serial.current++; }; }, [selected.id, user.id]);
  return <section>
    <div className="admin-toolbar"><button className="text-button" onClick={onBack}><ArrowLeft size={17} />账号列表</button><button className="text-button" disabled={loading} onClick={() => void load()}><RefreshCw size={17} />刷新</button></div>
    <h2 className="admin-account-title">{selected.email || selected.id}</h2>
    {error && <p className="cloud-error" role="alert">{error}</p>}
    {rows.map(r => <section className="admin-record" key={r.bookId}><h3>{r.title}{r.removed && <small> · 已撤下</small>}</h3><p className="admin-record-meta">第 {r.data.page} 页 · {r.data.annotations.length} 条笔记 · {r.data.bookmarks.length} 个书签</p>{r.data.annotations.map(note => <article className="global-note" key={note.id}><span className="note-source">第 {note.page} 页 · {new Date(note.updated).toLocaleDateString('zh-CN')}</span>{note.quote && <blockquote>{note.quote}</blockquote>}{note.text && <p>{note.text}</p>}</article>)}</section>)}
    {!rows.length && !error && <p className="admin-empty">{loading ? '正在加载…' : '暂无阅读记录'}</p>}
    {more && <button className="wide-button" disabled={loading} onClick={() => void load(true)}>加载更多</button>}
  </section>;
}
