import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabase.js';
import { useToast } from '../store/toast.jsx';
import { StatusBadge } from '../pages/OrderDetail.jsx';
import { STATUSES, fmtDateTime, money } from './util.js';

export default function Orders() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const [orders, setOrders] = useState(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    let req = supabase.from('orders').select('id, order_number, status, total_cents, currency, created_at, email, shipping_name, shipping_city, items:order_items(quantity)').order('created_at', { ascending: false }).limit(500);
    if (status) req = req.eq('status', status);
    setOrders(null);
    req.then(({ data, error }) => { if (error) console.error(error); setOrders(data || []); });
  }, [status]);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase().replace(/^#/, '');
    if (!orders || !n) return orders || [];
    return orders.filter((o) => String(o.order_number).includes(n) || (o.email || '').toLowerCase().includes(n) || (o.shipping_name || '').toLowerCase().includes(n));
  }, [orders, q]);

  return (
    <div>
      <div className="bx-head"><h1>Orders</h1></div>
      <div className="bx-toolbar">
        <div className="b-chips">
          <button type="button" aria-selected={!status} onClick={() => setParams({})}>All</button>
          {STATUSES.map((s) => <button type="button" key={s} aria-selected={status === s} onClick={() => setParams({ status: s })}>{s}</button>)}
        </div>
        <input className="bx-input" type="search" placeholder="Search order #, name or email" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="bx-card bx-flush">
        {orders === null ? <div className="bx-loading">Loading…</div> : shown.length === 0 ? <p className="bx-empty">No orders found.</p> : (
          <table className="bx-table bx-table-stack">
            <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Items</th><th>Status</th><th className="r">Total</th></tr></thead>
            <tbody>
              {shown.map((o) => (
                <tr key={o.id}>
                  <td data-l="Order"><Link to={`/admin/orders/${o.id}`}>#{o.order_number}</Link></td>
                  <td data-l="Date">{fmtDateTime(o.created_at)}</td>
                  <td data-l="Customer">{o.shipping_name || '—'}<br /><small className="b-muted">{o.email}</small></td>
                  <td data-l="Items">{o.items.reduce((n, i) => n + i.quantity, 0)}</td>
                  <td data-l="Status"><StatusBadge status={o.status} /></td>
                  <td data-l="Total" className="r">{money(o.total_cents, o.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export function AdminOrder() {
  const { id } = useParams();
  const flash = useToast();
  const [order, setOrder] = useState(undefined);
  const [status, setStatus] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error } = await supabase.from('orders').select('*, items:order_items(id, product_id, product_name, unit_price_cents, quantity)').eq('id', id).maybeSingle();
    if (error) console.error(error);
    setOrder(data || null);
    if (data) { setStatus(data.status); setNotes(data.notes || ''); }
  }
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (status === 'cancelled' && order.status !== 'cancelled' && !window.confirm('Cancel this order? Its items go back into stock, and a cancelled order cannot be reopened.')) return;
    setBusy(true);
    const { error } = await supabase.from('orders').update({ status, notes: notes.trim() || null }).eq('id', id);
    setBusy(false);
    if (error) flash(error.message); else { flash('Order updated'); load(); }
  }

  if (order === undefined) return <div className="bx-loading">Loading…</div>;
  if (!order) return <p>Order not found. <Link to="/admin/orders">Back to orders</Link></p>;
  const fmt = (c) => money(c, order.currency);
  const locked = order.status === 'cancelled';

  return (
    <div>
      <div className="bx-head">
        <div><Link to="/admin/orders" className="bx-back">← Orders</Link><h1>Order #{order.order_number}</h1><span className="b-muted">{fmtDateTime(order.created_at)}</span></div>
        <StatusBadge status={order.status} />
      </div>
      <div className="bx-grid2 bx-grid-wide">
        <section className="bx-card">
          <h2>Items</h2>
          <table className="bx-table">
            <thead><tr><th>Product</th><th className="r">Price</th><th className="r">Qty</th><th className="r">Total</th></tr></thead>
            <tbody>
              {order.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.product_id ? <Link to={`/admin/products/${i.product_id}`}>{i.product_name}</Link> : i.product_name}</td>
                  <td className="r">{fmt(i.unit_price_cents)}</td><td className="r">{i.quantity}</td><td className="r">{fmt(i.unit_price_cents * i.quantity)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={3}>Subtotal</td><td className="r">{fmt(order.subtotal_cents || order.total_cents)}</td></tr>
              <tr><td colSpan={3}>Shipping</td><td className="r">{fmt(order.shipping_cents)}</td></tr>
              <tr className="bx-tot"><td colSpan={3}>Total (cash on delivery)</td><td className="r">{fmt(order.total_cents)}</td></tr>
            </tfoot>
          </table>
        </section>
        <div className="bx-stack">
          <section className="bx-card">
            <h2>Update order</h2>
            <label className="b-field"><span>Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={locked}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="b-field"><span>Internal notes</span><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></label>
            <button type="button" className="b-btn b-btn-block" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
            {locked && <p className="b-muted b-small">Cancelled orders are closed. Stock was returned.</p>}
          </section>
          <section className="bx-card">
            <h2>Customer</h2>
            <p>{order.shipping_name}<br /><a href={`mailto:${order.email}`}>{order.email}</a><br /><a href={`tel:${order.shipping_phone}`}>{order.shipping_phone}</a></p>
            <h3>Delivery address</h3>
            <p>{order.shipping_address}<br />{order.shipping_city} {order.shipping_postal_code}<br />{order.shipping_country}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
