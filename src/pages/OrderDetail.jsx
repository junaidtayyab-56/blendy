import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { supabase } from '../supabase.js';
import usePageTitle from '../components/usePageTitle.js';
import { useSettings } from '../store/settings.jsx';
import { money } from '../supabase.js';

export const STATUS_STEPS = ['pending', 'paid', 'preparing', 'shipped', 'delivered'];

export function StatusBadge({ status }) {
  return <span className={`b-status b-status-${status}`}>{status}</span>;
}

export default function OrderDetail() {
  const { id } = useParams();
  const loc = useLocation();
  const placed = loc.state?.placed;
  const [order, setOrder] = useState(undefined);
  const { settings } = useSettings();
  usePageTitle(placed ? 'Order confirmed' : 'Order');

  useEffect(() => {
    supabase.from('orders').select('*, items:order_items(id, product_name, unit_price_cents, quantity), cards:card_redemptions(id, amount_cents, restored_at, card:discount_cards(code))').eq('id', id).maybeSingle()
      .then(({ data, error }) => { if (error) console.error(error); setOrder(data || null); });
  }, [id]);

  if (order === undefined) return <div className="b-wrap b-page b-loading">Loading…</div>;
  if (!order) return <div className="b-wrap b-page b-empty"><h1>Order not found</h1><Link className="b-btn" to="/account">My orders</Link></div>;

  const fmt = (c) => money(c, order.currency || settings.currency);
  const step = STATUS_STEPS.indexOf(order.status);

  return (
    <div className="b-wrap b-page b-narrow">
      {placed && (
        <div className="b-confirm">
          <div className="b-confirm-ico" aria-hidden="true">✓</div>
          <h1>Thank you for your order!</h1>
          <p>Order <strong>#{order.order_number}</strong> is confirmed. We'll get blending and deliver it soon. Pay {fmt(order.total_cents)} in cash on delivery.</p>
        </div>
      )}
      {!placed && <div className="b-page-head"><h1>Order #{order.order_number}</h1></div>}
      <div className="b-panel">
        <div className="b-order-head">
          <div>
            <span className="b-muted">Placed {new Date(order.created_at).toLocaleString()}</span>
            {placed && <div><strong>Order #{order.order_number}</strong></div>}
          </div>
          <StatusBadge status={order.status} />
        </div>
        {order.status !== 'cancelled' && (
          <ol className="b-steps">
            {STATUS_STEPS.map((s, i) => <li key={s} className={i <= step ? 'done' : ''}>{s}</li>)}
          </ol>
        )}
        <ul className="b-mini-lines">
          {order.items.map((i) => (
            <li key={i.id}><span>{i.quantity} × {i.product_name}</span><span>{fmt(i.quantity * i.unit_price_cents)}</span></li>
          ))}
        </ul>
        <div className="b-sum-row"><span>Subtotal</span><span>{fmt(order.subtotal_cents || order.total_cents)}</span></div>
        <div className="b-sum-row"><span>Shipping</span><span>{order.shipping_cents ? fmt(order.shipping_cents) : 'Free'}</span></div>
        {order.discount_cents > 0 && (
          <>
            <div className="b-sum-row b-sum-disc"><span>Discount cards</span><span>−{fmt(order.discount_cents)}</span></div>
            {order.cards?.length > 0 && (
              <div className="b-sum-codes">
                {order.cards.map((r) => r.card?.code).filter(Boolean).join(', ')}
                {order.status === 'cancelled' && order.cards.some((r) => r.restored_at) && ' · returned to your account'}
              </div>
            )}
          </>
        )}
        <div className="b-sum-row b-sum-total"><span>{order.discount_cents > 0 ? 'Total to pay' : 'Total'}</span><strong>{fmt(order.total_cents)}</strong></div>
        {order.shipping_name && (
          <div className="b-addr">
            <h3>Delivering to</h3>
            <p>{order.shipping_name}<br />{order.shipping_address}<br />{order.shipping_city}{order.shipping_postal_code ? ` ${order.shipping_postal_code}` : ''}<br />{order.shipping_country}<br />{order.shipping_phone}</p>
            <p className="b-muted">Payment: cash on delivery</p>
          </div>
        )}
      </div>
      <div className="b-actions-row">
        <Link className="b-btn" to="/shop">Continue shopping</Link>
        <Link className="b-btn b-btn-ghost" to="/account">My orders</Link>
      </div>
    </div>
  );
}
