import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabase.js';
import usePageTitle from '../components/usePageTitle.js';
import { useAuth } from '../store/auth.jsx';
import { useCart } from '../store/cart.jsx';
import { shippingFor, useSettings } from '../store/settings.jsx';
import Qty from '../components/Qty.jsx';
import DiscountCard from '../components/DiscountCard.jsx';

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
  const cart = useCart();
  // Buy now: /checkout?buy=<slug>&qty=<n> orders that one product and leaves the cart alone.
  const [params] = useSearchParams();
  const buySlug = params.get('buy');
  const [buyProduct, setBuyProduct] = useState(undefined);
  const [buyQty, setBuyQty] = useState(() => Math.min(99, Math.max(1, parseInt(params.get('qty'), 10) || 1)));
  useEffect(() => {
    if (!buySlug) return;
    supabase.from('products').select('id, slug, name, price_cents, stock, active').eq('slug', buySlug).eq('active', true).maybeSingle()
      .then(({ data }) => setBuyProduct(data || null));
  }, [buySlug]);
  const buyMax = buyProduct ? Math.max(1, Math.min(99, buyProduct.stock)) : 1;
  const qtyNow = Math.min(buyQty, buyMax);
  const items = buySlug ? (buyProduct ? [{ key: buyProduct.id, product: buyProduct, quantity: qtyNow }] : []) : cart.items;
  const subtotal = buySlug ? items.reduce((s, i) => s + i.quantity * i.product.price_cents, 0) : cart.subtotal;
  const loading = buySlug ? buyProduct === undefined : cart.loading;
  const { settings, fmt } = useSettings();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', phone: '', address: '', city: '', postal_code: '', country: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const shipping = shippingFor(subtotal, settings);

  // Discount cards: the customer's available cards, the admin's rules, and a discount
  // preview priced on the server. The order itself is priced again on the server.
  const [cards, setCards] = useState([]);
  const [rules, setRules] = useState(null);
  const [picked, setPicked] = useState([]);
  const [preview, setPreview] = useState(null);
  const [cardError, setCardError] = useState('');
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    supabase.from('discount_cards').select('id, code, source, issued_at, expires_at, status, effective_status').eq('status', 'available').order('issued_at')
      .then(({ data, error }) => { if (!error) setCards((data || []).filter((c) => c.effective_status === 'available')); });
    supabase.from('reward_settings').select('discount_percent, allow_multiple_cards, max_cards_per_order, max_discount_cents').maybeSingle()
      .then(({ data }) => setRules(data || null));
  }, []);
  const pickKey = picked.join(',');
  useEffect(() => {
    if (!picked.length) { setPreview(null); setCardError(''); return undefined; }
    let live = true;
    setChecking(true);
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('preview_card_discount', buySlug && buyProduct
        ? { p_card_ids: picked, p_buy_product: buyProduct.id, p_buy_qty: qtyNow }
        : { p_card_ids: picked });
      if (!live) return;
      setChecking(false);
      if (error) { setPreview(null); setCardError(error.message); } else { setPreview(data); setCardError(''); }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [pickKey, subtotal, buySlug, buyProduct, qtyNow]); // eslint-disable-line react-hooks/exhaustive-deps
  const discount = preview ? preview.total_cents : 0;
  const multi = rules?.allow_multiple_cards !== false;
  const maxCards = multi ? rules?.max_cards_per_order : 1;
  function togglePick(id) {
    setPicked((p) => {
      if (p.includes(id)) return p.filter((x) => x !== id);
      if (!multi) return [id];
      if (maxCards && p.length >= maxCards) return p;
      return [...p, id];
    });
  }

  useEffect(() => {
    if (profile) setForm((f) => ({ ...f, name: f.name || profile.full_name || '', phone: f.phone || profile.phone || '' }));
  }, [profile]);

  if (loading) return <div className="b-wrap b-page b-loading">Loading…</div>;
  if (buySlug && (buyProduct === null || buyProduct.stock <= 0) && !busy) {
    return (
      <div className="b-wrap b-page b-empty">
        <h1>{buyProduct ? 'Sold out' : 'Product not found'}</h1>
        <p>{buyProduct ? `${buyProduct.name} is sold out right now.` : 'This product is not available any more.'}</p>
        <Link className="b-btn" to="/shop">Back to the shop</Link>
      </div>
    );
  }
  if (!items.length && !busy) return <Navigate to="/cart" replace />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const { data, error } = buySlug
      ? await supabase.rpc('buy_now', { p_product_id: buyProduct.id, p_quantity: qtyNow, p_shipping: form, p_card_ids: picked })
      : await supabase.rpc('place_order', { p_shipping: form, p_card_ids: picked });
    if (error) {
      setBusy(false);
      setError(error.message || 'Could not place your order.');
      if (/discount card/i.test(error.message || '')) {
        // A card was used or changed elsewhere: refresh the list.
        const { data: fresh } = await supabase.from('discount_cards').select('id, code, source, issued_at, expires_at, status, effective_status').eq('status', 'available').order('issued_at');
        const ok = (fresh || []).filter((c) => c.effective_status === 'available');
        setCards(ok);
        setPicked((p) => p.filter((id) => ok.some((c) => c.id === id)));
      }
      return;
    }
    if (!buySlug) await cart.reload();
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
          {cards.length > 0 && (
            <>
              <h2>Use Discount Cards</h2>
              <p className="b-muted b-dc-pick-hint">
                {multi ? (maxCards ? `Select up to ${maxCards} cards.` : 'Select one or more cards.') : 'Select one card for this order.'}
                {rules?.max_discount_cents != null && ` The most you can save on one order is ${fmt(rules.max_discount_cents)}.`}
              </p>
              <div className="b-dc-pick" role="group" aria-label="Your discount cards">
                {cards.map((c) => {
                  const on = picked.includes(c.id);
                  return (
                    <label key={c.id}>
                      <input type={multi ? 'checkbox' : 'radio'} name="discount-card" checked={on} onChange={() => togglePick(c.id)}
                        onClick={(e) => { if (!multi && on) { e.preventDefault(); togglePick(c.id); } }} />
                      <DiscountCard card={{ ...c, status: undefined }} percent={rules?.discount_percent} compact selected={on} />
                      {on && <span className="b-dc-check" aria-hidden="true">✓</span>}
                    </label>
                  );
                })}
              </div>
              {cardError && <p className="b-error-s" role="alert">{cardError}</p>}
              <p className="b-muted b-small">A discount card isn’t a payment method: the remaining amount is paid as below.</p>
            </>
          )}
          <h2>Payment</h2>
          <label className="b-radio">
            <input type="radio" checked readOnly name="pay" />
            <span><strong>Cash on delivery</strong><br /><span className="b-muted">Pay when your smoothies arrive.</span></span>
          </label>
        </div>
        <aside className="b-summary">
          <h2>Your order</h2>
          {buySlug && buyProduct && (
            <div className="b-buy-qty"><span>Quantity</span><Qty value={qtyNow} onChange={setBuyQty} max={buyMax} /></div>
          )}
          <ul className="b-mini-lines">
            {items.map((i) => (
              <li key={i.key}><span>{i.quantity} × {i.product.name}</span><span>{fmt(i.quantity * i.product.price_cents)}</span></li>
            ))}
          </ul>
          <div className="b-sum-row"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
          <div className="b-sum-row"><span>Shipping</span><span>{shipping ? fmt(shipping) : 'Free'}</span></div>
          {picked.length > 0 && (
            <>
              <div className="b-sum-row b-sum-disc"><span>Discount ({picked.length} card{picked.length > 1 ? 's' : ''})</span><span>{checking ? '…' : preview ? `−${fmt(discount)}` : '—'}</span></div>
              {preview?.cards?.length > 0 && <div className="b-sum-codes">{preview.cards.map((c) => c.code).join(', ')}</div>}
            </>
          )}
          <div className="b-sum-row b-sum-total"><span>{discount > 0 ? 'Remaining to pay' : 'Total'}</span><strong>{fmt(Math.max(0, subtotal + shipping - discount))}</strong></div>
          {error && <p className="b-error" role="alert">{error}</p>}
          <button type="submit" className="b-btn b-btn-block" disabled={busy || (picked.length > 0 && (checking || !!cardError))}>{busy ? 'Placing order…' : 'Place order'}</button>
          {buySlug
            ? <Link to={`/product/${buySlug}`} className="b-link b-center">Back to product</Link>
            : <Link to="/cart" className="b-link b-center">Back to cart</Link>}
        </aside>
      </form>
    </div>
  );
}
