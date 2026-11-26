// Homepage slide "scene": a product's background plus its image layers (the bottle and the
// floating fruit), placed in the 1440 x 900 hero frame. Saved in products.scene so the
// homepage shows exactly what the admin editor shows.
//
// Layer shape:
//   id, kind: 'bottle' | 'fruit', depth: 'f' (front) | 'c' (blurred corner, fruit only)
//   source: { url } | { sheet: 'Berry', item: 2 }   the original image, never overwritten
//   cut:    url of the background-removed copy of the source, or null
//   src:    url of the saved edited image (crop, shape, colours, flip baked in), or null
//   edit:   { crop, shape, flipX, flipY, brightness, contrast, saturation, removeBg, fill }
//   x, y, w, h: box in frame units; rot: degrees
import { F, sheetUrl } from '../flavours.js';

export const FRAME_W = 1440;
export const FRAME_H = 900;
export const MAX_FRUIT_LAYERS = 12;
export const DEFAULT_BG = '#C2B0DC';

export const DEFAULT_EDIT = Object.freeze({ crop: null, shape: 'original', flipX: false, flipY: false, brightness: 100, contrast: 100, saturation: 100, removeBg: false, fill: null });

// Spots used for an admin-added product's fruit pictures (same as the homepage engine).
export const GENERIC_PIECES = [[380, 170, 140, -12, 0, 'f'], [960, 228, 150, 8, 1, 'f'], [300, 470, 165, 0, 0, 'f'], [1190, 460, 150, -20, 0, 'f'], [950, 600, 145, 12, 1, 'f'], [-10, 575, 255, 0, 0, 'c'], [1285, 30, 200, 15, 0, 'c']];
export const GENERIC_BOTTLE = [500, 125, 440, 590];

let seq = 0;
export const newId = (p = 'l') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

export const flavourFor = (slug) => F.find((f) => f.name.toLowerCase() === String(slug || '').toLowerCase());
export const flavourByName = (name) => F.find((f) => f.name === name);

// The sheet crop box [x, y, w, h] of a sheet source.
export function sheetBox(source) {
  const f = source?.sheet && flavourByName(source.sheet);
  return f ? f.items[source.item] : null;
}

export function sourceUrl(source) {
  if (!source) return null;
  if (source.url) return source.url;
  const f = flavourByName(source.sheet);
  return f ? sheetUrl(f) : null;
}

export const isDefaultEdit = (e, { ignoreFlip = false } = {}) => {
  const d = { ...DEFAULT_EDIT, ...(e || {}) };
  return !d.crop && d.shape === 'original' && d.brightness === 100 && d.contrast === 100 && d.saturation === 100 && !d.removeBg && !d.fill && (ignoreFlip || (!d.flipX && !d.flipY));
};

// Does this layer need its own edited image file? Sheet art that is only flipped is drawn
// straight from the sheet (flip done with CSS), so the original art stays untouched.
export function needsBake(layer) {
  const e = layer.edit || DEFAULT_EDIT;
  if (isDefaultEdit(e)) return false;
  if (layer.source?.sheet && isDefaultEdit(e, { ignoreFlip: true })) return false;
  return true;
}

function layer(kind, source, x, y, w, h, rot = 0, extra = {}) {
  return { id: newId(kind[0]), kind, depth: 'f', source, cut: null, src: null, edit: { ...DEFAULT_EDIT }, x, y, w, h, rot, ...extra };
}

// Fit a w x h image inside a box, centred (or bottom-aligned).
export function fitBox(box, nw, nh, align = 'center') {
  const [bx, by, bw, bh] = box;
  const k = Math.min(bw / nw, bh / nh);
  const w = nw * k, h = nh * k;
  return { x: bx + (bw - w) / 2, y: align === 'bottom' ? by + bh - h : by + (bh - h) / 2, w, h };
}

// The scene a product shows today when it has none saved: the original art for the four
// original flavours, otherwise its photo plus its fruit pictures in the standard spots.
export function defaultScene(product) {
  const f = flavourFor(product?.slug);
  if (f) {
    const [, , iw, ih] = f.items[0];
    const [bx, by, bw] = f.bottle;
    const layers = [layer('bottle', { sheet: f.name, item: 0 }, bx, by, bw, (bw * ih) / iw)];
    for (const [it, x, y, w, rot, mir, lay] of f.pieces) {
      const [, , pw, ph] = f.items[it];
      // The original mirrors the piece around its rotation; flip-then-rotate(-r) looks the same.
      layers.push(layer('fruit', { sheet: f.name, item: it }, x, y, w, (w * ph) / pw, mir ? -rot : rot, { depth: lay, edit: { ...DEFAULT_EDIT, flipX: !!mir } }));
    }
    return { v: 1, background: { color: product?.bg_color || f.bg, image: null }, layers };
  }
  const layers = [];
  if (product?.image_url) layers.push(layer('bottle', { url: product.image_url }, ...GENERIC_BOTTLE, 0, { fit: 'bottom' }));
  const fruits = productFruits(product);
  if (fruits.length) {
    GENERIC_PIECES.forEach(([x, y, w, rot, mir, lay], k) => {
      layers.push(layer('fruit', { url: fruits[k % fruits.length] }, x, y, w, w, mir ? -rot : rot, { depth: lay, fit: 'center', edit: { ...DEFAULT_EDIT, flipX: !!mir } }));
    });
  }
  return { v: 1, background: { color: product?.bg_color || DEFAULT_BG, image: null }, layers };
}

export const productFruits = (p) => (p?.hero_fruits && p.hero_fruits.length ? p.hero_fruits : (p?.hero_fruit_url ? [p.hero_fruit_url] : []));

export function sceneFor(product) {
  const s = product?.scene;
  if (s && s.v === 1 && Array.isArray(s.layers)) return s;
  return defaultScene(product);
}

// What the homepage should draw for a layer: { url, box } where box is a sheet crop or null.
export function layerDisplay(l) {
  if (l.src) return { url: l.src, box: null, cssFlip: false };
  return { url: sourceUrl(l.source), box: sheetBox(l.source), cssFlip: true };
}

export const bottleOf = (scene) => scene?.layers?.find((l) => l.kind === 'bottle') || null;
export const fruitsOf = (scene) => (scene?.layers || []).filter((l) => l.kind === 'fruit');

// Columns kept in step with the scene so the shop pages and older code see the edits.
export function productColumnsFromScene(scene, product) {
  const b = bottleOf(scene);
  let image_url = product?.image_url || null;
  if (b) image_url = b.src || b.source?.url || null;
  else if (!flavourFor(product?.slug)) image_url = null;
  const urls = [...new Set(fruitsOf(scene).map((l) => l.src || l.source?.url).filter(Boolean))].slice(0, 4);
  return {
    image_url,
    bg_color: scene.background?.color || DEFAULT_BG,
    bg_image_url: scene.background?.image?.src || null,
    hero_fruits: urls,
    hero_fruit_url: urls[0] || null,
  };
}
