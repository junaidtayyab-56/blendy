// Pixel work for the image editor: loading images, drawing a layer with its crop, shape,
// colour adjustments, background fill and flip, and exporting the result.
import { DEFAULT_EDIT, sheetBox, sourceUrl } from './scene.js';

const cache = new Map();
export function loadImage(url) {
  if (!url) return Promise.reject(new Error('No image'));
  if (!cache.has(url)) {
    const p = new Promise((resolve, reject) => {
      const img = new Image();
      if (!url.startsWith('blob:') && !url.startsWith('data:')) img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => { cache.delete(url); reject(new Error('Could not load image')); };
      img.src = url;
    });
    cache.set(url, p);
  }
  return cache.get(url);
}

// Base picture of a layer: the background-removed copy when that is switched on, else the
// original (for sheet art, the piece's box on the sheet).
export function baseOf(layer) {
  const e = layer.edit || DEFAULT_EDIT;
  if (e.removeBg && layer.cut) return { url: layer.cut, box: null };
  return { url: sourceUrl(layer.source), box: sheetBox(layer.source) };
}

const fullBox = (img, box) => box || [0, 0, img.naturalWidth || img.width, img.naturalHeight || img.height];

// Region of the base picture that ends up visible, after crop and square/circle shapes.
export function regionOf(edit, img, box) {
  const [bx, by, bw, bh] = fullBox(img, box);
  const c = edit?.crop;
  let x = bx, y = by, w = bw, h = bh;
  if (c) { x = bx + c.x * bw; y = by + c.y * bh; w = c.w * bw; h = c.h * bh; }
  if (edit?.shape === 'circle' || edit?.shape === 'square') {
    const s = Math.min(w, h);
    x += (w - s) / 2; y += (h - s) / 2; w = h = s;
  }
  return [x, y, Math.max(1, w), Math.max(1, h)];
}

export const aspectOf = (edit, img, box) => { const [, , w, h] = regionOf(edit, img, box); return h / w; };

// Same maths as CSS brightness(), contrast() and saturate() filters, done by hand so it also
// works where canvas filters are missing (older Safari).
function adjust(ctx, w, h, e) {
  const b = e.brightness / 100, c = e.contrast / 100, s = e.saturation / 100;
  if (b === 1 && c === 1 && s === 1) return;
  const d = ctx.getImageData(0, 0, w, h), p = d.data;
  const ic = 128 * (1 - c);
  const rr = 0.213 + 0.787 * s, rg = 0.715 - 0.715 * s, rb = 0.072 - 0.072 * s;
  const gr = 0.213 - 0.213 * s, gg = 0.715 + 0.285 * s, gb = 0.072 - 0.072 * s;
  const br = 0.213 - 0.213 * s, bg = 0.715 - 0.715 * s, bb = 0.072 + 0.928 * s;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] === 0) continue;
    let r = p[i] * b, g = p[i + 1] * b, bl = p[i + 2] * b;
    r = r * c + ic; g = g * c + ic; bl = bl * c + ic;
    p[i] = r * rr + g * rg + bl * rb;
    p[i + 1] = r * gr + g * gg + bl * gb;
    p[i + 2] = r * br + g * bg + bl * bb;
  }
  ctx.putImageData(d, 0, 0);
}

function shapePath(ctx, shape, w, h) {
  ctx.beginPath();
  if (shape === 'circle') ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (shape === 'rounded') {
    const r = Math.min(w, h) * 0.14;
    if (ctx.roundRect) ctx.roundRect(0, 0, w, h, r);
    else { ctx.moveTo(r, 0); ctx.arcTo(w, 0, w, h, r); ctx.arcTo(w, h, 0, h, r); ctx.arcTo(0, h, 0, 0, r); ctx.arcTo(0, 0, w, 0, r); ctx.closePath(); }
  } else ctx.rect(0, 0, w, h);
}

// Draw a layer's picture into a new canvas no bigger than maxSide on its long edge.
// flip: false leaves the flip to CSS (used for untouched sheet art).
export function drawLayer(img, box, edit, maxSide = 1200, { flip = true } = {}) {
  const e = { ...DEFAULT_EDIT, ...(edit || {}) };
  const [sx, sy, sw, sh] = regionOf(e, img, box);
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  const pic = document.createElement('canvas');
  pic.width = w; pic.height = h;
  const pc = pic.getContext('2d', { willReadFrequently: true });
  pc.save();
  if (flip && (e.flipX || e.flipY)) { pc.translate(e.flipX ? w : 0, e.flipY ? h : 0); pc.scale(e.flipX ? -1 : 1, e.flipY ? -1 : 1); }
  pc.imageSmoothingQuality = 'high';
  pc.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  pc.restore();
  adjust(pc, w, h, e);
  if (!e.fill && e.shape !== 'circle' && e.shape !== 'rounded') return pic;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const oc = out.getContext('2d');
  shapePath(oc, e.shape, w, h);
  oc.clip();
  if (e.fill) { oc.fillStyle = e.fill; oc.fillRect(0, 0, w, h); }
  oc.drawImage(pic, 0, 0);
  return out;
}

export function toBlob(canvas, type = 'image/webp', quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not export the image'))), type, quality);
  });
}

// Export for the web: WebP keeps transparency and is small; browsers that cannot write WebP
// hand back PNG, which we accept.
export async function exportForWeb(canvas) {
  const blob = await toBlob(canvas, 'image/webp', 0.9);
  return { blob, ext: blob.type === 'image/webp' ? 'webp' : 'png' };
}
