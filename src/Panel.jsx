import { useEffect, useRef } from 'react';

// Shared overlay shell: a centred dialog (auth) or a right-hand drawer (cart).
export default function Panel({ title, accent, onClose, kind = 'dialog', children }) {
  const box = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement;
    const onKey = (e) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab' && box.current) {
        const f = box.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    if (!box.current.contains(document.activeElement)) box.current.focus();
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, []);

  return (
    <div className={'pn-backdrop pn-' + kind} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pn-box" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={box} style={{ '--accent': accent }}>
        <div className="pn-head">
          <h2>{title}</h2>
          <button type="button" className="pn-x" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
