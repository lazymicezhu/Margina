import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, BookMarked, BookOpen, Bookmark, Check, ChevronDown, ChevronLeft, ChevronRight, Columns2, FileText, Highlighter, Info, Languages, List, LoaderCircle, Maximize2, Minus, NotebookPen, Pencil, Plus, Search, Trash2, Type, X } from 'lucide-react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { loadPdf } from './pdf';
import type { Annotation, Book, Language, MarkColor, Rect, SelectionData } from './types';
import { notesMarkdown, saveFile } from './storage';
import { CopyButton, Disclosure, useSpringFeedback } from './interactions';
import { randomId } from './browser-compat';
import { pdfBitmapSize } from './pdf-resolution';

const langLabel = (lang: Language) => lang === 'zh' ? '中文' : lang === 'en' ? '英文' : '对照';
type Props = { book: Book; onBack: () => void; onUpdate: (patch: Partial<Book>) => Promise<void>; onReload?: () => Promise<void>; notify: (message: string) => void };
export default function Reader({ book, onBack, onUpdate, onReload, notify }: Props) {
  const [page, setPage] = useState(book.page);
  const [language, setLanguage] = useState<Language>(book.bilingual ? 'zh' : 'en');
  const [mode, setMode] = useState<'flow' | 'pdf'>('pdf');
  const [fontSize, setFontSize] = useState(18);
  const [zoom, setZoom] = useState(1);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pdfError, setPdfError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [panel, setPanel] = useState<'notes' | 'glossary' | 'pages' | null>(null);
  const [selection, setSelection] = useState<SelectionData | null>(null);
  const [editor, setEditor] = useState<Annotation | null>(null);
  const [color, setColor] = useState<MarkColor>('yellow');
  const [noteFilter, setNoteFilter] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [saving, setSaving] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const selectionCallback = useRef(setSelection); selectionCallback.current = setSelection;
  const bookRef = useRef(book); bookRef.current = book;
  const segments = book.bundle?.segments.filter(s => s.page === page) || [];
  const notes = book.annotations.filter(n => !noteFilter || `${n.quote} ${n.text}`.toLowerCase().includes(noteFilter.toLowerCase())).sort((a,b)=>b.updated-a.updated);
  const headingSegments = book.bundle?.segments.filter(s => s.page !== null && /^(?:\d+(?:\.\d+)*\s+.{2,60}|摘要|Abstract|参考文献|References|结论|Conclusion)$/i.test(s.zh.trim())) || [];
  const isBookmarked = book.bookmarks.includes(page);
  const bookmarkRef = useSpringFeedback<HTMLButtonElement>(isBookmarked);

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<typeof loadPdf> | undefined;
    setPdf(null); setPdfError('');
    book.blob.arrayBuffer().then(bytes => {
      if (cancelled) return;
      task = loadPdf(bytes);
      return task.promise.then(doc => { if (!cancelled) setPdf(doc); });
    }).catch(error => {
      if (!cancelled) {
        console.warn('PDF document loading failed', error);
        setPdfError(error?.name === 'PasswordException' ? '这份 PDF 需要密码。' : 'PDF 加载失败，请重试。');
      }
    });
    return () => { cancelled = true; void task?.destroy().catch(() => {}); };
  }, [book.id, book.blob, loadAttempt]);
  async function retryPdf() {
    setRetrying(true);
    try {
      if (onReload) await onReload();
      else setLoadAttempt(attempt => attempt + 1);
    } finally { setRetrying(false); }
  }
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const read = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (mode !== 'flow' || editor) return;
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount || !flowRef.current?.contains(sel.anchorNode) || !flowRef.current.contains(sel.focusNode)) return;
        const quote = sel.toString().trim(); if (!quote) return;
        const element = sel.anchorNode?.nodeType === 1 ? sel.anchorNode as Element : sel.anchorNode?.parentElement;
        const segment = element?.closest<HTMLElement>('[data-segment]');
        const lang = element?.closest<HTMLElement>('[data-lang]')?.dataset.lang as Language | undefined;
        setSelection({ quote, rects: [], page, language: lang || language, segmentId: segment?.dataset.segment });
      }, 220);
    };
    document.addEventListener('selectionchange', read);
    return () => { document.removeEventListener('selectionchange', read); clearTimeout(timer); };
  }, [mode, page, language, editor]);

  function changePage(next: number) {
    if (!Number.isInteger(next) || next < 1 || next > book.pages) return;
    setPage(next); setSelection(null); window.getSelection()?.removeAllRanges(); scroller.current?.scrollTo({top:0});
    onUpdate({page:next,opened:Date.now()}).catch(()=>{});
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable]') || editor || help) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); changePage(page - 1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); changePage(page + 1); }
      if (event.key === 'Escape') { setPanel(null); setSelection(null); }
    };
    document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey);
  });
  function switchLanguage(lang: Language) { setLanguage(lang); setSelection(null); window.getSelection()?.removeAllRanges(); }
  function draft(data?: SelectionData): Annotation {
    return { id: randomId(), page, quote: data?.quote || '', text: '', rects: data?.rects || [], language: data?.language || language, segmentId: data?.segmentId, color, created:Date.now(),updated:Date.now() };
  }
  async function saveNote(note: Annotation) {
    setSaving(true);
    try {
      const current = bookRef.current.annotations;
      const updated = { ...note, updated: Date.now() };
      await onUpdate({annotations: current.some(n=>n.id===note.id) ? current.map(n=>n.id===note.id?updated:n) : [...current,updated]});
      setEditor(null); setSelection(null); window.getSelection()?.removeAllRanges(); notify(note.text ? '笔记已保存在本机' : '摘录已保存在本机');
    } finally { setSaving(false); }
  }
  function newNote(data?: SelectionData) { setEditor(draft(data)); setSelection(null); }
  function jumpToNote(note: Annotation) { changePage(note.page); if (book.bilingual) setLanguage(note.language); if (note.rects.length) setMode('pdf'); else if (note.segmentId) setMode('flow'); setPanel(null); if (note.segmentId) requestAnimationFrame(()=>document.getElementById(`segment-${note.segmentId}`)?.scrollIntoView({block:'center',behavior:'smooth'})); }
  const panelBody = <>
    <div className="panel-top"><div className="panel-tabs"><button className={panel !== 'glossary' && panel !== 'pages' ? 'active' : ''} onClick={()=>setPanel('notes')}>笔记 <span>{book.annotations.length}</span></button><button className={panel === 'glossary' ? 'active' : ''} onClick={()=>setPanel('glossary')}>术语</button><button className={panel === 'pages' ? 'active' : ''} onClick={()=>setPanel('pages')}>目录</button></div><button className="icon-button mobile-panel-close" aria-label="收起面板" onClick={()=>setPanel(null)}><X size={19}/></button></div>
    {panel === 'glossary' ? <div className="glossary">{Object.entries(book.bundle?.glossary || {}).map(([en,zh])=><div className="term" key={en}><strong>{en}</strong><span>{zh}</span></div>)}{!Object.keys(book.bundle?.glossary || {}).length && <div className="panel-empty"><Languages size={28}/><h3>暂无术语</h3><p>导入配套阅读包后显示。</p></div>}</div> : panel === 'pages' ? <div className="contents"><div className="page-grid">{Array.from({length:book.pages},(_,i)=><button className={page===i+1?'active':''} onClick={()=>{changePage(i+1);setPanel(null);}} key={i}> {i+1} {book.bookmarks.includes(i+1)&&<Bookmark size={9} fill="currentColor"/>}</button>)}</div>{headingSegments.length>0&&<h4>段落标题</h4>}{headingSegments.map((s,i)=><button className="toc-item" key={`${s.id}-${i}`} onClick={()=>{changePage(s.page!);setPanel(null);}}><span>{s.zh}</span><small>{s.page}</small></button>)}<p className="fineprint">页码为 PDF 文件页序。段落标题来自已有翻译片段。</p></div> : <><div className="notes-tools"><button className="add-note" onClick={()=>newNote()}><Plus size={16}/>添加笔记</button><button className="icon-button" aria-label="导出本篇笔记" disabled={!book.annotations.length} onClick={()=>saveFile(notesMarkdown(book),`${book.title}-笔记.md`)}><ArrowDownToLine size={17}/></button></div>{book.annotations.length>3&&<label className="search note-search"><Search size={14}/><input value={noteFilter} onChange={e=>setNoteFilter(e.target.value)} placeholder="搜索本篇笔记"/></label>}<div className="notes-list">{notes.map(n=><article className={`reader-note color-${n.color}`} key={n.id}><div className="note-top"><button onClick={()=>jumpToNote(n)}>第 {n.page} 页 · {langLabel(n.language)} <ChevronRight size={12}/></button><div><CopyButton text={[n.quote,n.text].filter(Boolean).join('\n\n')} onError={()=>notify('复制失败，请重试')}/><button className="icon-button" aria-label="编辑笔记" onClick={()=>setEditor(n)}><Pencil size={13}/></button><button className="icon-button" aria-label="删除笔记" onClick={()=>setDeleting(n.id)}><Trash2 size={13}/></button></div></div>{n.quote&&<blockquote onClick={()=>jumpToNote(n)}>{n.quote}</blockquote>}{n.text&&<p>{n.text}</p>}<small>{new Date(n.updated).toLocaleDateString('zh-CN')}</small></article>)}{!notes.length&&<div className="panel-empty"><div className="empty-notebook"><NotebookPen size={30} strokeWidth={1.2}/></div><h3>{noteFilter?'没有匹配的笔记':'暂无笔记'}</h3><p>选中文字即可高亮或记笔记。</p></div>}</div></>}
  </>;

  return <div className="reader-shell">
    <header className="reader-header"><button className="reader-back" aria-label="返回文献库" onClick={onBack}><ArrowLeft size={19}/><span>文献库</span></button><div className="reader-title"><strong>{book.title}</strong><span>{book.author || book.fileName}</span></div><div className="reader-header-actions"><button className="icon-button" aria-label="阅读说明" onClick={()=>setHelp(true)}><Info size={18}/></button><button className="icon-button" aria-label="下载原始 PDF" onClick={()=>saveFile(book.blob,book.fileName)}><ArrowDownToLine size={18}/></button></div></header>
    <div className="reader-toolbar"><div className="reading-controls"><div className="language-switch" role="group" aria-label="阅读语言">{(book.bilingual ? ['zh','en','both'] : ['en']) .map(l=><button key={l} aria-pressed={language===l} className={language===l?'active':''} onClick={()=>switchLanguage(l as Language)}>{l==='zh'?'中文':l==='en'?(book.bilingual?'English':'原文'):<><Columns2 size={14}/>对照</>}</button>)}</div><span className="toolbar-divider"/><div className="format-switch"><button className={mode==='flow'?'active':''} disabled={!book.bundle} title={!book.bundle?'导入阅读包后启用段落阅读':'手机段落阅读'} onClick={()=>{setMode('flow');setSelection(null);scroller.current?.scrollTo({top:0});}}><Type size={16}/><span>段落</span></button><button className={mode==='pdf'?'active':''} onClick={()=>{setMode('pdf');setSelection(null);}}><FileText size={16}/><span>原版 PDF</span></button></div></div><div className="sizing-controls"><button className="icon-button" aria-label="缩小" disabled={mode==='flow'?fontSize<=15:zoom<=.6} onClick={()=>mode==='flow'?setFontSize(s=>Math.max(15,s-1)):setZoom(s=>Math.max(.6,+(s-.2).toFixed(1)))}><Minus size={16}/></button><span>{mode==='flow'?`${fontSize}px`:`${Math.round(zoom*100)}%`}</span><button className="icon-button" aria-label="放大" disabled={mode==='flow'?fontSize>=26:zoom>=3} onClick={()=>mode==='flow'?setFontSize(s=>Math.min(26,s+1)):setZoom(s=>Math.min(3,+(s+.2).toFixed(1)))}><Plus size={16}/></button><button className="icon-button fit-button" title="适应宽度" aria-label="适应宽度" onClick={()=>{setZoom(1);setFontSize(18);}}><Maximize2 size={16}/></button></div></div>
    <div className="reader-workspace"><aside className="reading-rail"><div className="rail-cover"><img src={book.cover} alt="文献封面"/></div><h3>{book.title}</h3><p>{book.pages} 页 · {book.bilingual?'中英对照':'普通 PDF'}</p><div className="rail-progress"><span>已读至第 {page} 页</span><strong>{Math.round(page/book.pages*100)}%</strong></div><div className="progress-track"><div style={{width:`${page/book.pages*100}%`}}/></div><div className="rail-links"><button onClick={()=>setPanel('pages')}><List size={16}/>页码与目录<ChevronRight size={14}/></button><button onClick={()=>onUpdate({bookmarks:isBookmarked?book.bookmarks.filter(p=>p!==page):[...book.bookmarks,page]}).catch(()=>{})}><Bookmark size={16} fill={isBookmarked?'currentColor':'none'}/>{isBookmarked?'已收藏此页':'收藏这一页'}</button></div>{book.bookmarks.length>0&&<div className="rail-bookmarks"><span>我的书签</span>{[...book.bookmarks].sort((a,b)=>a-b).map(p=><button key={p} onClick={()=>changePage(p)}>第 {p} 页<ChevronRight size={12}/></button>)}</div>}</aside>
      <div className="reading-center"><div className="reading-scroll" ref={scroller}>
        {mode==='flow' ? <div className={`flow-document ${language==='both'?'parallel':''}`} style={{'--reading-size':`${fontSize}px`} as React.CSSProperties} ref={flowRef}>

          <div className="flow-notice"><BookOpen size={15}/><span>以最终 PDF 为准</span><button onClick={()=>{setMode('pdf');setSelection(null);}}>查看 PDF <ArrowRight size={13}/></button><Disclosure label="说明"><p>段落来自翻译中间稿，可能有缺漏。图表、公式及修订请查看最终 PDF。</p></Disclosure></div>
          {segments.map((s,index)=><section id={`segment-${s.id}`} data-segment={s.id} className={`segment ${book.annotations.some(n=>n.segmentId===s.id)?'has-note':''} ${index===0&&page===1?'first-segment':''}`} key={s.id}>
            <div className="segment-body">{(language==='en'||language==='both')&&<div data-lang="en" className={`segment-en ${language==='both'?'paired-text':''}`}>{language==='both'&&<span className="language-label">EN</span>}<p>{s.source}</p></div>}{(language==='zh'||language==='both')&&<div data-lang="zh" className="segment-zh">{language==='both'&&<span className="language-label">中</span>}<p>{s.zh}</p></div>}</div>
            <div className="segment-actions">{s.hasFormula&&<span title="公式由提取字符还原，复杂排版请查看 PDF">含公式 / 引文</span>}{s.keep&&<span title={s.reason}>保留原文</span>}<button title="摘录本段并记笔记" aria-label={`摘录第 ${index+1} 段`} onClick={()=>newNote({quote:language==='en'?s.source:s.zh,rects:[],page,language,segmentId:s.id})}><NotebookPen size={15}/><span>记笔记</span></button></div>
          </section>)}
          {!segments.length&&<div className="panel-empty"><FileText size={30}/><h3>这一页请查看原版</h3><button className="primary-button" onClick={()=>setMode('pdf')}>打开第 {page} 页 PDF</button></div>}
          <div className="page-end"><span>第 {page} 页 · 段落结束</span>{page<book.pages&&<button onClick={()=>changePage(page+1)}>下一页<ArrowRight size={17}/></button>}</div>
        </div> : <div className="pdf-document"><div className="pdf-hint"><span>{book.bilingual?(language==='both'?'左英文 · 右中文':language==='zh'?'中文侧':'英文侧'):'原版 PDF'}</span>{zoom>1&&<span>可横向滑动查看</span>}</div>{pdfError?<div className="empty-state"><p>{pdfError}</p><button className="secondary-button" disabled={retrying} onClick={()=>void retryPdf()}>{retrying?'正在加载…':'重新加载'}</button></div>:!pdf?<div className="loading-state"><LoaderCircle className="spin"/><p>正在加载 PDF…</p></div>:<PdfPage pdf={pdf} page={page} language={language} bilingual={book.bilingual} zoom={zoom} annotations={book.annotations.filter(n=>n.page===page)} onSelection={setSelection} onError={setPdfError}/>}</div>}
      </div><footer className="reader-pagination"><button className="icon-button" aria-label="上一页" disabled={page===1} onClick={()=>changePage(page-1)}><ChevronLeft size={20}/></button><label className="page-number"><input aria-label="跳转页码" key={page} defaultValue={page} inputMode="numeric" onBlur={e=>{const next=Number(e.target.value);if(Number.isInteger(next)&&next>=1&&next<=book.pages)changePage(next);else e.target.value=String(page);}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/><span>/ {book.pages} 页</span></label><button className="icon-button" aria-label="下一页" disabled={page===book.pages} onClick={()=>changePage(page+1)}><ChevronRight size={20}/></button><span className="pagination-divider"/><button ref={bookmarkRef} aria-pressed={isBookmarked} className={`bookmark-page ${isBookmarked?'active':''}`} aria-label={isBookmarked?'取消本页书签':'收藏本页'} onClick={()=>onUpdate({bookmarks:isBookmarked?book.bookmarks.filter(p=>p!==page):[...book.bookmarks,page]}).catch(()=>{})}><Bookmark size={17} fill={isBookmarked?'currentColor':'none'}/></button><button className="mobile-notes-toggle" onClick={()=>setPanel(panel ? null : 'notes')}><NotebookPen size={18}/><span>笔记</span>{book.annotations.length>0&&<b>{book.annotations.length}</b>}</button><button className="mobile-directory icon-button" aria-label="页码与目录" onClick={()=>setPanel('pages')}><List size={18}/></button></footer></div>
      <aside className={`reader-panel ${panel?'is-open':''}`}>{panelBody}</aside>
      {panel&&<button className="panel-scrim" aria-label="关闭侧面板" onClick={()=>setPanel(null)}/>}
    </div>
    {selection&&!editor&&<div className="selection-bar" role="toolbar" aria-label="选中文字操作" onPointerDown={e=>e.preventDefault()}><span className="selection-label">已选 {selection.quote.length} 字</span><div className="swatches">{(['yellow','green','pink'] as MarkColor[]).map(c=><button key={c} className={`swatch ${c} ${color===c?'active':''}`} aria-label={`${c==='yellow'?'黄色':c==='green'?'绿色':'粉色'}高亮`} onClick={()=>setColor(c)}/>)}</div><button disabled={saving} onClick={()=>saveNote(draft(selection)).catch(()=>{})}><Highlighter size={17}/>高亮</button><button onClick={()=>newNote(selection)}><NotebookPen size={17}/>笔记</button><button className="icon-button" aria-label="取消选择" onClick={()=>{setSelection(null);window.getSelection()?.removeAllRanges();}}><X size={16}/></button></div>}
    {editor&&<NoteEditor note={editor} saving={saving} onCancel={()=>setEditor(null)} onSave={n=>saveNote(n).catch(()=>{})}/>}
    {deleting&&<div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="删除笔记"><h2>删除这条笔记？</h2><p>相关高亮也会移除。原文和译文不会改变。</p><div className="modal-actions"><button className="secondary-button" onClick={()=>setDeleting(null)}>保留</button><button className="danger-button" onClick={async()=>{try{await onUpdate({annotations:book.annotations.filter(n=>n.id!==deleting)});setDeleting(null);}catch{}}}>删除</button></div></section></div>}
    {help&&<div className="modal-backdrop" onClick={()=>setHelp(false)}><section className="modal" onClick={e=>e.stopPropagation()} role="dialog" aria-modal="true" aria-label="阅读说明"><button className="icon-button modal-close" aria-label="关闭说明" onClick={()=>setHelp(false)}><X size={20}/></button><h2>阅读说明</h2><p>段落可能有缺漏，图表、公式及修订以最终 PDF 为准。</p><div className="storage-row"><span>PDF 布局识别</span><button className="text-button" onClick={()=>{onUpdate({bilingual:!book.bilingual}).catch(()=>{});setLanguage(book.bilingual?'en':'zh');}}>{book.bilingual?'左右中英对照':'普通单页'} · 切换</button></div><p className="fineprint">左右布局识别有误时可切换。</p></section></div>}
  </div>;
}

function NoteEditor({note,saving,onCancel,onSave}:{note:Annotation;saving:boolean;onCancel:()=>void;onSave:(note:Annotation)=>void}) {
  const [text,setText]=useState(note.text);
  const [color,setColor]=useState(note.color);
  return <div className="modal-backdrop"><section className="modal note-editor" role="dialog" aria-modal="true" aria-label="编辑阅读笔记"><div className="editor-heading"><h2>笔记</h2><button className="icon-button" aria-label="取消编辑" onClick={onCancel} disabled={saving}><X size={20}/></button></div><span className="editor-meta">第 {note.page} 页 · {langLabel(note.language)}</span>{note.quote&&<blockquote className={`quote-${color}`}>{note.quote}</blockquote>}<textarea autoFocus aria-label="笔记内容" value={text} onChange={e=>setText(e.target.value)} placeholder="写笔记…" rows={5}/><div className="editor-footer"><div className="swatches">{(['yellow','green','pink'] as MarkColor[]).map(c=><button key={c} aria-label={`${c}笔记颜色`} className={`swatch ${c} ${color===c?'active':''}`} onClick={()=>setColor(c)}/>)}</div><button className="primary-button" disabled={saving||(!text.trim()&&!note.quote)} onClick={()=>onSave({...note,text,color})}>{saving?<LoaderCircle className="spin" size={17}/>:<Check size={17}/>}保存笔记</button></div><p className="fineprint">关闭前请保存。</p></section></div>;
}

type PdfBitmapRequest = { page: PDFPageProxy; viewport: ReturnType<PDFPageProxy['getViewport']>; width: number };

function PdfBitmap({request,onLoading,onError}:{request:PdfBitmapRequest|null;onLoading:(loading:boolean)=>void;onError:(message:string)=>void}) {
  const host=useRef<HTMLDivElement>(null);
  const displayed=useRef<HTMLCanvasElement|null>(null);
  const previousRequest=useRef<PdfBitmapRequest|null>(null);
  const readDensity=()=>Math.max(1,window.devicePixelRatio||1)*Math.max(1,window.visualViewport?.scale||1);
  const [density,setDensity]=useState(readDensity);
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>;
    const update=()=>{clearTimeout(timer);timer=setTimeout(()=>setDensity(readDensity()),180);};
    window.addEventListener('resize',update);
    window.visualViewport?.addEventListener('resize',update);
    return()=>{clearTimeout(timer);window.removeEventListener('resize',update);window.visualViewport?.removeEventListener('resize',update);};
  },[]);
  useEffect(()=>{
    if(!request)return;
    let disposed=false;
    const canvas=document.createElement('canvas');
    const size=pdfBitmapSize(request.width,request.viewport.height,density);
    canvas.width=size.width;canvas.height=size.height;
    canvas.style.width=`${request.width}px`;canvas.style.height=`${request.viewport.height}px`;
    // Density changes update only the bitmap, preserving text selection and highlights.
    if(previousRequest.current!==request||!displayed.current)onLoading(true);
    previousRequest.current=request;
    const render=request.page.render({canvas,viewport:request.viewport,transform:[size.scaleX,0,0,size.scaleY,0,0]});
    render.promise.then(()=>{
      if(disposed)return;
      const old=displayed.current;
      host.current?.replaceChildren(canvas);displayed.current=canvas;
      if(old){old.width=0;old.height=0;}
      onLoading(false);
    }).catch(e=>{
      if(!disposed&&e?.name!=='RenderingCancelledException'){
        onError('PDF 渲染失败，请尝试重新打开文献。');onLoading(false);
      }
    }).finally(()=>{if(displayed.current!==canvas){canvas.width=0;canvas.height=0;}});
    return()=>{disposed=true;render.cancel();};
  },[request,density,onLoading,onError]);
  useEffect(()=>()=>{const canvas=displayed.current;if(canvas){canvas.width=0;canvas.height=0;}},[]);
  return <div className="pdf-bitmap" ref={host}/>;
}

function PdfPage({pdf,page,language,bilingual,zoom,annotations,onSelection,onError}:{pdf:PDFDocumentProxy;page:number;language:Language;bilingual:boolean;zoom:number;annotations:Annotation[];onSelection:(data:SelectionData)=>void;onError:(s:string)=>void}) {
  const host=useRef<HTMLDivElement>(null); const surface=useRef<HTMLDivElement>(null); const textHost=useRef<HTMLDivElement>(null);
  const [bitmap,setBitmap]=useState<PdfBitmapRequest|null>(null); const [bitmapLoading,setBitmapLoading]=useState(true);
  const [width,setWidth]=useState(600); const [geometry,setGeometry]=useState({width:600,height:800,fullWidth:600,offset:0}); const [loading,setLoading]=useState(true);
  const geometryRef=useRef(geometry); geometryRef.current=geometry;
  useEffect(()=>{const el=host.current!;const observer=new ResizeObserver(entries=>setWidth(Math.max(250,entries[0].contentRect.width)));observer.observe(el);return()=>observer.disconnect();},[]);
  useEffect(()=>{
    let disposed=false;let textLayer:TextLayer|undefined;
    const root=textHost.current!;root.replaceChildren();setLoading(true);
    (async()=>{
      const p=await pdf.getPage(page);if(disposed)return;
      const raw=p.getViewport({scale:1});const split=bilingual&&language!=='both';const sourceWidth=split?raw.width/2:raw.width;
      const scale=width*zoom/sourceWidth; const offset=split&&language==='zh'?raw.width*scale/2:0;
      const viewport=p.getViewport({scale,offsetX:-offset});const outWidth=sourceWidth*scale;
      const newGeometry={width:outWidth,height:viewport.height,fullWidth:raw.width*scale,offset};setGeometry(newGeometry);
      setBitmap({page:p,viewport,width:outWidth});
      const text=document.createElement('div');text.className='textLayer';text.style.setProperty('--scale-factor',String(scale));text.style.setProperty('--total-scale-factor',String(scale));
      root.style.setProperty('--scale-factor',String(scale));root.style.setProperty('--total-scale-factor',String(scale));
      root.append(text);
      textLayer=new TextLayer({textContentSource:await p.getTextContent(),container:text,viewport:p.getViewport({scale})});text.style.width=`${raw.width*scale}px`;text.style.height=`${viewport.height}px`;text.style.transform=`translateX(-${offset}px)`;await textLayer.render();if(!disposed)setLoading(false);
    })().catch(e=>{if(!disposed&&e?.name!=='RenderingCancelledException'&&e?.name!=='AbortException'){onError('PDF 渲染失败，请尝试重新打开文献。');setLoading(false);}});
    return()=>{disposed=true;textLayer?.cancel();};
  },[pdf,page,width,zoom,language,bilingual]);
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>;
    const capture=()=>{clearTimeout(timer);timer=setTimeout(()=>{
      const sel=window.getSelection();const root=surface.current;if(!sel||!root||sel.isCollapsed||!sel.rangeCount||!root.contains(sel.anchorNode)||!root.contains(sel.focusNode))return;
      const quote=sel.toString().trim();if(!quote)return;
      const box=root.getBoundingClientRect();const g=geometryRef.current;
      const rects:Array<Rect>=Array.from(sel.getRangeAt(0).getClientRects()).filter(r=>r.width>1&&r.height>1&&r.left<box.right&&r.right>box.left).map(r=>({x:(Math.max(r.left,box.left)-box.left+g.offset)/g.fullWidth,y:Math.max(0,(r.top-box.top)/g.height),width:(Math.min(r.right,box.right)-Math.max(r.left,box.left))/g.fullWidth,height:r.height/g.height}));
      if(rects.length)onSelection({quote,rects,page,language});
    },200);};document.addEventListener('selectionchange',capture);return()=>{document.removeEventListener('selectionchange',capture);clearTimeout(timer);};
  },[page,language,onSelection]);
  return <div className="pdf-width-host" ref={host}><div className="pdf-overflow"><div className="pdf-stage" style={{width:geometry.width,height:geometry.height}}><div ref={surface} className="pdf-surface" style={{width:geometry.width,height:geometry.height}}><PdfBitmap request={bitmap} onLoading={setBitmapLoading} onError={onError}/><div ref={textHost}/></div><div className="pdf-highlights" aria-hidden="true">{annotations.flatMap(n=>n.rects.map((r,i)=><div className={`pdf-highlight ${n.color}`} key={`${n.id}-${i}`} style={{left:r.x*geometry.fullWidth-geometry.offset,top:r.y*geometry.height,width:r.width*geometry.fullWidth,height:r.height*geometry.height}}/>))}</div>{(loading||bitmapLoading)&&<div className="pdf-loading"><LoaderCircle className="spin" size={22}/></div>}</div></div></div>;
}
