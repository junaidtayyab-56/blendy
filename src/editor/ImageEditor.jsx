// Image editor workspace for the admin: the homepage slide of one product, with its
// background, bottle and floating fruit as separate layers. Nothing is uploaded until
// "Save changes"; originals are kept and edited copies are saved as new files.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SHADOWS } from '../flavours.js';
import {
  DEFAULT_BG, DEFAULT_EDIT, FRAME_H, FRAME_W, GENERIC_BOTTLE, MAX_FRUIT_LAYERS,
  GENERIC_PIECES, defaultScene, fitBox, flavourFor, needsBake, newId, sheetBox, sourceUrl,
} from './scene.js';
import { aspectOf, baseOf, drawLayer, exportForWeb, loadImage } from './render.js';
import { removeBackground } from './removeBg.js';
import './editor.css';

const MAX_UPLOAD = 5 * 1024 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';
const SWATCHES = ['#C2B0DC', '#B4D58A', '#F3DA8A', '#F2AFC0', '#FFFFFF', '#2F2440', '#9ED8E6', '#FFB38A'];
const SHAPES = [['original', 'Original'], ['square', 'Square'], ['circle', 'Circle'], ['rounded', 'Rounded']];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const extOf = (type) => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' }[type] || 'png');

// ---------------------------------------------------------------------------
// Small pieces

function useImage(url) {
  const [img, setImg] = useState(null);
  useEffect(() => {
    let ok = true;
    setImg(null);
    if (url) loadImage(url).then((i) => ok && setImg(i), () => ok && setImg(false));
    return () => { ok = false; };
  }, [url]);
  return img;
}

// A layer's picture with its edits applied, drawn live.
export function LayerCanvas({ layer, maxSide = 900, className = '' }) {
  const base = baseOf(layer);
  const img = useImage(base.url);
  const ref = useRef(null);
  const boxKey = base.box ? base.box.join(',') : '';
  const editKey = JSON.stringify(layer.edit || DEFAULT_EDIT);
  useEffect(() => {
    if (!img || !ref.current) return;
    const c = drawLayer(img, base.box, layer.edit, maxSide);
    const cv = ref.current;
    cv.width = c.width; cv.height = c.height;
    cv.getContext('2d').drawImage(c, 0, 0);
  }, [img, boxKey, editKey, maxSide]); // eslint-disable-line react-hooks/exhaustive-deps
  if (img === false) return <div className={'bx-ed-broken ' + className}>Image not available</div>;
  return <canvas ref={ref} className={className} />;
}

function Slider({ label, value, min, max, step = 1, onChange, suffix = '', onReset }) {
  return (
    <label className="bx-ed-slider">
      <span><b>{label}</b><em>{Math.round(value)}{suffix}</em>{onReset && <button type="button" onClick={(e) => { e.preventDefault(); onReset(); }}>Reset</button>}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function FileButton({ children, onFile, className = 'bx-ed-btn', disabled }) {
  return (
    <label className={className + (disabled ? ' is-disabled' : '')}>
      {children}
      <input type="file" accept={ACCEPT} hidden disabled={disabled} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Crop dialog: drag the box, or its corners, over the picture.

function CropDialog({ layer, onApply, onClose }) {
  const base = baseOf(layer);
  const img = useImage(base.url);
  const [url, setUrl] = useState(null);
  const [ratio, setRatio] = useState(0);
  const [rect, setRect] = useState(layer.edit?.crop || { x: 0, y: 0, w: 1, h: 1 });
  const wrap = useRef(null);
  const drag = useRef(null);
  const [nat, setNat] = useState([1, 1]);

  useEffect(() => {
    if (!img) return;
    const c = drawLayer(img, base.box, null, 1000);
    setNat([c.width, c.height]);
    setUrl(c.toDataURL('image/png'));
  }, [img]); // eslint-disable-line react-hooks/exhaustive-deps

  // ratio is width/height in pixels; in fractions of this picture that is ratio * H / W.
  const fr = ratio ? (ratio * nat[1]) / nat[0] : 0;
  function setAspect(r) {
    setRatio(r);
    if (!r) return;
    const f = (r * nat[1]) / nat[0];
    setRect((q) => {
      let w = q.w, h = w / f;
      if (h > 1) { h = 1; w = f; }
      if (w > 1) { w = 1; h = 1 / f; }
      return { x: clamp(q.x + (q.w - w) / 2, 0, 1 - w), y: clamp(q.y + (q.h - h) / 2, 0, 1 - h), w, h };
    });
  }

  function down(e, mode) {
    e.preventDefault(); e.stopPropagation();
    const r = wrap.current.getBoundingClientRect();
    drag.current = { mode, sx: e.clientX, sy: e.clientY, r0: rect, W: r.width, H: r.height };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function move(e) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / d.W, dy = (e.clientY - d.sy) / d.H, q = d.r0, min = 0.05;
    if (d.mode === 'move') { setRect({ ...q, x: clamp(q.x + dx, 0, 1 - q.w), y: clamp(q.y + dy, 0, 1 - q.h) }); return; }
    const sx = d.mode.includes('e') ? 1 : -1, sy = d.mode.includes('s') ? 1 : -1;
    const ax = sx > 0 ? q.x : q.x + q.w, ay = sy > 0 ? q.y : q.y + q.h; // fixed corner
    let w = clamp(q.w + sx * dx, min, sx > 0 ? 1 - ax : ax);
    let h = clamp(q.h + sy * dy, min, sy > 0 ? 1 - ay : ay);
    if (fr) {
      if (w / h > fr) w = h * fr; else h = w / fr;
      const maxW = sx > 0 ? 1 - ax : ax, maxH = sy > 0 ? 1 - ay : ay;
      if (w > maxW) { w = maxW; h = w / fr; }
      if (h > maxH) { h = maxH; w = h * fr; }
    }
    setRect({ x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - h, w, h });
  }
  const up = () => { drag.current = null; };
  const full = rect.x <= 0.001 && rect.y <= 0.001 && rect.w >= 0.999 && rect.h >= 0.999;

  return (
    <div className="bx-ed-modal" role="dialog" aria-label="Crop image">
      <div className="bx-ed-modal-card">
        <div className="bx-ed-modal-head"><strong>Crop</strong>
          <div className="bx-ed-seg">
            {[[0, 'Free'], [1, '1:1'], [4 / 3, '4:3'], [3 / 4, '3:4'], [16 / 9, '16:9']].map(([r, l]) => (
              <button key={l} type="button" className={ratio === r ? 'on' : ''} onClick={() => setAspect(r)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="bx-ed-crop-area" onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          {url ? (
            <div className="bx-ed-crop-wrap" ref={wrap} style={{ aspectRatio: `${nat[0]} / ${nat[1]}`, width: `min(100%, calc(58vh * ${nat[0] / nat[1]}))` }}>
              <img src={url} alt="" draggable={false} />
              <div className="bx-ed-crop-box" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%` }} onPointerDown={(e) => down(e, 'move')}>
                {['nw', 'ne', 'sw', 'se'].map((h) => <i key={h} className={'bx-ed-h ' + h} onPointerDown={(e) => down(e, h)} />)}
              </div>
            </div>
          ) : <p className="bx-ed-muted">Loading…</p>}
        </div>
        <div className="bx-ed-modal-foot">
          <button type="button" className="bx-ed-btn" onClick={() => setRect({ x: 0, y: 0, w: 1, h: 1 })}>Reset crop</button>
          <span className="bx-ed-grow" />
          <button type="button" className="bx-ed-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="bx-ed-btn bx-ed-primary" onClick={() => onApply(full ? null : rect)}>Apply crop</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The workspace

export default function ImageEditor({ product, scene: initial, select = 'bottle', upload, onSave, onCancel }) {
  const [hist, setHist] = useState(() => ({ past: [], present: initial, future: [] }));
  const histRef = useRef(hist);
  histRef.current = hist;
  const scene = hist.present;
  const [sel, setSel] = useState(() => {
    if (select === 'background') return 'bg';
    if (select === 'bottle') return initial.layers.find((l) => l.kind === 'bottle')?.id || 'bg';
    return initial.layers.some((l) => l.id === select) ? select : 'bg';
  });
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(0.5);
  const [preview, setPreview] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [status, setStatus] = useState(null); // { text, progress, error }
  const [saving, setSaving] = useState(false);
  const pending = useRef(new Map()); // blob: url -> { blob, ext }
  const viewport = useRef(null);
  const frameRef = useRef(null);
  const gesture = useRef(null);
  const lastKey = useRef({ key: null, t: 0 });
  const scale = fit * zoom;
  const layer = scene.layers.find((l) => l.id === sel) || null;
  const dirty = hist.past.length > 0;

  // history
  const commit = useCallback((fn) => setHist((h) => {
    const next = typeof fn === 'function' ? fn(h.present) : fn;
    if (next === h.present) return h;
    return { past: [...h.past.slice(-80), h.present], present: next, future: [] };
  }), []);
  const replace = useCallback((fn) => setHist((h) => ({ ...h, present: typeof fn === 'function' ? fn(h.present) : fn })), []);
  // Slider moves within a short time count as one undo step.
  const commitKey = useCallback((key, fn) => {
    const now = performance.now();
    const same = lastKey.current.key === key && now - lastKey.current.t < 900;
    lastKey.current = { key, t: now };
    (same ? replace : commit)(fn);
  }, [commit, replace]);
  const undo = useCallback(() => setHist((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h)), []);
  const redo = useCallback(() => setHist((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h)), []);

  const updLayer = useCallback((id, patch, how = commit) => how((s) => ({ ...s, layers: s.layers.map((l) => (l.id === id ? { ...l, ...(typeof patch === 'function' ? patch(l) : patch) } : l)) })), [commit]);
  const setEdit = (patch, key) => {
    if (!layer) return;
    const how = key ? (fn) => commitKey(layer.id + key, fn) : commit;
    updLayer(layer.id, (l) => ({ edit: { ...DEFAULT_EDIT, ...l.edit, ...patch } }), how);
  };
  const setBg = (patch, key) => (key ? (fn) => commitKey('bg' + key, fn) : commit)((s) => ({ ...s, background: { ...s.background, ...patch } }));

  // Fit the frame to the viewport.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth - 24, h = el.clientHeight - 24;
      setFit(Math.max(0.12, Math.min(w / FRAME_W, h / FRAME_H)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep each box the same shape as its picture: place new pictures inside their box, and
  // follow crop/shape changes, keeping the centre where it was.
  const shapeKey = scene.layers.map((l) => [l.id, baseOf(l).url, l.edit?.shape, JSON.stringify(l.edit?.crop), l.fit || ''].join('|')).join(';');
  useEffect(() => {
    let ok = true;
    Promise.all(scene.layers.map(async (l) => {
      const base = baseOf(l);
      try { return [l.id, await loadImage(base.url), base.box, base.url]; } catch { return null; }
    })).then((rows) => {
      if (!ok) return;
      replace((s) => {
        let changed = false;
        const layers = s.layers.map((l) => {
          const row = rows.find((r) => r && r[0] === l.id);
          if (!row) return l;
          const [, img, box, url] = row;
          if (baseOf(l).url !== url) return l;
          const a = aspectOf(l.edit, img, box);
          if (l.fit) {
            changed = true;
            const nb = fitBox([l.x, l.y, l.w, l.h], 1, a, l.fit === 'bottom' ? 'bottom' : 'center');
            const { fit: _f, ...rest } = l;
            return { ...rest, ...nb };
          }
          const h = l.w * a;
          if (Math.abs(h - l.h) < 0.5) return l;
          changed = true;
          return { ...l, h, y: l.y + (l.h - h) / 2 };
        });
        return changed ? { ...s, layers } : s;
      });
    });
    return () => { ok = false; };
  }, [shapeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lock page scroll and wire shortcuts while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (cropping || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (!layer) return;
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d) { e.preventDefault(); updLayer(layer.id, (l) => ({ x: l.x + d[0], y: l.y + d[1] }), (fn) => commitKey(layer.id + 'nudge', fn)); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && layer.kind === 'fruit') { e.preventDefault(); removeLayer(layer.id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // re-bound each render so it sees the current layer

  // ---- pointer gestures on the stage
  function framePoint(e) {
    const r = frameRef.current.getBoundingClientRect();
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
  }
  function startGesture(e, l, mode) {
    if (preview) return;
    e.preventDefault(); e.stopPropagation();
    setSel(l.id);
    const [px, py] = framePoint(e);
    gesture.current = { mode, l0: l, px, py, start: histRef.current.present, id: l.id };
    window.addEventListener('pointermove', onGestureMove);
    window.addEventListener('pointerup', endGesture);
    window.addEventListener('pointercancel', endGesture);
  }
  function onGestureMove(e) {
    const g = gesture.current;
    if (!g) return;
    const [px, py] = framePoint(e);
    const dx = px - g.px, dy = py - g.py, l = g.l0;
    let patch;
    if (g.mode === 'move') patch = { x: l.x + dx, y: l.y + dy };
    else if (g.mode === 'rotate') {
      const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
      const a0 = Math.atan2(g.py - cy, g.px - cx), a1 = Math.atan2(py - cy, px - cx);
      let rot = l.rot + ((a1 - a0) * 180) / Math.PI;
      rot = ((rot + 540) % 360) - 180;
      const snap = e.shiftKey ? 15 : 90;
      const near = Math.round(rot / snap) * snap;
      if (e.shiftKey || Math.abs(rot - near) < 3) rot = near;
      patch = { rot: Math.round(rot * 10) / 10 };
    } else {
      // Corner resize with the aspect ratio locked and the opposite corner pinned.
      const sx = g.mode.includes('e') ? 1 : -1, sy = g.mode.includes('s') ? 1 : -1;
      const t = (l.rot * Math.PI) / 180, cos = Math.cos(t), sin = Math.sin(t);
      const lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos;
      const k = Math.max(16 / l.w, ((l.w + sx * lx) / l.w + (l.h + sy * ly) / l.h) / 2);
      const w = l.w * k, h = l.h * k;
      const ox = (sx * (w - l.w)) / 2, oy = (sy * (h - l.h)) / 2;
      const cx = l.x + l.w / 2 + ox * cos - oy * sin, cy = l.y + l.h / 2 + ox * sin + oy * cos;
      patch = { w, h, x: cx - w / 2, y: cy - h / 2 };
    }
    replace((s) => ({ ...s, layers: s.layers.map((q) => (q.id === g.id ? { ...q, ...patch } : q)) }));
  }
  function endGesture() {
    const g = gesture.current;
    gesture.current = null;
    window.removeEventListener('pointermove', onGestureMove);
    window.removeEventListener('pointerup', endGesture);
    window.removeEventListener('pointercancel', endGesture);
    if (!g) return;
    setHist((h) => (h.present === g.start ? h : { past: [...h.past.slice(-80), g.start], present: h.present, future: [] }));
  }

  // ---- layer actions
  function addFile(file, then) {
    if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(file.type)) { setStatus({ error: 'Please choose a PNG, JPG, WebP, GIF or AVIF image.' }); return; }
    if (file.size > MAX_UPLOAD) { setStatus({ error: 'Images must be under 5 MB.' }); return; }
    const url = URL.createObjectURL(file);
    pending.current.set(url, { blob: file, ext: extOf(file.type) });
    then(url);
  }
  const replaceImage = (file) => addFile(file, (url) => updLayer(layer.id, (l) => ({ source: { url }, cut: null, src: null, bakedSig: null, edit: { ...DEFAULT_EDIT }, fit: l.kind === 'bottle' ? 'bottom' : 'center' })));
  function addFruit(file) {
    addFile(file, (url) => {
      const id = newId('f');
      commit((s) => ({ ...s, layers: [...s.layers, { id, kind: 'fruit', depth: 'f', source: { url }, cut: null, src: null, edit: { ...DEFAULT_EDIT }, x: 640, y: 330, w: 170, h: 170, rot: 0, fit: 'center' }] }));
      setSel(id);
    });
  }
  function addBottle(file) {
    addFile(file, (url) => {
      const id = newId('b');
      const [x, y, w, h] = GENERIC_BOTTLE;
      commit((s) => ({ ...s, layers: [{ id, kind: 'bottle', depth: 'f', source: { url }, cut: null, src: null, edit: { ...DEFAULT_EDIT }, x, y, w, h, rot: 0, fit: 'bottom' }, ...s.layers] }));
      setSel(id);
    });
  }
  function removeLayer(id) {
    commit((s) => ({ ...s, layers: s.layers.filter((l) => l.id !== id) }));
    setSel('bg');
  }
  function duplicate() {
    if (!layer || fruitCount >= MAX_FRUIT_LAYERS) return;
    const id = newId('f');
    commit((s) => {
      const i = s.layers.findIndex((l) => l.id === layer.id);
      const copy = { ...layer, id, x: layer.x + 30, y: layer.y + 30 };
      return { ...s, layers: [...s.layers.slice(0, i + 1), copy, ...s.layers.slice(i + 1)] };
    });
    setSel(id);
  }
  function reorder(dir) {
    commit((s) => {
      const fruits = s.layers.filter((l) => l.kind === 'fruit');
      const i = fruits.findIndex((l) => l.id === layer.id), j = i + dir;
      if (i < 0 || j < 0 || j >= fruits.length) return s;
      [fruits[i], fruits[j]] = [fruits[j], fruits[i]];
      return { ...s, layers: [...s.layers.filter((l) => l.kind !== 'fruit'), ...fruits] };
    });
  }
  async function toggleRemoveBg() {
    if (!layer) return;
    if (layer.edit?.removeBg) { setEdit({ removeBg: false }); return; }
    if (layer.cut) { setEdit({ removeBg: true }); return; }
    const id = layer.id;
    try {
      setStatus({ text: 'Preparing background remover…', progress: null });
      const img = await loadImage(sourceUrl(layer.source));
      const blob = await removeBackground(img, sheetBox(layer.source), (progress, text) => setStatus({ text, progress }));
      const url = URL.createObjectURL(blob);
      pending.current.set(url, { blob, ext: 'png' });
      updLayer(id, (l) => ({ cut: url, edit: { ...DEFAULT_EDIT, ...l.edit, removeBg: true } }));
      setStatus(null);
    } catch (err) {
      console.error(err);
      setStatus({ error: 'Background removal failed. Check your internet connection and try again.' });
    }
  }
  // Original look of a layer: no edits, and its standard spot on the slide.
  function originalPatch(l, s) {
    const clean = { edit: { ...DEFAULT_EDIT }, src: null, bakedSig: null };
    if (l.source?.sheet) {
      const d = defaultScene({ slug: product?.slug }).layers.filter((q) => q.kind === l.kind && JSON.stringify(q.source) === JSON.stringify(l.source));
      const same = s.layers.filter((q) => q.kind === l.kind && JSON.stringify(q.source) === JSON.stringify(l.source));
      const o = d[Math.max(0, same.indexOf(l)) % Math.max(1, d.length)];
      if (o) return { ...clean, edit: { ...o.edit }, x: o.x, y: o.y, w: o.w, h: o.h, rot: o.rot, depth: o.depth };
      return { ...clean, rot: 0 };
    }
    if (l.kind === 'bottle') { const [x, y, w, h] = GENERIC_BOTTLE; return { ...clean, x, y, w, h, rot: 0, fit: 'bottom' }; }
    const k = s.layers.filter((q) => q.kind === 'fruit').indexOf(l);
    const [x, y, w, rot, mir, lay] = GENERIC_PIECES[Math.max(0, k) % GENERIC_PIECES.length];
    return { ...clean, edit: { ...DEFAULT_EDIT, flipX: !!mir }, x, y, w, h: w, rot: mir ? -rot : rot, depth: lay, fit: 'center' };
  }
  function resetLayer() {
    if (!layer) return;
    commit((s) => ({ ...s, layers: s.layers.map((l) => (l.id === layer.id ? { ...l, ...originalPatch(l, s) } : l)) }));
  }
  function resetAll() {
    const fl = flavourFor(product?.slug);
    if (!window.confirm(fl ? `Reset this slide to the original ${fl.name} artwork, colour and positions? You can still undo or cancel afterwards.` : 'Remove all edits and put every picture back in its standard spot? You can still undo or cancel afterwards.')) return;
    const next = fl ? defaultScene({ slug: product.slug })
      : { ...scene, background: { color: scene.background?.color || DEFAULT_BG, image: null }, layers: scene.layers.map((l) => ({ ...l, ...originalPatch(l, scene) })) };
    commit(next);
    setSel(next.layers.find((l) => l.kind === 'bottle')?.id || 'bg');
  }

  // ---- save: upload new originals and cut-outs, bake edited images, hand back the scene
  async function save() {
    setSaving(true);
    setStatus({ text: 'Saving images…', progress: null });
    try {
      const done = new Map();
      const up = async (url, kind) => {
        if (!url || !url.startsWith('blob:')) return url;
        if (!done.has(url)) {
          const p = pending.current.get(url);
          done.set(url, upload(p.blob, kind, p.ext));
        }
        return done.get(url);
      };
      const layers = [];
      for (const l of scene.layers) {
        const drawFrom = baseOf(l);
        const nl = { ...l, source: l.source.url ? { url: await up(l.source.url, 'original') } : l.source, cut: await up(l.cut, 'cut') };
        if (needsBake(nl)) {
          const sig = JSON.stringify([nl.source, nl.cut, nl.edit]);
          if (!(nl.src && nl.bakedSig === sig)) {
            setStatus({ text: `Saving ${l.kind === 'bottle' ? 'product image' : 'fruit image'}…`, progress: null });
            const img = await loadImage(drawFrom.url);
            const { blob, ext } = await exportForWeb(drawLayer(img, drawFrom.box, nl.edit, l.kind === 'bottle' ? 1200 : 700));
            nl.src = await upload(blob, 'edit', ext);
            nl.bakedSig = sig;
          }
        } else { nl.src = null; nl.bakedSig = null; }
        layers.push(nl);
      }
      const bgImg = scene.background?.image;
      const background = { color: scene.background?.color || DEFAULT_BG, image: bgImg?.src ? { src: await up(bgImg.src, 'background') } : null };
      await onSave({ v: 1, background, layers });
      setStatus(null);
    } catch (err) {
      console.error(err);
      setStatus({ error: 'Could not save: ' + (err.message || err) });
    } finally {
      setSaving(false);
    }
  }
  function cancel() {
    if (dirty && !window.confirm('Discard your image changes?')) return;
    onCancel();
  }

  // ---- render helpers
  const bottles = scene.layers.filter((l) => l.kind === 'bottle');
  const front = scene.layers.filter((l) => l.kind === 'fruit' && l.depth !== 'c');
  const corner = scene.layers.filter((l) => l.kind === 'fruit' && l.depth === 'c');
  const fruitCount = front.length + corner.length;
  const ordered = [...bottles, ...front, ...corner];
  const name = product?.name || '';
  const word = useMemo(() => {
    const size = Math.min(445, 1330 / Math.max(1, name.length * 0.62));
    return { size, top: 403.5 + (0.698 * size) / 2 - 0.85 * size };
  }, [name]);
  const bg = scene.background || { color: DEFAULT_BG };
  const bgStyle = { backgroundColor: bg.color || DEFAULT_BG, backgroundImage: bg.image?.src ? `url("${bg.image.src}")` : 'none' };
  const bottle = bottles[0];
  const fruitsList = scene.layers.filter((l) => l.kind === 'fruit');
  const label = (l) => (l.kind === 'bottle' ? 'Product image' : `Fruit ${fruitsList.indexOf(l) + 1}`);
  const S = (v) => v * scale;
  const boxStyle = (l) => ({ left: S(l.x), top: S(l.y), width: S(l.w), height: S(l.h) });

  const e = { ...DEFAULT_EDIT, ...(layer?.edit || {}) };

  return (
    <div className="bx-ed" role="dialog" aria-label="Image editor">
      <header className="bx-ed-top">
        <div className="bx-ed-title"><strong>Image editor</strong><span>{name || 'New product'}</span></div>
        <div className="bx-ed-tools">
          <button type="button" className="bx-ed-icon" onClick={undo} disabled={!hist.past.length} title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
          <button type="button" className="bx-ed-icon" onClick={redo} disabled={!hist.future.length} title="Redo (Ctrl+Y)" aria-label="Redo">↷</button>
          <span className="bx-ed-sep" />
          <button type="button" className="bx-ed-icon" onClick={() => setZoom((z) => clamp(+(z / 1.25).toFixed(3), 0.5, 4))} aria-label="Zoom out" title="Zoom out">−</button>
          <button type="button" className="bx-ed-zoom" onClick={() => setZoom(1)} title="Fit to screen">{Math.round(zoom * 100)}%</button>
          <button type="button" className="bx-ed-icon" onClick={() => setZoom((z) => clamp(+(z * 1.25).toFixed(3), 0.5, 4))} aria-label="Zoom in" title="Zoom in">+</button>
          <span className="bx-ed-sep" />
          <div className="bx-ed-seg">
            <button type="button" className={!preview ? 'on' : ''} onClick={() => setPreview(false)}>Edit</button>
            <button type="button" className={preview ? 'on' : ''} onClick={() => setPreview(true)}>Preview</button>
          </div>
          <button type="button" className="bx-ed-btn" onClick={resetAll}>Reset to original</button>
        </div>
        <div className="bx-ed-actions">
          <button type="button" className="bx-ed-btn" onClick={cancel} disabled={saving}>Cancel</button>
          <button type="button" className="bx-ed-btn bx-ed-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </header>

      <div className="bx-ed-body">
        <div className="bx-ed-viewport" ref={viewport} onPointerDown={() => !preview && setSel('bg')}>
          <div className={'bx-ed-frame' + (preview ? ' is-preview' : '')} ref={frameRef} style={{ width: S(FRAME_W), height: S(FRAME_H), ...bgStyle, '--s': scale }}>
            <div className="bx-ed-word" style={{ fontSize: S(word.size), top: S(word.top) }}>{name}</div>
            {SHADOWS.map(([cx, cy, w, h], i) => <div key={i} className="bx-ed-shd" style={{ left: S(cx - w / 2), top: S(cy - h / 2), width: S(w), height: S(h) }} />)}
            {ordered.map((l) => (
              <div key={l.id} className={'bx-ed-layer' + (l.kind === 'fruit' ? ' is-fruit' : '') + (l.depth === 'c' ? ' is-corner' : '') + (l.source?.url && l.kind === 'bottle' ? ' is-photo' : '') + (l.id === sel ? ' is-sel' : '')}
                style={boxStyle(l)} onPointerDown={(ev) => startGesture(ev, l, 'move')}>
                <div className="bx-ed-pi" style={{ '--r': `${l.rot}deg`, '--d': `${3.2 + ((l.id.charCodeAt(l.id.length - 1) % 18) / 10)}s` }}>
                  <LayerCanvas layer={l} maxSide={l.kind === 'bottle' ? 900 : 500} />
                </div>
              </div>
            ))}
            {!preview && layer && (
              <div className="bx-ed-selbox" style={{ ...boxStyle(layer), transform: `rotate(${layer.rot}deg)` }}>
                {['nw', 'ne', 'sw', 'se'].map((h) => <i key={h} className={'bx-ed-h ' + h} onPointerDown={(ev) => startGesture(ev, layer, h)} />)}
                <i className="bx-ed-rot" title="Drag to rotate" onPointerDown={(ev) => startGesture(ev, layer, 'rotate')} />
              </div>
            )}
          </div>
        </div>

        <aside className="bx-ed-panel">
          {status && (
            <div className={'bx-ed-status' + (status.error ? ' is-error' : '')} role="status">
              {status.error || status.text}
              {status.progress != null && !status.error && <progress max="100" value={status.progress} />}
              {status.error && <button type="button" onClick={() => setStatus(null)} aria-label="Dismiss">×</button>}
            </div>
          )}

          <section>
            <h3>Layers</h3>
            <ul className="bx-ed-layers">
              <li><button type="button" className={sel === 'bg' ? 'on' : ''} onClick={() => setSel('bg')}><span className="bx-ed-thumb" style={bgStyle} />Background</button></li>
              {scene.layers.map((l) => (
                <li key={l.id}><button type="button" className={sel === l.id ? 'on' : ''} onClick={() => setSel(l.id)}>
                  <span className="bx-ed-thumb"><LayerCanvas layer={l} maxSide={80} /></span>{label(l)}{l.depth === 'c' && <small>blurred</small>}
                </button></li>
              ))}
            </ul>
            <div className="bx-ed-row">
              {!bottle && <FileButton onFile={addBottle}>+ Product image</FileButton>}
              <FileButton onFile={addFruit} disabled={fruitCount >= MAX_FRUIT_LAYERS}>+ Fruit image</FileButton>
            </div>
          </section>

          {sel === 'bg' && (
            <section>
              <h3>Background</h3>
              <p className="bx-ed-muted">Changes only the slide background, not the pictures.</p>
              <div className="bx-ed-swatches">
                {SWATCHES.map((c) => <button key={c} type="button" style={{ background: c }} className={bg.color?.toLowerCase() === c.toLowerCase() ? 'on' : ''} onClick={() => setBg({ color: c })} aria-label={`Background ${c}`} />)}
                <label className="bx-ed-picker" title="Custom colour"><input type="color" value={bg.color || DEFAULT_BG} onChange={(ev) => setBg({ color: ev.target.value }, 'color')} />Custom</label>
              </div>
              <div className="bx-ed-row">
                <FileButton onFile={(f) => addFile(f, (url) => setBg({ image: { src: url } }))}>{bg.image ? 'Replace background image' : 'Upload background image'}</FileButton>
                {bg.image && <button type="button" className="bx-ed-btn" onClick={() => setBg({ image: null })}>Remove image</button>}
              </div>
            </section>
          )}

          {layer && (
            <>
              <section>
                <h3>{label(layer)}</h3>
                <div className="bx-ed-row">
                  <FileButton onFile={replaceImage}>{layer.kind === 'bottle' ? 'Replace image' : 'Replace fruit'}</FileButton>
                  <button type="button" className={'bx-ed-btn' + (e.removeBg ? ' bx-ed-on' : '')} onClick={toggleRemoveBg} disabled={!!status?.text}>{e.removeBg ? 'Restore background' : 'Remove background'}</button>
                </div>
              </section>
              <section>
                <h3>Shape</h3>
                <div className="bx-ed-seg bx-ed-seg-full">
                  {SHAPES.map(([k, l]) => <button key={k} type="button" className={e.shape === k ? 'on' : ''} onClick={() => setEdit({ shape: k })}>{l}</button>)}
                </div>
                <div className="bx-ed-row">
                  <button type="button" className="bx-ed-btn" onClick={() => setCropping(true)}>Crop…</button>
                  {e.crop && <button type="button" className="bx-ed-btn" onClick={() => setEdit({ crop: null })}>Remove crop</button>}
                </div>
              </section>
              <section>
                <h3>Size and position</h3>
                <Slider label="Size" value={layer.w} min={20} max={1400} onChange={(w) => updLayer(layer.id, (l) => ({ w, h: l.h * (w / l.w), x: l.x + (l.w - w) / 2, y: l.y + (l.h - l.h * (w / l.w)) / 2 }), (fn) => commitKey(layer.id + 'size', fn))} />
                <Slider label="Rotation" value={layer.rot} min={-180} max={180} suffix="°" onChange={(rot) => updLayer(layer.id, { rot }, (fn) => commitKey(layer.id + 'rot', fn))} onReset={() => updLayer(layer.id, { rot: 0 })} />
                <div className="bx-ed-row">
                  <button type="button" className="bx-ed-btn" onClick={() => updLayer(layer.id, (l) => ({ rot: ((l.rot - 90 + 540) % 360) - 180 }))}>⟲ 90°</button>
                  <button type="button" className="bx-ed-btn" onClick={() => updLayer(layer.id, (l) => ({ rot: ((l.rot + 90 + 540) % 360) - 180 }))}>⟳ 90°</button>
                  <button type="button" className={'bx-ed-btn' + (e.flipX ? ' bx-ed-on' : '')} onClick={() => setEdit({ flipX: !e.flipX })}>Flip ↔</button>
                  <button type="button" className={'bx-ed-btn' + (e.flipY ? ' bx-ed-on' : '')} onClick={() => setEdit({ flipY: !e.flipY })}>Flip ↕</button>
                </div>
                <p className="bx-ed-muted">Drag the picture to move it, the corner dots to resize, and the top dot to rotate. Arrow keys nudge it.</p>
              </section>
              <section>
                <h3>Colours</h3>
                <Slider label="Brightness" value={e.brightness} min={0} max={200} suffix="%" onChange={(v) => setEdit({ brightness: v }, 'b')} onReset={() => setEdit({ brightness: 100 })} />
                <Slider label="Contrast" value={e.contrast} min={0} max={200} suffix="%" onChange={(v) => setEdit({ contrast: v }, 'c')} onReset={() => setEdit({ contrast: 100 })} />
                <Slider label="Saturation" value={e.saturation} min={0} max={200} suffix="%" onChange={(v) => setEdit({ saturation: v }, 's')} onReset={() => setEdit({ saturation: 100 })} />
              </section>
              <section>
                <h3>Picture background</h3>
                <p className="bx-ed-muted">A colour behind this picture only, inside its shape.</p>
                <div className="bx-ed-swatches">
                  <button type="button" className={'bx-ed-none' + (!e.fill ? ' on' : '')} onClick={() => setEdit({ fill: null })} aria-label="No picture background">∅</button>
                  {SWATCHES.map((c) => <button key={c} type="button" style={{ background: c }} className={e.fill?.toLowerCase() === c.toLowerCase() ? 'on' : ''} onClick={() => setEdit({ fill: c })} aria-label={`Picture background ${c}`} />)}
                  <label className="bx-ed-picker"><input type="color" value={e.fill || '#ffffff'} onChange={(ev) => setEdit({ fill: ev.target.value }, 'fill')} />Custom</label>
                </div>
              </section>
              {layer.kind === 'fruit' && (
                <section>
                  <h3>Layer</h3>
                  <div className="bx-ed-seg bx-ed-seg-full">
                    <button type="button" className={layer.depth !== 'c' ? 'on' : ''} onClick={() => updLayer(layer.id, { depth: 'f' })}>Sharp, in front</button>
                    <button type="button" className={layer.depth === 'c' ? 'on' : ''} onClick={() => updLayer(layer.id, { depth: 'c' })}>Blurred, corner</button>
                  </div>
                  <div className="bx-ed-row">
                    <button type="button" className="bx-ed-btn" onClick={() => reorder(1)}>Bring forward</button>
                    <button type="button" className="bx-ed-btn" onClick={() => reorder(-1)}>Send back</button>
                    <button type="button" className="bx-ed-btn" onClick={duplicate} disabled={fruitCount >= MAX_FRUIT_LAYERS}>Duplicate</button>
                    <button type="button" className="bx-ed-btn bx-ed-danger" onClick={() => removeLayer(layer.id)}>Delete</button>
                  </div>
                </section>
              )}
              <section>
                <button type="button" className="bx-ed-btn bx-ed-wide" onClick={resetLayer}>Reset this picture</button>
              </section>
            </>
          )}

          <section>
            <h3>Shop card preview</h3>
            <div className="bx-ed-card" style={bgStyle}>
              {bottle ? <LayerCanvas layer={{ ...bottle, edit: { ...DEFAULT_EDIT, ...bottle.edit } }} maxSide={400} className={bottle.source?.sheet && !needsBake(bottle) ? 'is-sprite' : ''} /> : <span>{name.slice(0, 1) || '?'}</span>}
            </div>
            <p className="bx-ed-muted">How the product image looks on the shop and product pages. Size, position and rotation apply to the homepage slide.</p>
          </section>
        </aside>
      </div>

      {cropping && layer && (
        <CropDialog layer={layer} onClose={() => setCropping(false)} onApply={(crop) => { setEdit({ crop }); setCropping(false); }} />
      )}
    </div>
  );
}
