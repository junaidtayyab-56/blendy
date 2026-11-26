import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { supabase, money } from '../supabase.js';
import usePageTitle from '../components/usePageTitle.js';
import { useAuth } from '../store/auth.jsx';
import { useToast } from '../store/toast.jsx';
import { StatusBadge } from './OrderDetail.jsx';

export default function Account() {
  usePageTitle('My account');
  const { user, profile, isAdmin, reloadProfile, signOut } = useAuth();
  const flash = useToast();
  const loc = useLocation();
  const [orders, setOrders] = useState(null);
  const [form, setForm] = useState({ full_name: '', phone: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (loc.state?.msg) flash(loc.state.msg); }, [loc.state, flash]);
  useEffect(() => { if (profile) setForm({ full_name: profile.full_name || '', phone: profile.phone || '' }); }, [profile]);
  useEffect(() => {
    if (!user) return;
    supabase.from('orders').select('id, order_number, status, total_cents, currency, created_at, items:order_items(quantity)')
      .eq('user_id', user.id).order('created_at', { ascending: false })
      .then(({ data, error }) => { if (error) console.error(error); setOrders(data || []); });
  }, [user]);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ full_name: form.full_name.trim() || null, phone: form.phone.trim() || null }).eq('id', user.id);
    setSaving(false);
    if (error) flash(error.message); else { flash('Profile saved'); reloadProfile(); }
  }

  return (
    <div className="b-wrap b-page">
      <div className="b-page-head b-row-between">
        <div>
          <h1>Hi{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}!</h1>
          <p className="b-muted">{user?.email}</p>
        </div>
        <div className="b-actions-row">
          {isAdmin && <Link className="b-btn" to="/admin">Admin panel</Link>}
          <Link className="b-btn b-btn-ghost" to="/discount-cards">My discount cards</Link>
          <button type="button" className="b-btn b-btn-ghost" onClick={async () => { await signOut(); flash('You are logged out'); }}>Log out</button>
        </div>
      </div>
      <div className="b-two b-two-rev">
        <section className="b-panel">
          <h2>Order history</h2>
          {orders === null ? <p className="b-muted">Loading…</p> : orders.length === 0 ? (
            <div className="b-empty-s"><p>You haven't ordered yet.</p><Link className="b-btn" to="/shop">Start shopping</Link></div>
          ) : (
            <ul className="b-orders">
              {orders.map((o) => (
                <li key={o.id}>
                  <Link to={`/order/${o.id}`}>
                    <div><strong>#{o.order_number}</strong><span className="b-muted">{new Date(o.created_at).toLocaleDateString()} · {o.items.reduce((n, i) => n + i.quantity, 0)} items</span></div>
                    <div className="b-orders-r"><strong>{money(o.total_cents, o.currency)}</strong><StatusBadge status={o.status} /></div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="b-panel">
          <h2>Profile</h2>
          <form className="b-form" onSubmit={save}>
            <label className="b-field"><span>Name</span><input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} maxLength={120} autoComplete="name" /></label>
            <label className="b-field"><span>Phone</span><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={40} type="tel" autoComplete="tel" /></label>
            <label className="b-field"><span>Email</span><input value={user?.email || ''} disabled /></label>
            <button className="b-btn" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
          </form>
          <p className="b-muted b-small"><Link to="/forgot-password">Change password</Link></p>
        </section>
      </div>
    </div>
  );
}
