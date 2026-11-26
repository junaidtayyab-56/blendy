import { useEffect, useState } from 'react';
import { supabase, money } from './supabase.js';
import Panel from './Panel.jsx';

export default function CartPanel({ cart, user, accent, reload, onClose, flash }) {
  const [view, setView] = useState('cart'); // cart | orders | placed
  const [busy, setBusy] = useState(false);
  const [orders, setOrders] = useState(null);
  const [placed, setPlaced] = useState(null);
  const [error, setError] = useState('');

  const currency = cart[0]?.product?.currency || 'USD';
  const total = cart.reduce((n, i) => n + i.quantity * (i.product?.price_cents || 0), 0);

  async function setQty(item, q) {
    setError('');
    setBusy(true);
    const { error } = q <= 0
      ? await supabase.from('cart_items').delete().eq('id', item.id)
      : await supabase.from('cart_items').update({ quantity: Math.min(q, 99) }).eq('id', item.id);
    if (error) setError('Could not update your cart. Please try again.');
    await reload();
    setBusy(false);
  }

  async function placeOrder() {
    setError('');
    setBusy(true);
    const { data, error } = await supabase.rpc('place_order');
    setBusy(false);
    if (error) { setError(error.message || 'Could not place your order.'); return; }
    setPlaced(data);
    await reload();
    setView('placed');
    flash('Order placed. Thank you!');
  }

  useEffect(() => {
    if (view !== 'orders') return;
    supabase
      .from('orders')
      .select('id, status, total_cents, currency, created_at, order_items(product_name, quantity)')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (error) setError('Could not load your orders.');
        else setOrders(data);
      });
  }, [view]);

  const title = view === 'orders' ? 'Your orders' : view === 'placed' ? 'Order placed' : 'Your cart';

  return (
    <Panel title={title} accent={accent} onClose={onClose} kind="drawer">
      <p className="pn-user">Signed in as {user?.email}</p>
      <div className="pn-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={view !== 'orders'} onClick={() => setView('cart')}>Cart</button>
        <button type="button" role="tab" aria-selected={view === 'orders'} onClick={() => setView('orders')}>Orders</button>
      </div>

      {view === 'cart' && (
        cart.length === 0 ? (
          <p className="pn-empty">Your cart is empty. Pick a flavour and tap SHOP NOW.</p>
        ) : (
          <>
            <ul className="pn-list">
              {cart.map((item) => (
                <li key={item.id} className="pn-item">
                  <div>
                    <strong>{item.product?.name} smoothie</strong>
                    <span>{money(item.product?.price_cents, item.product?.currency)} each</span>
                  </div>
                  <div className="pn-qty">
                    <button type="button" aria-label={`Remove one ${item.product?.name}`} disabled={busy} onClick={() => setQty(item, item.quantity - 1)}>−</button>
                    <span aria-live="polite">{item.quantity}</span>
                    <button type="button" aria-label={`Add one ${item.product?.name}`} disabled={busy || item.quantity >= 99} onClick={() => setQty(item, item.quantity + 1)}>+</button>
                  </div>
                  <button type="button" className="pn-remove" disabled={busy} onClick={() => setQty(item, 0)}>Remove</button>
                </li>
              ))}
            </ul>
            <div className="pn-total"><span>Total</span><strong>{money(total, currency)}</strong></div>
            {error && <p className="pn-error" role="alert">{error}</p>}
            <button type="button" className="pn-btn" disabled={busy} onClick={placeOrder}>{busy ? 'Please wait…' : 'Place order'}</button>
          </>
        )
      )}

      {view === 'placed' && placed && (
        <div className="pn-placed">
          <p>Thanks! Your order <strong>#{String(placed.id).slice(0, 8).toUpperCase()}</strong> for {money(placed.total_cents, placed.currency)} has been received.</p>
          <button type="button" className="pn-btn" onClick={() => setView('orders')}>View my orders</button>
        </div>
      )}

      {view === 'orders' && (
        orders === null ? <p className="pn-empty">{error || 'Loading…'}</p>
          : orders.length === 0 ? <p className="pn-empty">No orders yet.</p>
            : (
              <ul className="pn-list">
                {orders.map((o) => (
                  <li key={o.id} className="pn-order">
                    <div>
                      <strong>#{o.id.slice(0, 8).toUpperCase()}</strong>
                      <span>{new Date(o.created_at).toLocaleString()}</span>
                      <span>{o.order_items.map((i) => `${i.quantity} × ${i.product_name}`).join(', ')}</span>
                    </div>
                    <div className="pn-order-r">
                      <strong>{money(o.total_cents, o.currency)}</strong>
                      <span className="pn-status">{o.status}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )
      )}
    </Panel>
  );
}
