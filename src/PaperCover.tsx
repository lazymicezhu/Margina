import { useEffect, useRef, useState } from 'react';
import { BookOpen } from 'lucide-react';
import type { Paper } from './cloud-types';
import { storedCover } from './cover-client';

const lanes: Promise<void>[] = [Promise.resolve(), Promise.resolve()];
let nextLane = 0;
function enqueue(work: () => Promise<void>) {
  const lane = nextLane++ % lanes.length;
  lanes[lane] = lanes[lane].then(work).catch(() => {});
}
export default function PaperCover({ paper, title, cachedCover, allowed, owner }: { paper: Paper; title: string; cachedCover?: string; allowed: boolean; owner?: string }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [cover, setCover] = useState('');
  useEffect(() => {
    setCover('');
    if (!allowed || paper.format === 'txt' || paper.removed) return;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (controller.signal.aborted) return;
      timeout = setTimeout(() => controller.abort(), paper.canUpdateCover && !paper.coverVersion ? 60000 : 15000);
      try {
        const image = await storedCover(paper, owner, paper.coverVersion ? undefined : cachedCover, controller.signal);
        if (!controller.signal.aborted) setCover(image);
      } catch { /* A failed image request keeps the title cover and reading usable. */ }
      finally { clearTimeout(timeout); }
    };
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); enqueue(load); }
    }, { rootMargin: '120px' });
    if (anchor.current) observer.observe(anchor.current);
    return () => { observer.disconnect(); clearTimeout(timeout); controller.abort(); };
  }, [paper.id, paper.coverVersion, paper.canUpdateCover, paper.format, paper.removed, paper.bilingual, paper.visibility, paper.privateOwner, cachedCover, allowed, owner]);
  const image = allowed ? cover || (!paper.coverVersion ? cachedCover : '') : '';
  return <div ref={anchor} className="cover-content">
    {image ? <div className="paper-thumbnail"><img src={image} alt="" onError={() => setCover('')} /></div> : <div className="typographic-cover"><BookOpen size={28} strokeWidth={1.2} /><strong>{title}</strong><span>{paper.author || 'Margina 书库'}</span></div>}
  </div>;
}
