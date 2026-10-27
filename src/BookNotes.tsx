import { ArrowDownToLine, ArrowRight, BookOpen, ChevronDown, NotebookPen } from 'lucide-react';
import type { Annotation, Book } from './types';
import { notesMarkdown, saveFile } from './storage';
import { CopyButton } from './interactions';

export type NoteBook = { id: string; title: string; author: string; annotations: Annotation[]; readable: boolean };
export function NoteCount({ count }: { count: number }) {
  return count > 0 ? <span className="book-note-count" title={`${count} 条笔记`} aria-label={`${count} 条笔记`}><NotebookPen size={13} aria-hidden="true" /><span>{count}</span></span> : null;
}
export default function BookNotes({ books, expanded, onExpand, onRead, busy, notify }: {
  books: NoteBook[]; expanded: string | null; onExpand: (id: string | null) => void;
  onRead: (id: string, page: number) => void; busy: boolean; notify: (message: string) => void;
}) {
  const groups = books.filter(book => book.annotations.length).sort((a, b) => {
    const latest = (book: NoteBook) => book.annotations.reduce((n, note) => Math.max(n, note.updated), 0);
    return latest(b) - latest(a) || a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id);
  });
  const count = groups.reduce((n, book) => n + book.annotations.length, 0);
  const markdown = (book: NoteBook) => notesMarkdown({ title: book.title, annotations: book.annotations } as Book);
  return <section className="book-notes" aria-label="按书籍分类的笔记">
    <div className="section-heading"><h2>{groups.length} 本书<span className="note-total">{count} 条笔记</span></h2><button className="text-button" disabled={!count} onClick={() => saveFile(groups.map(markdown).join('\n\n---\n\n'), 'Margina-我的笔记.md')}><ArrowDownToLine size={16} />导出全部</button></div>
    <div className="note-book-list">{groups.map(book => {
      const open = expanded === book.id;
      const region = `book-notes-${book.id}`;
      return <section className={`note-book-group ${open ? 'is-open' : ''}`} key={book.id}>
        <h3 className="note-book-heading"><button className="note-book-toggle" aria-expanded={open} aria-controls={region} onClick={() => onExpand(open ? null : book.id)}>
          <span className="note-book-symbol"><BookOpen size={23} strokeWidth={1.4} aria-hidden="true" /></span>
          <span className="note-book-label"><strong>{book.title}</strong>{book.author && <small>{book.author}</small>}</span>
          <span className="note-book-quantity">{book.annotations.length}<span className="sr-only"> 条笔记</span></span><ChevronDown className="note-book-chevron" size={17} aria-hidden="true" />
        </button></h3>
        <div id={region} hidden={!open}>
          {open && <div className="note-book-body"><div className="note-book-actions"><span>按页码排列</span><button className="text-button" onClick={() => saveFile(markdown(book), `${book.title}-笔记.md`)}><ArrowDownToLine size={14} />导出本书</button></div>
            <div className="all-notes">{[...book.annotations].sort((a, b) => a.page - b.page || a.created - b.created || a.id.localeCompare(b.id)).map(note => <article className="global-note" key={note.id}>
              <div className="note-entry-top"><button className="note-source" disabled={busy || !book.readable} onClick={() => onRead(book.id, note.page)} aria-label={`打开 ${book.title} 第 ${note.page} 页`}>第 {note.page} 页<ArrowRight size={14} /></button><time dateTime={new Date(note.updated).toISOString()}>{new Date(note.updated).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</time></div>
              {note.quote && <blockquote className={`quote-${note.color}`}>{note.quote}</blockquote>}{note.text && <p>{note.text}</p>}
              <div className="note-copy"><CopyButton text={[note.quote, note.text].filter(Boolean).join('\n\n')} onError={() => notify('复制失败，请重试')} /></div>
            </article>)}</div>
          </div>}
        </div>
      </section>;
    })}</div>
    {!count && <div className="empty-state"><NotebookPen size={30} /><h3>还没有笔记</h3><p>在文献中选中文字即可记录，笔记会按书籍整理在这里。</p></div>}
  </section>;
}
