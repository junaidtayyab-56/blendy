import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabase.js';
import { useSettings } from '../store/settings.jsx';
import { useToast } from '../store/toast.jsx';
import DiscountCard, { CardStatus } from '../components/DiscountCard.jsx';
import { centsToInput, fmtDate, fmtDateTime, inputToCents } from './util.js';

const TABS = [
  ['', 'Overview'],
  ['settings', 'Settings'],
  ['milestones', 'Reward milestones'],
  ['customers', 'Customers'],
  ['cards', 'All cards'],
];
const EVENT = { issued: 'Earned', gifted: 'Gifted', used: 'Used', restored: 'Returned', revoked: 'Revoked' };
const ELIG = {
  eligible: ['Eligible', 'ok'],
  negative_feedback: ['Blocked (negative)', 'bad'],
  needs_approval: ['Needs positive feedback', 'warn'],
};
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const pctText = (p) => (p == null ? '' : `${Number(p) % 1 === 0 ? Number(p) : Number(p).toFixed(2)}%`);

export default function Rewards() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || '';
  const [percent, setPercent] = useState(null);
  useEffect(() => {
    supabase.from('reward_settings').select('discount_percent').maybeSingle().then(({ data }) => setPercent(data?.discount_percent ?? null));
  }, [tab]);
  const go = (t, extra = {}) => setParams(t ? { tab: t, ...extra } : { ...extra });

  return (
    <div>
      <div className="bx-head">
        <div><h1>Discount cards</h1><span className="b-muted">One card type{percent != null ? `, ${pctText(percent)} off each` : ''}. You decide when customers earn them.</span></div>
      </div>
      <div className="bx-toolbar">
        <div className="b-chips" role="tablist">
          {TABS.map(([t, label]) => <button type="button" role="tab" key={t} aria-selected={tab === t} onClick={() => go(t)}>{label}</button>)}
        </div>
      </div>
      {tab === '' && <Overview go={go} />}
      {tab === 'settings' && <RewardSettings onSaved={setPercent} />}
      {tab === 'milestones' && <Milestones />}
      {tab === 'customers' && <RewardCustomers go={go} />}
      {tab === 'cards' && <AllCards percent={percent} />}
    </div>
  );
}

function Overview({ go }) {
  const { fmt } = useSettings();
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    supabase.rpc('admin_reward_stats').then(({ data, error }) => { if (error) setError(error.message); else setS(data); });
  }, []);
  if (error) return <p className="b-error">{error}</p>;
  if (!s) return <div className="bx-loading">Loading…</div>;
  const cards = [
    ['Cards issued', s.issued, `${s.gifted} gifted by admin`, 'cards'],
    ['Active cards', s.active, `${s.expired} expired, ${s.revoked} revoked`, 'cards'],
    ['Cards used', s.used, `${s.customers_with_cards} customers have cards`, 'cards'],
    ['Discounts redeemed', fmt(s.redeemed_cents), 'On orders not cancelled', 'cards'],
  ];
  return (
    <>
      <div className="bx-stats">
        {cards.map(([t, v, sub, to]) => (
          <button type="button" key={t} className="bx-stat bx-stat-btn" onClick={() => go(to)}><span>{t}</span><strong>{v}</strong><small>{sub}</small></button>
        ))}
      </div>
      <section className="bx-card bx-flush">
        <div className="bx-card-head bx-pad"><h2>Reward history</h2><button type="button" className="bx-linkbtn" onClick={() => go('cards')}>All cards</button></div>
        {s.recent.length === 0 ? <p className="bx-empty">No cards yet. Cards appear here when customers reach a milestone or you gift one.</p> : (
          <table className="bx-table bx-table-stack">
            <thead><tr><th>When</th><th>Customer</th><th>Event</th><th>Card</th><th>Details</th></tr></thead>
            <tbody>
              {s.recent.map((e) => (
                <tr key={e.id}>
                  <td data-l="When">{fmtDateTime(e.created_at)}</td>
                  <td data-l="Customer"><button type="button" className="bx-linkbtn" onClick={() => go('cards', { user: e.user_id })}>{e.full_name || e.email}</button></td>
                  <td data-l="Event"><span className={'bx-chip' + (e.event === 'issued' || e.event === 'gifted' ? ' ok' : '')}>{EVENT[e.event] || e.event}</span></td>
                  <td data-l="Card"><code className="bx-code">{e.code}</code></td>
                  <td data-l="Details">{e.order_number ? <Link to={`/admin/orders/${e.order_id}`}>Order #{e.order_number}</Link> : null}{e.order_number && e.note ? ' · ' : ''}{e.note || (e.order_number ? '' : '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function RewardSettings({ onSaved }) {
  const flash = useToast();
  const { fmt } = useSettings();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.from('reward_settings').select('*').maybeSingle().then(({ data }) => {
      const d = data || {};
      setF({
        discount_percent: String(d.discount_percent ?? 10), auto_issue: d.auto_issue ?? true, require_positive_feedback: !!d.require_positive_feedback,
        allow_multiple_cards: d.allow_multiple_cards ?? true, max_cards_per_order: d.max_cards_per_order ?? '', max_discount: centsToInput(d.max_discount_cents),
        expiry_days: d.expiry_days ?? '',
      });
    });
  }, []);
  if (!f) return <div className="bx-loading">Loading…</div>;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function save(e) {
    e.preventDefault();
    const pct = Number(String(f.discount_percent).replace(',', '.'));
    if (!(pct > 0 && pct <= 100)) return flash('Discount must be between 0.01% and 100%');
    const maxCards = f.max_cards_per_order === '' ? null : parseInt(f.max_cards_per_order, 10);
    if (maxCards !== null && !(maxCards >= 1)) return flash('Max cards per order must be 1 or more, or empty');
    const maxDisc = inputToCents(f.max_discount);
    if (Number.isNaN(maxDisc)) return flash('Enter a valid maximum discount, or leave it empty');
    const days = f.expiry_days === '' ? null : parseInt(f.expiry_days, 10);
    if (days !== null && !(days >= 1 && days <= 3650)) return flash('Expiry must be 1 to 3650 days, or empty');
    setBusy(true);
    const { error } = await supabase.from('reward_settings').update({
      discount_percent: Math.round(pct * 100) / 100, auto_issue: f.auto_issue, require_positive_feedback: f.require_positive_feedback,
      allow_multiple_cards: f.allow_multiple_cards, max_cards_per_order: f.allow_multiple_cards ? maxCards : null, max_discount_cents: maxDisc, expiry_days: days,
    }).eq('id', true);
    setBusy(false);
    if (error) flash(error.message); else { flash('Discount card settings saved'); onSaved?.(Math.round(pct * 100) / 100); }
  }

  return (
    <form onSubmit={save}>
      <div className="bx-grid2">
        <section className="bx-card">
          <h2>Card value</h2>
          <label className="b-field"><span>Discount percentage per card</span>
            <input inputMode="decimal" value={f.discount_percent} onChange={set('discount_percent')} required />
            <small>Every card, new and unused, gives this percentage off the order’s products (not shipping). Used cards keep the percentage they were used at.</small>
          </label>
          <label className="b-field"><span>Card expiry in days (optional)</span>
            <input inputMode="numeric" value={f.expiry_days} onChange={set('expiry_days')} placeholder="Leave empty: cards never expire" />
            <small>Applies to cards issued after you save.</small>
          </label>
          <h2 className="bx-mt">Using cards at checkout</h2>
          <label className="b-check"><input type="checkbox" checked={f.allow_multiple_cards} onChange={set('allow_multiple_cards')} /> Allow several cards in one order</label>
          {f.allow_multiple_cards && (
            <label className="b-field"><span>Max cards per order (optional)</span><input inputMode="numeric" value={f.max_cards_per_order} onChange={set('max_cards_per_order')} placeholder="No limit" /></label>
          )}
          <label className="b-field"><span>Max discount per order (optional)</span>
            <input inputMode="decimal" value={f.max_discount} onChange={set('max_discount')} placeholder="No limit" />
            <small>{f.max_discount && !Number.isNaN(inputToCents(f.max_discount)) ? `Customers save at most ${fmt(inputToCents(f.max_discount))} per order.` : 'The discount can never be more than the products total.'}</small>
          </label>
        </section>
        <div className="bx-stack">
          <section className="bx-card">
            <h2>Automatic cards</h2>
            <label className="b-check"><input type="checkbox" checked={f.auto_issue} onChange={set('auto_issue')} /> Issue cards automatically at reward milestones</label>
            <p className="b-muted b-small">When an order is set to <strong>delivered</strong>, the customer’s completed orders are counted and any milestone cards they have earned are issued once. Turn this off to pause automatic cards; you can still gift cards.</p>
          </section>
          <section className="bx-card">
            <h2>Feedback rule</h2>
            <label className="b-check"><input type="checkbox" checked={f.require_positive_feedback} onChange={set('require_positive_feedback')} /> Only customers with positive feedback get automatic cards</label>
            <p className="b-muted b-small">The store has no review system, so you set each customer’s feedback in the Customers tab. Customers marked <strong>negative</strong> never get automatic cards. With this switch on, only customers you mark <strong>positive</strong> do. Gifted cards ignore this rule.</p>
          </section>
          <button className="b-btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
        </div>
      </div>
    </form>
  );
}

function Milestones() {
  const flash = useToast();
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState({});
  const [add, setAdd] = useState({ orders_required: '', cards_awarded: '1' });
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error } = await supabase.from('reward_milestones').select('*').order('orders_required');
    if (error) flash(error.message);
    setRows(data || []);
    setEdit({});
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const valid = (o, c) => Number.isInteger(o) && o >= 1 && o <= 100000 && Number.isInteger(c) && c >= 1 && c <= 50;
  const friendly = (m) => (/duplicate|unique/i.test(m) ? 'There is already a milestone at that number of orders' : m);

  async function create(e) {
    e.preventDefault();
    const o = parseInt(add.orders_required, 10); const c = parseInt(add.cards_awarded, 10);
    if (!valid(o, c)) return flash('Enter completed orders (1 or more) and cards (1 to 50)');
    setBusy(true);
    const { error } = await supabase.from('reward_milestones').insert({ orders_required: o, cards_awarded: c });
    setBusy(false);
    if (error) flash(friendly(error.message)); else { flash('Milestone added'); setAdd({ orders_required: '', cards_awarded: '1' }); load(); }
  }
  async function saveRow(m) {
    const e = edit[m.id];
    const o = parseInt(e.orders_required, 10); const c = parseInt(e.cards_awarded, 10);
    if (!valid(o, c)) return flash('Enter completed orders (1 or more) and cards (1 to 50)');
    const { error } = await supabase.from('reward_milestones').update({ orders_required: o, cards_awarded: c, active: e.active }).eq('id', m.id);
    if (error) flash(friendly(error.message)); else { flash('Milestone saved'); load(); }
  }
  async function remove(m) {
    if (!window.confirm(`Delete the milestone at ${m.orders_required} completed orders? Cards already issued for it stay with customers.`)) return;
    const { error } = await supabase.from('reward_milestones').delete().eq('id', m.id);
    if (error) flash(error.message); else { flash('Milestone deleted'); load(); }
  }
  async function runAll() {
    if (!window.confirm('Check every customer now and issue any milestone cards they have earned but not received?')) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_run_reward_check', {});
    setBusy(false);
    if (error) flash(error.message); else flash(data ? `${data} card${data > 1 ? 's' : ''} issued` : 'Everyone is up to date');
  }

  if (!rows) return <div className="bx-loading">Loading…</div>;
  let cum = 0;
  const active = rows.filter((r) => r.active);

  return (
    <div className="bx-grid2 bx-grid-wide">
      <section className="bx-card bx-flush">
        <div className="bx-card-head bx-pad"><h2>Reward schedule</h2><span className="b-muted b-small">{active.length} active</span></div>
        {rows.length === 0 ? <p className="bx-empty">No milestones yet. Add the first one on the right.</p> : (
          <table className="bx-table bx-table-stack">
            <thead><tr><th>Reward</th><th>Completed orders</th><th>Cards given</th><th>Active</th><th></th></tr></thead>
            <tbody>
              {rows.map((m) => {
                const e = edit[m.id];
                if (m.active) cum += m.cards_awarded;
                const label = m.active ? (m.cards_awarded === 1 ? `${ordinal(cum)} card` : `${ordinal(cum - m.cards_awarded + 1)}–${ordinal(cum)} cards`) : 'Off';
                return (
                  <tr key={m.id} className={e ? 'bx-dirty' : ''}>
                    <td data-l="Reward"><strong>{label}</strong></td>
                    <td data-l="Completed orders">{e ? <input className="bx-num" inputMode="numeric" value={e.orders_required} onChange={(ev) => setEdit({ ...edit, [m.id]: { ...e, orders_required: ev.target.value } })} aria-label="Completed orders" /> : m.orders_required}</td>
                    <td data-l="Cards given">{e ? <input className="bx-num" inputMode="numeric" value={e.cards_awarded} onChange={(ev) => setEdit({ ...edit, [m.id]: { ...e, cards_awarded: ev.target.value } })} aria-label="Cards given" /> : m.cards_awarded}</td>
                    <td data-l="Active">{e ? <input type="checkbox" checked={e.active} onChange={(ev) => setEdit({ ...edit, [m.id]: { ...e, active: ev.target.checked } })} aria-label="Active" /> : (m.active ? <span className="bx-chip ok">On</span> : <span className="bx-chip">Off</span>)}</td>
                    <td className="r bx-row-actions">
                      {e ? (<><button type="button" onClick={() => saveRow(m)}>Save</button><button type="button" onClick={() => setEdit({ ...edit, [m.id]: undefined })}>Cancel</button></>)
                        : (<><button type="button" onClick={() => setEdit({ ...edit, [m.id]: { orders_required: String(m.orders_required), cards_awarded: String(m.cards_awarded), active: m.active } })}>Edit</button>
                          <button type="button" className="bx-danger" onClick={() => remove(m)}>Delete</button></>)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <div className="bx-stack">
        <form className="bx-card" onSubmit={create}>
          <h2>Add a milestone</h2>
          <div className="b-form-grid">
            <label className="b-field"><span>After completed orders</span><input inputMode="numeric" value={add.orders_required} onChange={(e) => setAdd({ ...add, orders_required: e.target.value })} placeholder="e.g. 12" required /></label>
            <label className="b-field"><span>Cards to give</span><input inputMode="numeric" value={add.cards_awarded} onChange={(e) => setAdd({ ...add, cards_awarded: e.target.value })} required /></label>
          </div>
          <button className="b-btn b-btn-block" type="submit" disabled={busy}>Add milestone</button>
          <p className="b-muted b-small bx-mt-s">Each milestone is separate: set any number of orders and any number of cards. A customer gets each milestone’s cards once, even if an order’s status changes later.</p>
        </form>
        <section className="bx-card">
          <h2>Customers who already qualify</h2>
          <p className="b-muted b-small">Cards are issued when an order is marked delivered. After adding a lower milestone or turning automatic cards back on, run a check to give earned cards to everyone right away.</p>
          <button type="button" className="b-btn b-btn-ghost b-btn-block" onClick={runAll} disabled={busy}>Check all customers now</button>
        </section>
      </div>
    </div>
  );
}

function RewardCustomers({ go }) {
  const flash = useToast();
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [gift, setGift] = useState(null); // { id, label, count, reason }
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error } = await supabase.rpc('admin_reward_customers');
    if (error) flash(error.message);
    setRows(data || []);
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (rows || []).filter((r) => !n || (r.email || '').toLowerCase().includes(n) || (r.full_name || '').toLowerCase().includes(n));
  }, [rows, q]);

  async function setFeedback(r, feedback) {
    const { data, error } = await supabase.rpc('admin_set_customer_feedback', { p_user: r.id, p_feedback: feedback, p_note: r.feedback_note });
    if (error) return flash(error.message);
    flash(data ? `Feedback saved. ${data} earned card${data > 1 ? 's' : ''} issued.` : 'Feedback saved');
    load();
  }
  async function sendGift(e) {
    e.preventDefault();
    const count = parseInt(gift.count, 10);
    if (!(count >= 1 && count <= 20)) return flash('Gift between 1 and 20 cards');
    setBusy(true);
    const { error } = await supabase.rpc('admin_gift_cards', { p_user: gift.id, p_count: count, p_reason: gift.reason });
    setBusy(false);
    if (error) return flash(error.message);
    flash(`${count} card${count > 1 ? 's' : ''} gifted to ${gift.label}`);
    setGift(null);
    load();
  }

  return (
    <>
      {gift && (
        <form className="bx-card bx-gift" onSubmit={sendGift}>
          <h2>Gift discount cards to {gift.label}</h2>
          <div className="b-form-grid">
            <label className="b-field"><span>Number of cards</span><input inputMode="numeric" value={gift.count} onChange={(e) => setGift({ ...gift, count: e.target.value })} /></label>
            <label className="b-field"><span>Reason or note (optional, admins only)</span><input value={gift.reason} maxLength={500} onChange={(e) => setGift({ ...gift, reason: e.target.value })} placeholder="e.g. Sorry for the late delivery" /></label>
          </div>
          <div className="b-actions-row"><button className="b-btn" type="submit" disabled={busy}>{busy ? 'Gifting…' : 'Gift cards'}</button><button className="b-btn b-btn-ghost" type="button" onClick={() => setGift(null)}>Cancel</button></div>
          <p className="b-muted b-small bx-mt-s">Gifted cards skip milestones and the feedback rule, and show up in the customer’s account straight away.</p>
        </form>
      )}
      <div className="bx-toolbar"><input className="bx-input" type="search" placeholder="Search customer name or email" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="bx-card bx-flush">
        {rows === null ? <div className="bx-loading">Loading…</div> : shown.length === 0 ? <p className="bx-empty">No customers found.</p> : (
          <table className="bx-table bx-table-stack">
            <thead><tr><th>Customer</th><th className="r">Completed</th><th>Feedback</th><th>Automatic cards</th><th className="r">Available</th><th className="r">Used</th><th>Next card at</th><th></th></tr></thead>
            <tbody>
              {shown.map((r) => {
                const [elig, tone] = ELIG[r.eligibility] || [r.eligibility, ''];
                return (
                  <tr key={r.id}>
                    <td data-l="Customer"><strong>{r.full_name || '—'}</strong><br /><span className="b-muted">{r.email}</span></td>
                    <td data-l="Completed" className="r">{r.completed_orders}<small className="b-muted"> / {r.orders_count}</small></td>
                    <td data-l="Feedback">
                      <select className={`bx-fb bx-fb-${r.feedback}`} value={r.feedback} onChange={(e) => setFeedback(r, e.target.value)} aria-label={`Feedback for ${r.email}`}>
                        <option value="positive">Positive</option><option value="neutral">Neutral</option><option value="negative">Negative</option>
                      </select>
                    </td>
                    <td data-l="Automatic cards"><span className={`bx-chip ${tone}`}>{elig}</span></td>
                    <td data-l="Available" className="r">{r.cards_available}</td>
                    <td data-l="Used" className="r">{r.cards_used}</td>
                    <td data-l="Next card at">{r.next_orders_required ? `${r.next_orders_required} orders` : '—'}</td>
                    <td className="r bx-row-actions">
                      <button type="button" onClick={() => { setGift({ id: r.id, label: r.full_name || r.email, count: '1', reason: '' }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Gift card</button>
                      <button type="button" onClick={() => go('cards', { user: r.id })}>Cards{r.cards_total ? ` (${r.cards_total})` : ''}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="b-muted b-small bx-mt-s">Completed = delivered orders / all orders. Changing feedback to an eligible value issues any milestone cards the customer has already earned.</p>
    </>
  );
}

function AllCards({ percent }) {
  const flash = useToast();
  const { fmt } = useSettings();
  const [params, setParams] = useSearchParams();
  const user = params.get('user');
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [q, setQ] = useState('');

  async function load() {
    let req = supabase.from('discount_cards')
      .select('id, code, user_id, source, milestone_orders, status, effective_status, issued_at, expires_at, used_at, revoked_at, revoke_reason, profile:profiles!discount_cards_user_id_fkey(email, full_name), gift:card_gifts(reason, created_at), order:orders!discount_cards_used_order_id_fkey(id, order_number), redemptions:card_redemptions(amount_cents, discount_percent, restored_at)')
      .order('issued_at', { ascending: false }).limit(1000);
    if (user) req = req.eq('user_id', user);
    const { data, error } = await req;
    if (error) flash(error.message);
    setRows(data || []);
  }
  useEffect(() => { load(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (rows || []).filter((r) => (!status || r.effective_status === status) && (!source || r.source === source)
      && (!n || r.code.toLowerCase().includes(n) || (r.profile?.email || '').toLowerCase().includes(n) || (r.profile?.full_name || '').toLowerCase().includes(n)));
  }, [rows, status, source, q]);

  async function revoke(c) {
    const reason = window.prompt(`Revoke card ${c.code}? It can't be used after this. Reason (optional):`, '');
    if (reason === null) return;
    const { error } = await supabase.rpc('admin_revoke_card', { p_card: c.id, p_reason: reason });
    if (error) flash(error.message); else { flash('Card revoked'); load(); }
  }

  const who = user && rows?.[0]?.profile;
  return (
    <>
      {user && (
        <div className="bx-filter-note">
          Showing cards for <strong>{who ? (who.full_name || who.email) : 'one customer'}</strong>
          <button type="button" className="bx-linkbtn" onClick={() => setParams({ tab: 'cards' })}>Show all customers</button>
        </div>
      )}
      <div className="bx-toolbar">
        <div className="b-chips">
          {[['', 'All'], ['available', 'Available'], ['used', 'Used'], ['revoked', 'Revoked'], ['expired', 'Expired']].map(([v, l]) => (
            <button type="button" key={v} aria-selected={status === v} onClick={() => setStatus(v)}>{l}</button>
          ))}
          <button type="button" aria-selected={source === 'gift'} onClick={() => setSource(source === 'gift' ? '' : 'gift')}>Gifted only</button>
        </div>
        <input className="bx-input" type="search" placeholder="Search card ID or customer" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="bx-card bx-flush">
        {rows === null ? <div className="bx-loading">Loading…</div> : shown.length === 0 ? <p className="bx-empty">No cards found.</p> : (
          <table className="bx-table bx-table-stack">
            <thead><tr><th>Card ID</th><th>Customer</th><th>How</th><th>Issued</th><th>Status</th><th>Usage</th><th></th></tr></thead>
            <tbody>
              {shown.map((c) => {
                const gift = Array.isArray(c.gift) ? c.gift[0] : c.gift;
                const live = (c.redemptions || []).find((r) => !r.restored_at);
                return (
                  <tr key={c.id}>
                    <td data-l="Card ID"><code className="bx-code">{c.code}</code></td>
                    <td data-l="Customer">{c.profile ? (c.profile.full_name || c.profile.email) : '—'}{c.profile?.full_name && <><br /><small className="b-muted">{c.profile.email}</small></>}</td>
                    <td data-l="How">{c.source === 'gift' ? <><span className="bx-chip">Gift</span>{gift?.reason && <><br /><small className="b-muted">{gift.reason}</small></>}</> : `Milestone: ${c.milestone_orders} orders`}</td>
                    <td data-l="Issued">{fmtDate(c.issued_at)}{c.expires_at && <><br /><small className="b-muted">Expires {fmtDate(c.expires_at)}</small></>}</td>
                    <td data-l="Status"><CardStatus status={c.effective_status} /></td>
                    <td data-l="Usage">
                      {c.status === 'used' && c.order ? <><Link to={`/admin/orders/${c.order.id}`}>Order #{c.order.order_number}</Link>{live && <><br /><small className="b-muted">−{fmt(live.amount_cents)} at {pctText(live.discount_percent)}</small></>}</>
                        : c.status === 'revoked' ? <small className="b-muted">{fmtDate(c.revoked_at)}{c.revoke_reason ? ` · ${c.revoke_reason}` : ''}</small> : '—'}
                    </td>
                    <td className="r bx-row-actions">{c.status === 'available' && <button type="button" className="bx-danger" onClick={() => revoke(c)}>Revoke</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {user && rows?.length > 0 && (
        <div className="bx-card-preview">
          {rows.filter((c) => c.effective_status === 'available').slice(0, 3).map((c) => <DiscountCard key={c.id} card={{ ...c, status: 'available' }} percent={percent} compact />)}
        </div>
      )}
    </>
  );
}
