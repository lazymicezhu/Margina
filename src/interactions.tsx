import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';

// Unit-mass spring response. Shared by drag feedback and affirmative actions.
export function springFrames(stiffness: number, damping: number, duration: number) {
  const frequency = Math.sqrt(stiffness);
  const ratio = damping / (2 * frequency);
  return Array.from({ length: 61 }, (_, index) => {
    const t = index / 60 * duration / 1000;
    if (ratio < 1) {
      const damped = frequency * Math.sqrt(1 - ratio * ratio);
      return 1 - Math.exp(-ratio * frequency * t) * (Math.cos(damped * t) + ratio * frequency / damped * Math.sin(damped * t));
    }
    const root = Math.sqrt(ratio * ratio - 1);
    const a = -frequency * (ratio - root), b = -frequency * (ratio + root);
    return 1 - (b * Math.exp(a * t) - a * Math.exp(b * t)) / (b - a);
  });
}

export function useSpringFeedback<T extends HTMLElement>(active: boolean, kind: 'drag' | 'confirm' = 'confirm') {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active || !ref.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const drag = kind === 'drag';
    const duration = drag ? 420 : 650;
    const animation = ref.current.animate(springFrames(drag ? 1200 : 380, drag ? 80 : 18, duration).map(value => ({
      transform: `scale(${1 - (drag ? .025 : .18) * (1 - value)})`,
    })), { duration, easing: 'linear' });
    return () => animation.cancel();
  }, [active, kind]);
  return ref;
}

export function CopyButton({ text, onError }: { text: string; onError: () => void }) {
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);
  const ref = useSpringFeedback<HTMLSpanElement>(copied);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!copied) return;
    // Hold for 2.5 s, then fade out for 180 ms before restoring the copy icon.
    const timer = setTimeout(() => setCopied(false), 2680);
    return () => clearTimeout(timer);
  }, [copied]);
  return <button className={`icon-button copy-button ${copied ? 'is-copied' : ''}`} aria-label={copied ? '已复制' : '复制笔记'} title={copied ? '已复制' : '复制笔记'} disabled={pending || copied} onClick={async () => {
    setPending(true);
    try { await navigator.clipboard.writeText(text); if (mounted.current) setCopied(true); }
    catch { if (mounted.current) onError(); }
    finally { if (mounted.current) setPending(false); }
  }}><span className="copy-glyph" ref={ref}>{copied ? <Check size={14}/> : <Copy size={14}/>}</span><span className="sr-only" role="status">{copied ? '已复制' : ''}</span></button>;
}

export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return <div className="disclosure"><button className="disclosure-toggle" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>{label}<ChevronDown size={13}/></button><div id={id} className={`collapse ${expanded ? 'is-expanded' : ''}`} inert={!expanded} aria-hidden={!expanded}><div className="collapse-inner">{children}</div></div></div>;
}

// Only short interface messages animate; document text always renders immediately.
export function RevealText({ text }: { text: string }) {
  if (Array.from(text).length > 60) return <span>{text}</span>;
  return <><span className="sr-only">{text}</span><span aria-hidden="true">{Array.from(text).map((character, index) => <span className="stream-character" style={{ '--character-index': index } as CSSProperties} key={index}>{character}</span>)}</span></>;
}
