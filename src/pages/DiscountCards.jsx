import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase.js';
import usePageTitle from '../components/usePageTitle.js';
import DiscountCard, { CardStatus, fmtCardDate } from '../components/DiscountCard.jsx';
import { useAuth } from '../store/auth.jsx';
import { useSettings } from '../store/settings.jsx';

const pctText = (p) => (p == null ? '' : `${Number(p) % 1 === 0 ? Number(p) : Number(p).toFixed(2)}%`);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const EVENT_LABEL = { issued: 'Earned', gifted: 'Gifted by Blendy', used: 'Used', restored: 'Returned (order cancelled)', revoked: 'Revoked' };

export default function DiscountCards() {
  usePageTitle('Discount Cards');
  const { user, ready } = useAuth();
  const { fmt } = useSettings();
  const [rules, setRules] = useState(null);
  const [milestones, setMilestones] = useState(null);
  const [mine, setMine] = useState(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supabase) return;
    supabase.from('reward_settings').select('*').maybeSingle().then(({ data, error }) => { if (error) setError(error.message); setRules(data || {}); });
    supabase.from('reward_milestones').select('orders_required, cards_awarded').eq('active', true).order('orders_required')
      .then(({ data }) => setMilestones(data || []));
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!user) { setMine(null); return; }
    supabase.rpc('my_rewards').then(({ data, error }) => { if (error) setError(error.message); setMine(data || null); });
  }, [user, ready]);

  const percent = rules?.discount_percent;
  const ms = milestones || [];

  return (
    <div className="b-page">
      <section className="b-hero-band b-dc-band">
        <div className="b-wrap b-band-in">
          <div>
            <h1>Discount Cards</h1>
            <p className="b-lead">Order your favourite smoothies, earn discount cards, and save on your next orders.</p>
          </div>
          <div className="b-dc-band-art" aria-hidden="true">
            <DiscountCard card={{ code: 'BLD-····-····', source: 'milestone' }} percent={percent ?? 10} />
          </div>
        </div>
      </section>

      <div className="b-wrap">
        {error && <p className="b-error" role="alert">{error}</p>}

        {!ready || (user && mine === undefined) ? <div className="b-loading">Loading…</div> : user ? (
          mine && <Wallet data={mine} fmt={fmt} />
        ) : (
          <section className="b-panel b-dc-guest">
            <div>
              <h2>See your cards</h2>
              <p className="b-muted">Log in to see your discount cards, the orders that count towards your next card, and your card history.</p>
            </div>
            <div className="b-actions-row">
              <Link className="b-btn" to="/login?next=/discount-cards">Log in</Link>
              <Link className="b-btn b-btn-ghost" to="/register">Create account</Link>
            </div>
          </section>
        )}

        <h2 className="b-dc-h2">How it works</h2>
        <div className="b-values b-dc-steps">
          <div className="b-panel"><span className="b-dc-step">1</span><h3>Order and enjoy</h3><p className="b-muted">Every order that is delivered to you counts as a completed order.</p></div>
          <div className="b-panel"><span className="b-dc-step">2</span><h3>Earn cards</h3><p className="b-muted">When your completed orders reach a reward milestone, your cards appear in your account automatically.</p></div>
          <div className="b-panel"><span className="b-dc-step">3</span><h3>Save at checkout</h3><p className="b-muted">Pick your cards in the “Use Discount Cards” section at checkout. The discount comes straight off your total.</p></div>
        </div>

        <div className="b-two b-two-rev b-dc-info">
          <section className="b-panel">
            <h2>Reward milestones</h2>
            {milestones === null ? <p className="b-muted">Loading…</p> : ms.length === 0 ? (
              <p className="b-muted">New reward milestones are coming soon.</p>
            ) : (
              <ul className="b-dc-miles">
                {ms.map((m) => {
                  const reached = mine && mine.completed_orders >= m.orders_required;
                  return (
                    <li key={m.orders_required} className={reached ? 'done' : ''}>
                      <span className="b-dc-mile-dot" aria-hidden="true">{reached ? '✓' : ''}</span>
                      <span><strong>{plural(m.orders_required, 'completed order', 'completed orders')}</strong></span>
                      <span className="b-dc-mile-get">{plural(m.cards_awarded, 'card', 'cards')}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {rules && !rules.auto_issue && <p className="b-muted b-small">Automatic cards are paused right now. Cards you already have can still be used.</p>}
          </section>
          <section className="b-panel">
            <h2>Card rules</h2>
            {rules === null ? <p className="b-muted">Loading…</p> : (
              <ul className="b-dc-rules">
                <li>Every card gives <strong>{pctText(percent)} off</strong> your order’s products.</li>
                <li>{rules.allow_multiple_cards
                  ? (rules.max_cards_per_order ? `You can combine up to ${rules.max_cards_per_order} cards in one order.` : 'You can combine several cards in one order.')
                  : 'You can use one card per order.'}</li>
                {rules.max_discount_cents != null && <li>The most you can save on one order is {fmt(rules.max_discount_cents)}.</li>}
                <li>{rules.expiry_days ? `Cards are valid for ${plural(rules.expiry_days, 'day', 'days')} after they are issued.` : 'Cards do not expire.'}</li>
                <li>Each card can be used once and only on your own account.</li>
                <li>A card is a discount, not a payment method. You pay the rest with cash on delivery as usual.</li>
                <li>If an order is cancelled, the cards used on it go back to your account.</li>
                {rules.require_positive_feedback && <li>Automatic cards are given to customers in good standing.</li>}
              </ul>
            )}
          </section>
        </div>
        <div className="b-center b-cta"><Link className="b-btn" to="/shop">Shop smoothies</Link></div>
      </div>
    </div>
  );
}

function Wallet({ data, fmt }) {
  const cards = data.cards || [];
  const available = cards.filter((c) => c.status === 'available');
  const past = cards.filter((c) => c.status !== 'available');
  const reached = (data.milestones || []).filter((m) => m.reached);
  const prev = reached.length ? reached[reached.length - 1].orders_required : 0;
  const next = data.next;
  const span = next ? Math.max(1, next.orders_required - prev) : 1;
  const progress = next ? Math.min(100, Math.max(0, ((data.completed_orders - prev) / span) * 100)) : 100;

  return (
    <section className="b-dc-wallet" aria-labelledby="my-cards">
      <div className="b-row-between b-dc-wallet-head">
        <h2 id="my-cards">My discount cards</h2>
        <span className="b-muted">{plural(available.length, 'card', 'cards')} ready to use</span>
      </div>

      <div className="b-panel b-dc-progress">
        <div className="b-dc-progress-text">
          <div><span className="b-muted">Completed orders</span><strong>{data.completed_orders}</strong></div>
          {next ? (
            <p>{next.remaining === 1 ? 'Just 1 more completed order' : `${next.remaining} more completed orders`} to earn {plural(next.cards_awarded, 'card', 'cards')} (at {next.orders_required} orders).</p>
          ) : (
            <p>{(data.milestones || []).length ? 'You have reached every reward milestone. Thank you!' : 'New reward milestones are coming soon.'}</p>
          )}
        </div>
        {next && (
          <div className="b-dc-bar" role="progressbar" aria-valuemin={prev} aria-valuemax={next.orders_required} aria-valuenow={data.completed_orders}
            aria-label="Progress to your next card">
            <i style={{ width: `${progress}%` }} />
          </div>
        )}
        {data.eligibility === 'paused' && <p className="b-dc-note">Automatic cards are paused on your account. Please <Link to="/contact">contact us</Link> if you have questions.</p>}
        {data.eligibility === 'pending_approval' && <p className="b-dc-note">Automatic cards are given once your account has been reviewed by our team. Your completed orders still count.</p>}
        {!data.auto_issue && <p className="b-dc-note">Automatic cards are paused right now. Your completed orders still count.</p>}
      </div>

      {available.length === 0 ? (
        <div className="b-panel b-empty-s"><p className="b-muted">You don’t have any cards to use yet.</p><Link className="b-btn" to="/shop">Start an order</Link></div>
      ) : (
        <div className="b-dc-grid">
          {available.map((c) => <DiscountCard key={c.id} card={c} percent={data.discount_percent} />)}
        </div>
      )}

      {past.length > 0 && (
        <div className="b-panel b-dc-history">
          <h2>Card history</h2>
          <ul>
            {past.map((c) => (
              <li key={c.id}>
                <div className="b-dc-hist-main">
                  <span className="b-dc-code-sm">{c.code}</span>
                  <CardStatus status={c.status} />
                </div>
                <div className="b-muted b-small">
                  {c.source === 'gift' ? 'Gift' : 'Earned'} {fmtCardDate(c.issued_at)}
                  {c.status === 'used' && c.used_order && <> · Used on <Link to={`/order/${c.used_order.id}`}>order #{c.used_order.order_number}</Link> {fmtCardDate(c.used_at)}{c.used_amount_cents != null && <>, saved {fmt(c.used_amount_cents)} ({pctText(c.used_percent)})</>}</>}
                  {c.status === 'revoked' && <> · Revoked {fmtCardDate(c.revoked_at)}</>}
                  {c.status === 'expired' && <> · Expired {fmtCardDate(c.expires_at)}</>}
                </div>
                {c.history?.length > 1 && (
                  <details className="b-dc-events"><summary>Usage history</summary>
                    <ol>{c.history.map((e, i) => <li key={i}>{EVENT_LABEL[e.event] || e.event}{e.order_number ? ` · order #${e.order_number}` : ''} · {fmtCardDate(e.at)}</li>)}</ol>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

