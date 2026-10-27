import { useEffect, useRef } from 'react';
import { Star } from 'lucide-react';

export default function ShelfRating({ title, rating, expanded, busy, open, close, change }: {
  title: string; rating: number; expanded: boolean; busy: boolean;
  open: () => void; close: () => void; change: (rating: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close); closeRef.current = close;
  const wasExpanded = useRef(false);
  useEffect(() => {
    if (expanded) root.current?.querySelectorAll('button')[Math.max(0, rating - 1)]?.focus();
    else if (wasExpanded.current && document.activeElement === document.body) root.current?.querySelector('button')?.focus();
    wasExpanded.current = expanded;
  }, [expanded]);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) closeRef.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); requestAnimationFrame(() => root.current?.querySelector('button')?.focus()); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [expanded]);
  return <div className={`shelf-rating ${expanded ? 'expanded' : ''}`} ref={root} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) close(); }}>
    {expanded ? <div className="shelf-rating-choices" role="group" aria-label={`${title}，选择星级`}>
      {[1, 2, 3, 4, 5].map(value => <button type="button" className={`inline-rating-star ${rating >= value ? 'is-rated' : ''}`} key={value} disabled={busy} aria-label={rating === value ? `取消 ${value} 星评分` : `评为 ${value} 星`} aria-pressed={rating === value} title={rating === value ? '再次点击取消评分' : `${value} 星`} onClick={() => change(rating === value ? 0 : value)}><Star size={19} fill={rating >= value ? 'currentColor' : 'none'} /></button>)}
    </div> : <button type="button" className={`icon-button shelf-rating-button ${rating ? 'is-rated' : ''}`} aria-label={`设置星级 ${title}，${rating ? `${rating} 星` : '未评分'}`} aria-expanded={false} title={rating ? `当前 ${rating} 星，点击修改` : '设置星级'} disabled={busy} onClick={open}><Star size={19} fill={rating ? 'currentColor' : 'none'} /></button>}
  </div>;
}
