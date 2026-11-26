import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase.js';
import usePageTitle from '../components/usePageTitle.js';
import { useAuth } from '../store/auth.jsx';
import { useCart } from '../store/cart.jsx';
import { shippingFor, useSettings } from '../store/settings.jsx';

const FIELDS = [
  ['name', 'Full name', 'name', true],
  ['phone', 'Phone', 'tel', true],
  ['address', 'Street address', 'street-address', true],
  ['city', 'City', 'address-level2', true],
  ['postal_code', 'Postal code', 'postal-code', false],
  ['country', 'Country', 'country-name', true],
];

export default function Checkout() {
  usePageTitle('Checkout');
  const { profile } = useAuth();
  const { items, subtotal, loading, reload } = useCart();
  const { settings, fmt } = useSettings();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', phone: '', address: '', city: '', postal_code: '', country: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const shipping = shippingFor(subtotal, settings);

  useEffect(() => {
    if (profile) setForm((f) => ({ ...f, name: f.name || profile.full_name || '', phone: f.phone || profile.phone || '' }));
  }, [profile]);

  if (loading) return <div className="b-wrap b-page b-loading">Loading…</div>;
  if (!items.length && !busy) return <Navigate to="/cart" replace />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const { data, error } = await supabase.rpc('place_order', { p_shipping: form });
    if (error) { setBusy(false); setError(error.message || 'Could not place your order.'); return; }
    await reload();
    navigate(`/order/${data.id}`, { replace: true, state: { placed: true } });
  }

  return (
    <div className="b-wrap b-page">
      <div className="b-page-head"><h1>Checkout</h1></div>
      <form className="b-two" onSubmit={submit}>
        <div className="b-panel">
          <h2>Delivery details</h2>
          <div className="b-form-grid">
            {FIELDS.map(([k, label, ac, req]) => (
              <label key={k} className={'b-field' + (k === 'address' ? ' b-span2' : '')}>
                <span>{label}{req ? '' : ' (optional)'}</span>
                <input value={form[k]} onChange={set(k)} autoComplete={ac} required={req} maxLength={k === 'address' ? 300 : 120} type={k === 'phone' ? 'tel' : 'text'} />
              </label>
            ))}
            <label className="b-field b-span2">
              <span>Order notes (optional)</span>
              <textarea rows={3} value={form.notes} onChange={set('notes')} maxLength={1000} placeholder="Delivery instructions, gate code…" />
            </label>
          </div>
          <h2>Payment</h2>
          <label className="b-radio">
            <input type="radio" checked readOnly name="pay" />
            <span><strong>Cash on delivery</strong><br /><span className="b-muted">Pay when your smoothies arrive.</span></span>
          </label>
        </div>
        <aside className="b-summary">
          <h2>Your order</h2>
          <ul className="b-mini-lines">
            {items.map((i) => (
              <li key={i.key}><span>{i.quantity} × {i.product.name}</span><span>{fmt(i.quantity * i.product.price_cents)}</span></li>
            ))}
          </ul>
          <div className="b-sum-row"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
          <div className="b-sum-row"><span>Shipping</span><span>{shipping ? fmt(shipping) : 'Free'}</span></div>
          <div className="b-sum-row b-sum-total"><span>Total</span><strong>{fmt(subtotal + shipping)}</strong></div>
          {error && <p className="b-error" role="alert">{error}</p>}
          <button type="submit" className="b-btn b-btn-block" disabled={busy}>{busy ? 'Placing order…' : 'Place order'}</button>
          <Link to="/cart" className="b-link b-center">Back to cart</Link>
        </aside>
      </form>
    </div>
  );
}
