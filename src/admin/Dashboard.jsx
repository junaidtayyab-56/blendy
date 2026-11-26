import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase.js';
import { useSettings } from '../store/settings.jsx';
import { StatusBadge } from '../pages/OrderDetail.jsx';
import { STATUSES, fmtDateTime } from './util.js';

export default function Dashboard() {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  const { fmt } = useSettings();

  useEffect(() => {
    supabase.rpc('admin_dashboard_stats').then(({ data, error }) => {
      if (error) setError(error.message); else setS(data);
    });
  }, []);

  if (error) return <p className="b-error">{error}</p>;
  if (!s) return <div className="ad-loading">Loading dashboard…</div>;

  const max = Math.max(1, ...s.sales_14d.map((d) => d.cents));
  const cards = [
    ['Total revenue', fmt(s.revenue_cents), `${fmt(s.revenue_30d_cents)} in the last 30 days`, '/admin/orders'],
    ['Orders', s.orders_total, `${s.orders_by_status.pending || 0} pending`, '/admin/orders'],
    ['Customers', s.customers_total, `${s.customers_30d} new in 30 days`, '/admin/customers'],
    ['Products', s.products_total, `${s.products_active} active`, '/admin/products'],
  ];

  return (
    <div>
      <div className="ad-head"><h1>Dashboard</h1>{s.messages_new > 0 && <Link to="/admin/messages" className="ad-note">{s.messages_new} new message{s.messages_new > 1 ? 's' : ''}</Link>}</div>
      <div className="ad-stats">
        {cards.map(([t, v, sub, to]) => (
          <Link key={t} to={to} className="ad-stat"><span>{t}</span><strong>{v}</strong><small>{sub}</small></Link>
        ))}
      </div>
      <div className="ad-grid2">
        <section className="ad-card">
          <h2>Sales, last 14 days</h2>
          <div className="ad-bars" role="img" aria-label="Daily sales for the last 14 days">
            {s.sales_14d.map((d) => (
              <div key={d.day} className="ad-bar" title={`${d.day}: ${fmt(d.cents)} (${d.orders} orders)`}>
                <i style={{ height: `${Math.max(2, (d.cents / max) * 100)}%` }} />
                <span>{new Date(d.day + 'T00:00').getDate()}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="ad-card">
          <h2>Orders by status</h2>
          <ul className="ad-status-list">
            {STATUSES.map((st) => (
              <li key={st}><Link to={`/admin/orders?status=${st}`}><StatusBadge status={st} /><strong>{s.orders_by_status[st] || 0}</strong></Link></li>
            ))}
          </ul>
        </section>
      </div>
      <div className="ad-grid2">
        <section className="ad-card">
          <div className="ad-card-head"><h2>Recent orders</h2><Link to="/admin/orders">View all</Link></div>
          {s.recent_orders.length === 0 ? <p className="b-muted">No orders yet.</p> : (
            <table className="ad-table">
              <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th className="r">Total</th></tr></thead>
              <tbody>
                {s.recent_orders.map((o) => (
                  <tr key={o.id}>
                    <td><Link to={`/admin/orders/${o.id}`}>#{o.order_number}</Link><br /><small className="b-muted">{fmtDateTime(o.created_at)}</small></td>
                    <td>{o.shipping_name || o.email}</td>
                    <td><StatusBadge status={o.status} /></td>
                    <td className="r">{fmt(o.total_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="ad-card">
          <div className="ad-card-head"><h2>Low stock</h2><Link to="/admin/inventory">Inventory</Link></div>
          {s.low_stock.length === 0 ? <p className="b-muted">Every product has more than 10 in stock.</p> : (
            <ul className="ad-low">
              {s.low_stock.map((p) => <li key={p.id}><Link to={`/admin/products/${p.id}`}>{p.name}</Link><strong className={p.stock === 0 ? 'b-out' : ''}>{p.stock} left</strong></li>)}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
