import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabase.js';
import { useToast } from '../store/toast.jsx';
import { fmtDateTime, money } from './util.js';

const TABS = [
  ['', 'Order emails'],
  ['cards', 'Card activity'],
  ['settings', 'Email settings'],
];
const EMAIL = {
  pending: ['Queued', 'warn'],
  sending: ['Sending', 'warn'],
  sent: ['Sent', 'ok'],
  failed: ['Failed', 'bad'],
  skipped: ['Not sent', ''],
};
const EVENT = { issued: 'Earned', gifted: 'Gifted', used: 'Used', restored: 'Returned', revoked: 'Revoked' };

export default function Notifications() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || '';
  return (
    <div>
      <div className="bx-head">
        <div><h1>Notifications</h1><span className="b-muted">Order emails sent to you, and the discount card alerts your customers get.</span></div>
      </div>
      <div className="bx-toolbar">
        <div className="b-chips" role="tablist">
          {TABS.map(([t, label]) => <button type="button" role="tab" key={t} aria-selected={tab === t} onClick={() => setParams(t ? { tab: t } : {})}>{label}</button>)}
        </div>
      </div>
      {tab === '' && <OrderEmails />}
      {tab === 'cards' && <CardActivity />}
      {tab === 'settings' && <EmailSettings />}
    </div>
  );
}

function OrderEmails() {
  const flash = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);

  async function load() {
    const { data, error } = await supabase.rpc('admin_order_email_log', { p_limit: 100 });
    if (error) setError(error.message); else { setError(''); setRows(data || []); }
  }
  useEffect(() => { load(); }, []);
  // While an email is on its way, check again every few seconds.
  useEffect(() => {
    if (!rows?.some((r) => r.email_status === 'pending' || r.email_status === 'sending')) return undefined;
    const t = setTimeout(load, 4000);
    return () => clearTimeout(t);
  }, [rows]);

  async function resend(r) {
    const force = r.email_status === 'sent';
    if (force && !window.confirm(`The email for order #${r.order_number} was already sent. Send it again?`)) return;
    setBusy(r.order_id);
    const { data, error } = await supabase.rpc('admin_retry_order_email', { p_order: r.order_id, p_force: force });
    setBusy(null);
    if (error) flash(error.message);
    else flash(data === 'pending' ? 'Sending the email…' : `Nothing to do: the email is ${EMAIL[data]?.[0].toLowerCase() || data}`);
    load();
  }

  if (error) return <p className="b-error">{error}</p>;
  return (
    <section className="bx-card bx-flush">
      <div className="bx-card-head bx-pad"><h2>Recent orders</h2><button type="button" className="bx-linkbtn" onClick={load}>Refresh</button></div>
      {rows === null ? <div className="bx-loading">Loading…</div> : rows.length === 0 ? <p className="bx-empty">No orders yet. Each new order is emailed to you here.</p> : (
        <table className="bx-table bx-table-stack">
          <thead><tr><th>Order</th><th>Placed</th><th>Customer</th><th>Total</th><th>Email</th><th>Details</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const [label, tone] = r.email_status ? EMAIL[r.email_status] || [r.email_status, ''] : ['Before emails', ''];
              return (
                <tr key={r.order_id}>
                  <td data-l="Order"><Link to={`/admin/orders/${r.order_id}`}>#{r.order_number}</Link></td>
                  <td data-l="Placed">{fmtDateTime(r.created_at)}</td>
                  <td data-l="Customer">{r.customer || '—'}<br /><small className="b-muted">{r.email}</small></td>
                  <td data-l="Total">{money(r.total_cents, r.currency)}</td>
                  <td data-l="Email"><span className={`bx-chip ${tone}`}>{label}</span></td>
                  <td data-l="Details">
                    {r.email_status === 'sent' && <>To {r.recipient}<br /><small className="b-muted">{fmtDateTime(r.sent_at)}</small></>}
                    {(r.email_status === 'failed' || r.email_status === 'skipped') && <small className="bx-err-text">{r.last_error || '—'}</small>}
                    {(r.email_status === 'pending' || r.email_status === 'sending') && <small className="b-muted">Queued {fmtDateTime(r.queued_at)}</small>}
                    {!r.email_status && <small className="b-muted">Placed before order emails were set up</small>}
                  </td>
                  <td data-l="">
                    {r.email_status !== 'pending' && r.email_status !== 'sending' && (
                      <button type="button" className="bx-linkbtn" disabled={busy === r.order_id} onClick={() => resend(r)}>
                        {r.email_status === 'sent' ? 'Send again' : 'Send email'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function CardActivity() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    supabase.rpc('admin_card_activity', { p_limit: 150 }).then(({ data, error }) => { if (error) setError(error.message); else setRows(data || []); });
  }, []);
  if (error) return <p className="b-error">{error}</p>;
  return (
    <section className="bx-card bx-flush">
      <div className="bx-card-head bx-pad"><h2>Discount card activity</h2><Link className="bx-linkbtn" to="/admin/discount-cards">Manage cards</Link></div>
      {rows === null ? <div className="bx-loading">Loading…</div> : rows.length === 0 ? <p className="bx-empty">No card activity yet.</p> : (
        <table className="bx-table bx-table-stack">
          <thead><tr><th>When</th><th>Customer</th><th>Event</th><th>Card</th><th>Customer alert</th><th>Details</th></tr></thead>
          <tbody>
            {rows.map((e) => {
              const notifies = e.event === 'issued' || e.event === 'gifted';
              return (
                <tr key={e.id}>
                  <td data-l="When">{fmtDateTime(e.created_at)}</td>
                  <td data-l="Customer">{e.customer_name || e.customer_email}{e.customer_name && <><br /><small className="b-muted">{e.customer_email}</small></>}</td>
                  <td data-l="Event"><span className={'bx-chip' + (notifies ? ' ok' : '')}>{EVENT[e.event] || e.event}</span></td>
                  <td data-l="Card"><code className="bx-code">{e.code}</code></td>
                  <td data-l="Customer alert">
                    {!notifies ? <span className="b-muted">—</span>
                      : !e.notified_at ? <span className="b-muted">Before alerts</span>
                        : e.read_at ? <><span className="bx-chip ok">Read</span><small className="b-muted">{fmtDateTime(e.read_at)}</small></>
                          : <span className="bx-chip warn">Unread</span>}
                  </td>
                  <td data-l="Details">{e.order_id ? <Link to={`/admin/orders/${e.order_id}`}>Order</Link> : null}{e.order_id && e.note ? ' · ' : ''}{e.note || (e.order_id ? '' : '—')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function EmailSettings() {
  const flash = useToast();
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(null);

  useEffect(() => {
    supabase.from('notification_settings').select('admin_email, order_emails_enabled').maybeSingle().then(({ data, error }) => {
      if (error) { setError(error.message); return; }
      const f = { admin_email: data?.admin_email || '', order_emails_enabled: data?.order_emails_enabled !== false };
      setForm(f); setSaved(f);
    });
  }, []);

  if (error) return <p className="b-error">{error}</p>;
  if (!form) return <div className="bx-loading">Loading…</div>;
  const dirty = saved && (form.admin_email.trim() !== saved.admin_email || form.order_emails_enabled !== saved.order_emails_enabled);

  async function save(e) {
    e.preventDefault();
    const email = form.admin_email.trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return flash('Enter a valid email address');
    setBusy(true);
    const { error } = await supabase.from('notification_settings').update({ admin_email: email || null, order_emails_enabled: form.order_emails_enabled }).eq('id', true);
    setBusy(false);
    if (error) flash(error.message);
    else { const f = { admin_email: email, order_emails_enabled: form.order_emails_enabled }; setForm(f); setSaved(f); flash('Email settings saved'); }
  }

  async function test() {
    setTesting(true);
    const { data, error } = await supabase.functions.invoke('order-email', { body: { test: true } });
    setTesting(false);
    if (data?.ok) { flash(`Test email sent to ${data.sent}`); return; }
    let message = data?.error;
    if (!message && error?.context?.json) { try { message = (await error.context.json()).error; } catch { /* ignore */ } }
    flash(message || error?.message || 'Could not send the test email');
  }

  return (
    <form onSubmit={save} className="bx-grid2">
      <section className="bx-card">
        <h2>Order emails</h2>
        <p className="bx-hint b-muted">Every new order is emailed here with the customer's details, products, prices, total, address and payment method.</p>
        <label className="b-field"><span>Send order emails to</span>
          <input type="email" value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} maxLength={254} placeholder="you@gmail.com" />
        </label>
        <label className="b-check"><input type="checkbox" checked={form.order_emails_enabled} onChange={(e) => setForm({ ...form, order_emails_enabled: e.target.checked })} /> Email me when a customer places an order</label>
        <div className="b-actions-row">
          <button className="b-btn" type="submit" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save'}</button>
          <button className="b-btn b-btn-ghost" type="button" disabled={testing || dirty || !saved.admin_email} onClick={test}>{testing ? 'Sending…' : 'Send test email'}</button>
        </div>
        {dirty && <p className="bx-hint b-muted">Save first, then send a test email.</p>}
      </section>
      <section className="bx-card">
        <h2>Customer alerts</h2>
        <p className="b-muted">Customers get an alert under the bell at the top of the website whenever they earn a discount card or you gift them one. Clicking it opens that card. These are always on, and each customer only ever sees their own.</p>
        <p className="b-muted">See who has read their alerts in <Link to="/admin/notifications?tab=cards">Card activity</Link>.</p>
      </section>
    </form>
  );
}
