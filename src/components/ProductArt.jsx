import { useEffect, useState } from 'react';
import { F, fallbackSheet, sheetUrl } from '../flavours.js';

const SHEET = 2048;
const flavourFor = (slug) => F.find((f) => f.name.toLowerCase() === String(slug || '').toLowerCase());

// Load each flavour sheet once; if the image proxy can't be reached, draw the same
// stand-in art the homepage uses.
const sheets = new Map();
function sheetFor(f) {
  if (!sheets.has(f.name)) {
    const entry = { url: sheetUrl(f), listeners: new Set() };
    const img = new Image();
    img.onerror = () => { entry.url = fallbackSheet(f); entry.listeners.forEach((fn) => fn(entry.url)); };
    img.src = entry.url;
    sheets.set(f.name, entry);
  }
  return sheets.get(f.name);
}
function useSheet(f) {
  const entry = f ? sheetFor(f) : null;
  const [url, setUrl] = useState(entry?.url);
  useEffect(() => {
    if (!entry) return undefined;
    setUrl(entry.url);
    entry.listeners.add(setUrl);
    return () => entry.listeners.delete(setUrl);
  }, [entry]);
  return url;
}

// Product picture: an uploaded image if there is one, otherwise the bottle from the
// original Blendy art, otherwise the product's initial on its colour.
export default function ProductArt({ product, className = '', size = 'md' }) {
  const f = flavourFor(product?.slug);
  const sheet = useSheet(product?.image_url ? null : f);
  const bg = product?.bg_color || f?.bg || '#C2B0DC';
  let inner;
  if (product?.image_url) {
    inner = <img src={product.image_url} alt={product.name} loading="lazy" className="b-art-img" />;
  } else if (f) {
    const [x, y, w, h] = f.items[0];
    inner = (
      <div
        className="b-art-bottle"
        role="img"
        aria-label={`${product.name} smoothie bottle`}
        style={{
          aspectRatio: `${w} / ${h}`,
          backgroundImage: `url("${sheet}")`,
          backgroundSize: `${(SHEET / w) * 100}% auto`,
          backgroundPosition: `${(x / (SHEET - w)) * 100}% ${(y / (SHEET - h)) * 100}%`,
        }}
      />
    );
  } else {
    inner = <span className="b-art-initial" aria-hidden="true">{(product?.name || '?').slice(0, 1)}</span>;
  }
  const style = product?.bg_image_url
    ? { backgroundColor: bg, backgroundImage: `url("${String(product.bg_image_url).replace(/"/g, '%22')}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: bg };
  return <div className={`b-art b-art-${size} ${className}`} style={style}>{inner}</div>;
}
