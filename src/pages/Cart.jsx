import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ProductArt from '../components/ProductArt.jsx';
import Qty from '../components/Qty.jsx';
import usePageTitle from '../components/usePageTitle.js';
import { useAuth } from '../store/auth.jsx';
import { useCart } from '../store/cart.jsx';
import { shippingFor, useSettings } from '../store/settings.jsx';
import { useToast } from '../store/toast.jsx';

export default function Cart() {
  usePageTitle('Cart');
  const { items, subtotal, loading, setQuantity } = useCart();
  const { user } = useAuth();
  const { settings, fmt } = useSettings();
  const flash = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(null);
  const shipping = shippingFor(subtotal, settings);
  const problems = items.filter((i) => !i.product.active || i.product.stock < i.quantity);

  async function change(item, q) {
    setBusy(item.key);
    try { await setQuantity(item, q); } catch (e) { flash(e.message); }
    setBusy(null);
  }

  if (loading) return <div className="b-wrap b-page b-loading">Loading your cart…</div>;

  if (!items.length) {
    return (
      <div className="b-wrap b-page b-empty">
        <h1>Your cart is empty</h1>
        <p>Find a flavour you love.</p>
        <Link className="b-btn" to="/shop">Shop smoothies</Link>
      </div>
    );
  }

  return (
    <div className="b-wrap b-page">
      <div className="b-page-head"><h1>Your cart</h1></div>
      <div className="b-two">
        <ul className="b-lines">
          {items.map((i) => (
            <li key={i.key} className="b-line">
              <Link to={`/product/${i.product.slug}`} className="b-line-art"><ProductArt product={i.product} size="sm" /></Link>
              <div className="b-line-main">
                <Link to={`/product/${i.product.slug}`} className="b-line-name">{i.product.name}</Link>
                <span className="b-muted">{fmt(i.product.price_cents)} each</span>
                {!i.product.active ? <span className="b-error-s">No longer available</span>
                  : i.product.stock < i.quantity ? <span className="b-error-s">Only {i.product.stock} left</span> : null}
                <button type="button" className="b-text-btn" onClick={() => change(i, 0)} disabled={busy === i.key}>Remove</button>
              </div>
              <div className="b-line-end">
                <Qty value={i.quantity} onChange={(q) => change(i, q)} max={Math.max(1, Math.min(99, i.product.stock))} disabled={busy === i.key} />
                <strong>{fmt(i.quantity * i.product.price_cents)}</strong>
              </div>
            </li>
          ))}
        </ul>
        <aside className="b-summary">
          <h2>Order summary</h2>
          <div className="b-sum-row"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
          <div className="b-sum-row"><span>Shipping</span><span>{shipping ? fmt(shipping) : 'Free'}</span></div>
          {settings.free_shipping_threshold_cents != null && shipping > 0 && (
            <p className="b-muted b-small">Free shipping on orders over {fmt(settings.free_shipping_threshold_cents)}.</p>
          )}
          <div className="b-sum-row b-sum-total"><span>Total</span><strong>{fmt(subtotal + shipping)}</strong></div>
          {problems.length > 0 && <p className="b-error-s">Please fix the items marked above before checkout.</p>}
          <button type="button" className="b-btn b-btn-block" disabled={problems.length > 0} onClick={() => navigate(user ? '/checkout' : '/login?next=/checkout')}>
            {user ? 'Checkout' : 'Log in to checkout'}
          </button>
          <Link to="/shop" className="b-link b-center">Continue shopping</Link>
        </aside>
      </div>
    </div>
  );
}
