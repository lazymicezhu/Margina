import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

export type PageRequest = { page: number; revision: number };

type Props = {
  root: RefObject<HTMLDivElement | null>;
  count: number;
  initialPage: number;
  request: PageRequest;
  onPage: (page: number) => void;
  children: (page: number) => ReactNode;
};

// Keep lightweight page slots so progress, bookmarks and notes retain their
// existing page numbers. Only nearby slots hold text layers and PDF canvases.
export function ContinuousPages({ root, count, initialPage, request, onPage, children }: Props) {
  const list = useRef<HTMLDivElement>(null);
  const startPage = useRef(initialPage);
  const lastRequest = useRef(request);
  const currentPage = useRef(initialPage);
  const onPageRef = useRef(onPage); onPageRef.current = onPage;
  const [visible, setVisible] = useState(() => new Set([initialPage - 1, initialPage, initialPage + 1]));
  const pendingJump = useRef<number | null>(initialPage);
  const frame = useRef(0);

  const locate = () => {
    const container = root.current, pages = list.current?.children;
    if (!container || !pages?.length || pendingJump.current !== null) return;
    const line = container.getBoundingClientRect().top + Math.min(80, container.clientHeight / 4);
    let lo = 0, hi = pages.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (pages[mid].getBoundingClientRect().bottom <= line) lo = mid + 1;
      else hi = mid;
    }
    if (currentPage.current !== lo + 1) {
      currentPage.current = lo + 1;
      onPageRef.current(lo + 1);
    }
  };
  const scheduleLocate = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(locate);
  };
  const jump = (page: number) => {
    const container = root.current, slot = list.current?.children[page - 1];
    if (!container || !slot) return;
    container.scrollTo({ top: container.scrollTop + slot.getBoundingClientRect().top - container.getBoundingClientRect().top, behavior: 'instant' });
  };

  useLayoutEffect(() => {
    const target = Math.min(count, Math.max(1, lastRequest.current === request ? startPage.current : request.page));
    lastRequest.current = request;
    pendingJump.current = target;
    currentPage.current = target;
    setVisible(new Set([target - 1, target, target + 1]));
    jump(target);
    // Correct once the requested page has mounted, before observing scroll.
    const id = requestAnimationFrame(() => { jump(target); pendingJump.current = null; });
    return () => cancelAnimationFrame(id);
  }, [request, count]);

  useEffect(() => {
    const container = root.current, pages = list.current;
    if (!container || !pages) return;
    const observer = new IntersectionObserver(entries => {
      setVisible(previous => {
        const next = new Set(previous);
        for (const entry of entries) {
          const number = Number((entry.target as HTMLElement).dataset.readerPage);
          if (entry.isIntersecting) next.add(number); else next.delete(number);
        }
        return next;
      });
    }, { root: container, rootMargin: '400px 0px' });
    for (const slot of pages.children) observer.observe(slot);
    container.addEventListener('scroll', scheduleLocate, { passive: true });
    window.addEventListener('resize', scheduleLocate);
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame.current);
      container.removeEventListener('scroll', scheduleLocate);
      window.removeEventListener('resize', scheduleLocate);
    };
  }, [root, count]);

  return <div className="continuous-pages" ref={list}>{Array.from({ length: count }, (_, index) => {
    const page = index + 1;
    return <PageSlot key={page} page={page} active={visible.has(page)} onResize={() => {
      if (pendingJump.current !== null) jump(pendingJump.current);
      else scheduleLocate();
    }}>{() => children(page)}</PageSlot>;
  })}</div>;
}

function PageSlot({ page, active, children, onResize }: { page: number; active: boolean; children: () => ReactNode; onResize: () => void }) {
  const content = useRef<HTMLDivElement>(null);
  const height = useRef(1000);
  const resize = useRef(onResize); resize.current = onResize;
  useLayoutEffect(() => {
    const element = content.current;
    if (!active || !element) return;
    const measure = () => { height.current = element.getBoundingClientRect().height; resize.current(); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);
  return <div className="continuous-page" data-reader-page={page} style={active ? undefined : { height: height.current }}>
    {active && <div ref={content}>{children()}</div>}
  </div>;
}
