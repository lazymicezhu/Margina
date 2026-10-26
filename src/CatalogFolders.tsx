import { useState } from 'react';
import { FolderPlus } from 'lucide-react';
import type { CatalogFolder } from './cloud-types';

export function CatalogFolderEditor({ folder, busy, save, remove }: { folder?: CatalogFolder; busy: boolean; save: (name: string) => void; remove?: () => void }) {
  const [name, setName] = useState(folder?.name || '');
  return <form className="shelf-form" onSubmit={event => { event.preventDefault(); if (name.trim()) save(name.trim()); }}>
    <label>文件夹名称<input aria-label="书库文件夹名称" maxLength={60} required value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
    <p className="fineprint">书库文件夹及其中的文献对所有人可见。</p>
    <button className="wide-button primary-button" disabled={busy || !name.trim()} type="submit">保存</button>
    {remove && <button className="wide-button danger-button" disabled={busy} type="button" onClick={remove}>删除文件夹</button>}
  </form>;
}

export function UploadFolderPicker({ folders, value, change, create, busy, ready, isPublic, error, retry, label }: {
  label?: string;
  folders: { id: string; name: string; protected?: boolean }[]; value: string; change: (id: string) => void;
  create: (name: string) => Promise<void>; busy: boolean; ready: boolean; isPublic: boolean; error: string; retry: () => void;
}) {
  const [adding, setAdding] = useState(false), [name, setName] = useState('');
  return <div className="shelf-form upload-destination">
    <label>{label || (isPublic ? '上传到书库文件夹' : '上传到书架文件夹')}<select aria-label={label || '上传到文件夹'} value={value} disabled={busy || !ready} onChange={event => change(event.target.value)}>
      <option value="">{isPublic ? '书库首页' : '书架首页'}</option>
      {value && !folders.some(folder => folder.id === value) && <option value={value} disabled>原文件夹已不存在，请重新选择</option>}
      {folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}{folder.protected ? ' 🔒' : ''}</option>)}
    </select></label>
    {!ready && <p className="fineprint" role={error ? 'alert' : 'status'}>{error || '正在加载文件夹…'}{error && <button className="text-button" disabled={busy} onClick={retry}>重试</button>}</p>}
    {adding ? <div className="upload-folder-create"><label>新文件夹名称<input aria-label="新文件夹名称" maxLength={60} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label><button className="secondary-button" disabled={busy || !ready || !name.trim()} onClick={() => void create(name.trim()).then(() => { setName(''); setAdding(false); }).catch(() => {})}>创建并选中</button><button className="text-button" disabled={busy} onClick={() => setAdding(false)}>取消</button></div> : <button className="text-button" disabled={busy || !ready} onClick={() => setAdding(true)}><FolderPlus size={16} />新建文件夹</button>}
  </div>;
}
