import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../supabase.js';
import ProductArt from '../components/ProductArt.jsx';
import ProductCard from '../components/ProductCard.jsx';
import Qty from '../components/Qty.jsx';
import usePageTitle from '../components/usePageTitle.js';
import { useCart } from '../store/cart.jsx';
import { useSettings } from '../store/settings.jsx';
import { useToast } from '../store/toast.jsx';
import { PRODUCT_LIST_FIELDS } from './Shop.jsx';

export default function Product() {
  const { slug } = useParams();
  const [product, setProduct] = useState(undefined);
  const [related, setRelated] = useState([]);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const { add } = useCart();
  const { fmt } = useSettings();
  const flash = useToast();
  usePageTitle(product?.name || 'Product');

  useEffect(() => {
    if (!supabase) { setProduct(null); return; }
    setProduct(undefined); setQty(1);
    supabase.from('products').select(`${PRODUCT_LIST_FIELDS}, ingredients, gallery, sku`).eq('slug', slug).eq('active', true).maybeSingle()
      .then(({ data, error }) => {
        if (error) console.error(error);
        setProduct(data || null);
        if (data) {
          supabase.from('products').select(PRODUCT_LIST_FIELDS).eq('active', true).neq('id', data.id).order('sort_order').limit(4)
            .then(({ data: r }) => setRelated(r || []));
        }
      });
  }, [slug]);

  if (product === undefined) return <div className="b-wrap b-page b-loading">Loading…</div>;
  if (product === null) {
    return (
      <div className="b-wrap b-page b-empty">
        <h1>Product not found</h1>
        <p>This smoothie is not on the menu any more.</p>
        <Link className="b-btn" to="/shop">Back to the shop</Link>
      </div>
    );
  }

  const out = product.stock <= 0;
  const max = Math.max(1, Math.min(99, product.stock));

  async function onAdd() {
    setBusy(true);
    try { await add(product, qty); flash(`${qty} × ${product.name} added to your cart`); }
    catch (e) { flash(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="b-wrap b-page">
      <nav className="b-crumbs" aria-label="Breadcrumb">
        <Link to="/shop">Shop</Link>
        {product.category && <> / <Link to={`/shop?category=${product.category.slug}`}>{product.category.name}</Link></>}
        {' '}/ <span>{product.name}</span>
      </nav>
      <div className="b-product">
        <ProductArt product={product} size="lg" />
        <div className="b-product-info">
          <h1>{product.name}</h1>
          <div className="b-price b-price-lg">
            {product.compare_at_price_cents > product.price_cents && <s>{fmt(product.compare_at_price_cents)}</s>}
            <strong>{fmt(product.price_cents)}</strong>
          </div>
          {product.description && <p className="b-lead">{product.description}</p>}
          <dl className="b-specs">
            {product.ingredients && <><dt>Ingredients</dt><dd>{product.ingredients}</dd></>}
            {product.size_ml && <><dt>Size</dt><dd>{product.size_ml} ml</dd></>}
            <dt>Availability</dt>
            <dd className={out ? 'b-out' : 'b-in'}>{out ? 'Sold out' : product.stock <= 10 ? `Only ${product.stock} left` : 'In stock'}</dd>
          </dl>
          <div className="b-buy">
            <Qty value={qty} onChange={setQty} max={max} disabled={out} />
            <button type="button" className="b-btn" disabled={busy || out} onClick={onAdd}>{out ? 'Sold out' : busy ? 'Adding…' : 'Add to cart'}</button>
          </div>
          <Link to="/cart" className="b-link">View cart</Link>
        </div>
      </div>
      {related.length > 0 && (
        <section className="b-related">
          <h2>You might also like</h2>
          <div className="b-grid">{related.map((p) => <ProductCard key={p.id} product={p} />)}</div>
        </section>
      )}
    </div>
  );
}
