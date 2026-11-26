import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ProductArt from './ProductArt.jsx';
import { useCart } from '../store/cart.jsx';
import { useSettings } from '../store/settings.jsx';
import { useToast } from '../store/toast.jsx';

export default function ProductCard({ product }) {
  const { add } = useCart();
  const { fmt } = useSettings();
  const flash = useToast();
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const out = product.stock <= 0;

  async function onAdd() {
    setBusy(true);
    try { await add(product, 1); flash(`${product.name} added to your cart`); }
    catch (e) { flash(e.message); }
    finally { setBusy(false); }
  }

  return (
    <article className="b-card">
      <Link to={`/product/${product.slug}`} className="b-card-art" aria-label={product.name}>
        <ProductArt product={product} />
        {out ? <span className="b-tag b-tag-out">Sold out</span> : product.stock <= 10 ? <span className="b-tag">Only {product.stock} left</span> : null}
      </Link>
      <div className="b-card-body">
        <div>
          <h3><Link to={`/product/${product.slug}`}>{product.name}</Link></h3>
          {product.category?.name && <span className="b-muted">{product.category.name}{product.size_ml ? ` · ${product.size_ml} ml` : ''}</span>}
        </div>
        <div className="b-price">
          {product.compare_at_price_cents > product.price_cents && <s>{fmt(product.compare_at_price_cents)}</s>}
          <strong>{fmt(product.price_cents)}</strong>
        </div>
      </div>
      {out ? (
        <button type="button" className="b-btn b-btn-block" disabled>Sold out</button>
      ) : (
        <div className="b-card-actions">
          <button type="button" className="b-btn b-btn-ghost" disabled={busy} onClick={onAdd}>{busy ? 'Adding…' : 'Add to cart'}</button>
          <button type="button" className="b-btn" onClick={() => navigate(`/checkout?buy=${encodeURIComponent(product.slug)}`)}>Buy now</button>
        </div>
      )}
    </article>
  );
}
