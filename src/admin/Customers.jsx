import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase.js';
import { useAuth } from '../store/auth.jsx';
import { useSettings } from '../store/settings.jsx';
import { useToast } from '../store/toast.jsx';
import { fmtDate } from './util.js';

export default function Customers() {
  const { user } = useAuth();
  const { fmt } = useSettings();
  const flash = useToast();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');

  async function load() {
    const { data, error } = await supabase.rpc('admin_customers');
    if (error) flash(error.message);
    setRows(data || []);
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (rows || []).filter((r) => !n || (r.email || '').toLowerCase().includes(n) || (r.full_name || '').toLowerCase().includes(n) || (r.phone || '').includes(n));
  }, [rows, q]);

  async function toggleAdmin(r) {
    const makeAdmin = r.role !== 'admin';
    const msg = makeAdmin ? `Give ${r.email} full admin access to the store?` : `Remove admin access from ${r.email}?`;
    if (!window.confirm(msg)) return;
    const { error } = await supabase.from('profiles').update({ role: makeAdmin ? 'admin' : 'customer' }).eq('id', r.id);
    if (error) flash(error.message); else { flash('Role updated'); load(); }
  }

  return (
    <div>
      <div className="ad-head"><h1>Customers</h1><span className="b-muted">{rows ? `${rows.length} accounts` : ''}</span></div>
      <div className="ad-toolbar"><input className="ad-input" type="search" placeholder="Search name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="ad-card ad-flush">
        {rows === null ? <div className="ad-loading">Loading…</div> : shown.length === 0 ? <p className="ad-empty">No customers yet.</p> : (
          <table className="ad-table ad-table-stack">
            <thead><tr><th>Customer</th><th>Phone</th><th>Joined</th><th className="r">Orders</th><th className="r">Spent</th><th>Role</th><th></th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td data-l="Customer"><strong>{r.full_name || '—'}</strong><br /><a href={`mailto:${r.email}`} className="b-muted">{r.email}</a></td>
                  <td data-l="Phone">{r.phone || '—'}</td>
                  <td data-l="Joined">{fmtDate(r.created_at)}</td>
                  <td data-l="Orders" className="r">{r.orders_count}</td>
                  <td data-l="Spent" className="r">{fmt(r.total_spent_cents)}</td>
                  <td data-l="Role">{r.role === 'admin' ? <span className="ad-chip ok">Admin</span> : <span className="ad-chip">Customer</span>}</td>
                  <td className="r ad-row-actions">{r.id !== user.id && <button type="button" onClick={() => toggleAdmin(r)}>{r.role === 'admin' ? 'Remove admin' : 'Make admin'}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
