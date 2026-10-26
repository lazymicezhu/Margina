import { useEffect, useRef, useState } from 'react';
import { BookOpen } from 'lucide-react';
import type { Paper } from './cloud-types';
import { loadPdfCover, renderPdfCover } from './pdf';
import { shelfHeaders } from './shelf-lock';
import { setting } from './storage';

// At most two PDF parsers/downloads at once, including long shelves on phones.
const lanes: Promise<void>[] = [Promise.resolve(), Promise.resolve()];
let nextLane = 0;
function enqueue(work: () => Promise<void>) {
  const lane = nextLane++ % lanes.length;
  lanes[lane] = lanes[lane].then(work).catch(() => {});
}

export default function PaperCover({ paper, title, cachedCover, allowed }: { paper: Paper; title: string; cachedCover?: string; allowed: boolean }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [cover, setCover] = useState('');
  useEffect(() => {
    setCover('');
    if (!allowed || cachedCover || paper.format === 'txt' || paper.removed) return;
    let cancelled = false;
    let task: ReturnType<typeof loadPdfCover> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const key = `cover-v1:${paper.privateOwner || 'public'}:${paper.id}:${paper.bilingual ? 'zh' : 'full'}`;
    const load = async () => {
      try {
        if (cancelled) return;
        const saved = await setting(key).catch(() => undefined);
        if (cancelled) return;
        if (typeof saved === 'string' && saved.startsWith('data:image/')) { setCover(saved); return; }
        const url = paper.visibility === 'private' ? `/api/account/files/${paper.id}/file` : `/api/papers/${paper.id}/file`;
        task = loadPdfCover(url, shelfHeaders());
        timeout = setTimeout(() => { void task?.destroy(); }, 30000);
        const pdf = await task.promise;
        if (cancelled) return;
        const image = await renderPdfCover(pdf, paper.bilingual);
        if (!cancelled) {
          setCover(image);
          await setting(key, image).catch(() => {});
        }
      } catch { /* Keep the title cover readable when offline or parsing fails. */ }
      finally { clearTimeout(timeout); await task?.destroy(); }
    };
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); enqueue(load); }
    }, { rootMargin: '120px' });
    if (anchor.current) observer.observe(anchor.current);
    return () => { cancelled = true; observer.disconnect(); clearTimeout(timeout); void task?.destroy(); };
  }, [paper.id, paper.format, paper.removed, paper.bilingual, paper.visibility, paper.privateOwner, cachedCover, allowed]);
  const image = allowed ? cachedCover || cover : '';
  return <div ref={anchor} className="cover-content">
    {image ? <div className="paper-thumbnail"><img src={image} alt="" /></div> : <div className="typographic-cover"><BookOpen size={28} strokeWidth={1.2} /><strong>{title}</strong><span>{paper.author || 'Margina 书库'}</span></div>}
  </div>;
}
