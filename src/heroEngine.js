// Imperative slide engine for the Blendy hero. It is the original vanilla
// animation code, wrapped so React can mount it once and tear it down cleanly.
import { F, SHADOWS, LAYERS, FACT, COV_T, COV_C, DUR, EASE, sheetUrl, fallbackSheet } from './flavours.js';

// `list` holds the slides: the original flavours (with sheet art) and/or products with
// just an image, background colour and name.
export function startHero({ list = F, stage, tabsEl, ul, prevBtn, nextBtn, isPaused, onChange }) {
  const n = list.length;
  const root = document.documentElement;
  const body = document.body;
  const tabBtns = [...tabsEl.querySelectorAll('button')];
  const mqMobile = matchMedia('(max-width:820px), (orientation:portrait)');
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  const U = (v) => `calc(var(--u) * ${+v.toFixed(4)})`;
  const rand = (a, b) => a + Math.random() * (b - a);
  let u = 1;
  let alive = true;
  const cleanups = [];
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn, opts));
  };

  function crop(el, box, W) {
    const [bx, by, bw, bh] = box, s = W / bw;
    el.classList.add('crop');
    el.style.width = U(W); el.style.height = U(bh * s);
    el.style.backgroundSize = U(2048 * s) + ' ' + U(2048 * s);
    el.style.backgroundPosition = U(-bx * s) + ' ' + U(-by * s);
  }

  // build slides
  stage.textContent = '';
  const slides = list.map((f, i) => {
    const sec = document.createElement('section');
    sec.className = 'slide' + (i === 0 ? ' is-current' : '');
    sec.style.background = f.bg;
    sec.setAttribute('aria-label', f.name + ' smoothie');
    if (f.items) sec.style.setProperty('--sheet', `url("${sheetUrl(f)}")`);
    const frame = document.createElement('div'); frame.className = 'frame'; sec.appendChild(frame);
    const L = {};
    for (const n of LAYERS) { const d = document.createElement('div'); d.className = 'layer ly-' + n; frame.appendChild(d); L[n] = d; }
    const word = document.createElement('h2'); word.className = 'word'; word.textContent = f.name; L.word.appendChild(word);
    for (const [cx, cy, w, h] of SHADOWS) {
      const s = document.createElement('div'); s.className = 'shd';
      s.style.left = U(cx - w / 2); s.style.top = U(cy - h / 2); s.style.width = U(w); s.style.height = U(h);
      L.shadow.appendChild(s);
    }
    const b = document.createElement('div'); b.className = 'bottle'; b.setAttribute('role', 'img'); b.setAttribute('aria-label', f.name + ' smoothie bottle');
    if (f.items) {
      b.style.left = U(f.bottle[0]); b.style.top = U(f.bottle[1]); crop(b, f.items[0], f.bottle[2]); L.bottle.appendChild(b);
    } else if (f.image) {
      // A product added in the admin: its photo stands where the bottle would be.
      b.classList.add('bottle-img');
      b.style.left = U(500); b.style.top = U(125); b.style.width = U(440); b.style.height = U(590);
      b.style.backgroundImage = `url("${String(f.image).replace(/"/g, '%22')}")`;
      L.bottle.appendChild(b);
    }
    for (const [it, x, y, w, rot, mir, lay] of (f.pieces || [])) {
      const o = document.createElement('div'); o.className = 'piece' + (mir ? ' mir' : '');
      o.style.left = U(x); o.style.top = U(y);
      const inner = document.createElement('div'); inner.className = 'pi';
      crop(inner, f.items[it], w);
      o.style.width = inner.style.width; o.style.height = inner.style.height;
      inner.style.width = '100%'; inner.style.height = '100%';
      inner.style.setProperty('--r', rot + 'deg');
      inner.style.setProperty('--d', rand(3.2, 5).toFixed(2) + 's');
      inner.style.setProperty('--dl', (-rand(0, 4)).toFixed(2) + 's');
      o.appendChild(inner);
      (lay === 'c' ? L.corner : L.fruit).appendChild(o);
    }
    stage.appendChild(sec);
    return { el: sec, frame, L, word, f };
  });

  // sheet loading; if the proxy is unreachable, draw a stand-in sheet
  list.forEach((f, i) => {
    if (!f.items) return;
    const img = new Image();
    img.onerror = () => { if (alive) slides[i].el.style.setProperty('--sheet', `url("${fallbackSheet(f)}")`); };
    img.src = sheetUrl(f);
  });

  // scaling and word fit
  const mc = document.createElement('canvas').getContext('2d');
  function ink100(w) { mc.font = '700 100px Poppins'; const m = mc.measureText(w); return m.actualBoundingBoxLeft + m.actualBoundingBoxRight; }
  function layout() {
    const vw = innerWidth, vh = innerHeight, mobile = mqMobile.matches;
    u = mobile ? Math.min(vw / 640, (vh - 200) / 620) : Math.min(vw / 1440, vh / 900);
    root.style.setProperty('--u', u + 'px');
    root.style.setProperty('--fy', (mobile ? 8 : 0) + 'px');
    const target = mobile ? Math.min(1440, vw / u) * 0.92 : 1400;
    const limit = mobile ? target : 1330;
    for (const s of slides) {
      const ink = ink100(s.f.name) / 100, gaps = s.f.name.length - 1;
      const inkAt = (ls) => ink + ls * gaps;
      let size = 445, ls = 0.005;
      if (inkAt(ls) * 445 > limit) { ls = -0.035; size = Math.min(445, target / inkAt(ls)); }
      const base = 403.5 + 0.698 * size / 2, top = base - 0.85 * size;
      s.word.style.fontSize = (size * u) + 'px';
      s.word.style.letterSpacing = ls + 'em';
      s.word.style.top = (top * u) + 'px';
      s.size = size;
    }
    moveUnderline();
  }

  // state
  let cur = 0, busy = false, lastAct = -1e9;
  function moveUnderline() {
    const b = tabBtns[cur];
    ul.style.width = b.offsetWidth + 'px';
    ul.style.transform = `translateX(${b.offsetLeft}px)`;
  }
  function setActive(i) {
    tabBtns.forEach((b, j) => { if (j === i) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
    onChange?.(i);
  }
  function cover(t) {
    if (t <= 0) return 0; if (t >= 1) return 1;
    let i = 0; while (t >= COV_T[i + 1]) i++;
    let k = (t - COV_T[i]) / (COV_T[i + 1] - COV_T[i]); k = k * k * (3 - 2 * k);
    return COV_C[i] + (COV_C[i + 1] - COV_C[i]) * k;
  }
  function clearSlide(s) {
    s.el.style.clipPath = ''; s.el.style.zIndex = ''; s.el.style.visibility = '';
    for (const n of LAYERS) s.L[n].style.transform = '';
  }
  function go(to, dir) {
    if (busy || to === cur) return;
    const A = slides[cur], B = slides[to];
    cur = to; setActive(to); moveUnderline();
    if (mqReduce.matches) {
      A.el.classList.remove('is-current'); B.el.classList.add('is-current');
      clearSlide(A); clearSlide(B); return;
    }
    busy = true;
    const FW = 1440 * u;
    for (const n of LAYERS) B.L[n].style.transform = `translateX(${dir * FACT[n] * FW}px)`;
    B.el.style.visibility = 'visible'; B.el.style.zIndex = 1; A.el.style.zIndex = 2;
    const t0 = performance.now();
    const step = (now) => {
      if (!alive) return;
      const t = (now - t0) / DUR;
      const c = cover(Math.min(t, 1));
      A.el.style.clipPath = dir > 0 ? `inset(0 ${c * 100}% 0 0)` : `inset(0 0 0 ${c * 100}%)`;
      const ax = -dir * c * 0.14 * FW;
      for (const n of LAYERS) A.L[n].style.transform = `translateX(${ax}px)`;
      let k = Math.min(1, Math.max(0, (t - 0.5) / 0.42)); k = 1 - (1 - k) * (1 - k);
      for (const n of LAYERS) B.L[n].style.transform = `translateX(${dir * (1 - k) * FACT[n] * FW}px)`;
      if (t < 1 || k < 1) { requestAnimationFrame(step); return; }
      A.el.classList.remove('is-current'); B.el.classList.add('is-current');
      slides.forEach(clearSlide);
      busy = false;
    };
    requestAnimationFrame(step);
  }
  const next = () => go((cur + 1) % n, 1);
  const prev = () => go((cur + n - 1) % n, -1);
  const act = () => { lastAct = performance.now(); };

  tabBtns.forEach((b, i) => on(b, 'click', () => { act(); if (i !== cur) go(i, i > cur ? 1 : -1); }));
  on(nextBtn, 'click', () => { act(); next(); });
  on(prevBtn, 'click', () => { act(); prev(); });
  on(window, 'keydown', (e) => {
    if (isPaused()) return;
    if (e.key === 'ArrowRight') { act(); next(); }
    else if (e.key === 'ArrowLeft') { act(); prev(); }
  });
  let px = null, py = null;
  on(stage, 'pointerdown', (e) => { px = e.clientX; py = e.clientY; });
  on(window, 'pointerup', (e) => {
    if (px === null) return;
    const dx = e.clientX - px, dy = e.clientY - py; px = py = null;
    if (isPaused()) return;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) { act(); dx < 0 ? next() : prev(); }
  });
  on(window, 'pointercancel', () => { px = py = null; });
  const timer = setInterval(() => {
    if (document.visibilityState === 'visible' && performance.now() - lastAct > 6000 && !busy && !isPaused()) next();
  }, 2600);
  on(window, 'resize', layout);
  if (mqMobile.addEventListener) on(mqMobile, 'change', layout);

  setActive(0);
  layout();

  // opening sequence
  const reveals = [];
  let opened = false;
  function open() {
    if (opened || !alive) return; opened = true;
    layout();
    if (mqReduce.matches) { body.classList.remove('pre'); return; }
    const FW = 1440 * u, s = slides[0];
    for (const n of LAYERS) reveals.push(s.L[n].animate([{ transform: `translateX(${FACT[n] * FW}px)` }, { transform: 'translateX(0px)' }], { duration: 900, easing: EASE }));
    const ui = [['.logo', 250], ['.tabs', 330], ['.acct', 410], ['.prev', 490], ['.shop', 570], ['.next', 650]];
    for (const [sel, d] of ui) {
      const el = document.querySelector('.ui ' + sel);
      if (el) reveals.push(el.animate([{ opacity: 0, translate: '0 14px' }, { opacity: 1, translate: '0 0' }], { duration: 1000, delay: d, easing: EASE, fill: 'backwards' }));
    }
    body.classList.remove('pre');
  }
  const ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.all([ready, document.fonts ? document.fonts.load('700 100px Poppins') : 0]).then(open, open);
  const failsafe = setTimeout(() => {
    open();
    for (const a of reveals) { try { if (a.playState !== 'finished') a.finish(); } catch (e) { /* ignore */ } }
    body.classList.remove('pre');
  }, 3000);

  return {
    act,
    current: () => cur,
    relayout: layout,
    destroy() {
      alive = false;
      clearInterval(timer);
      clearTimeout(failsafe);
      cleanups.forEach((fn) => fn());
      stage.textContent = '';
    },
  };
}
