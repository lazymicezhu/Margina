import { useState } from 'react';
import type { ShelfFolder } from './useShelf';
export function FolderEditor({ folder, save, remove, busy }: { folder?: ShelfFolder; save: (name: string, password?: string) => void; remove?: () => void; busy: boolean }) {
  const [name, setName] = useState(folder?.name || '');
  const [changePassword, setChangePassword] = useState(!folder);
  const [password, setPassword] = useState('');
  return <form className="shelf-form" onSubmit={e => { e.preventDefault(); save(name, changePassword ? password : undefined); }}>
    <label>文件夹名称<input aria-label="文件夹名称" maxLength={60} required value={name} onChange={e => setName(e.target.value)} /></label>
    {folder && <label className="consent"><input type="checkbox" checked={changePassword} onChange={e => setChangePassword(e.target.checked)} />修改密码</label>}
    {changePassword && <label>{folder ? '新密码（留空取消密码）' : '密码（可选）'}<input aria-label="文件夹密码" type="password" autoComplete="new-password" minLength={password ? 6 : undefined} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} /></label>}
    <button className="wide-button primary-button" disabled={busy || !name.trim()} type="submit">保存</button>
    {remove && <button className="wide-button danger-button" disabled={busy} type="button" onClick={remove}>删除文件夹</button>}
  </form>;
}
export function FolderUnlock({ submit, busy }: { submit: (password: string) => void; busy: boolean }) {
  const [password, setPassword] = useState('');
  return <form className="shelf-form" onSubmit={e => { e.preventDefault(); submit(password); }}><label>密码<input aria-label="文件夹密码" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label><button className="wide-button primary-button" disabled={busy || !password} type="submit">解锁</button></form>;
}
export function ShelfBookEditor({ title, remark, folderId, folders, save, busy }: { title: string; remark: string; folderId: string | null; folders: ShelfFolder[]; save: (remark: string, folder: string | null) => void; busy: boolean }) {
  const [value, setValue] = useState(remark), [folder, setFolder] = useState(folderId || '');
  return <form className="shelf-form" onSubmit={e => { e.preventDefault(); save(value, folder || null); }}><label>书名备注<input aria-label="书名备注" maxLength={200} placeholder={title} value={value} onChange={e => setValue(e.target.value)} /></label><label>文件夹<select aria-label="所属文件夹" value={folder} onChange={e => setFolder(e.target.value)}><option value="">书架首页</option>{folders.map(f => <option key={f.id} value={f.id}>{f.name}{f.protected ? ' 🔒' : ''}</option>)}</select></label><button className="wide-button primary-button" type="submit" disabled={busy}>保存</button></form>;
}
