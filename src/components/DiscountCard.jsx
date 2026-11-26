// One Blendy discount card, drawn like a premium loyalty card. Read-only: the code,
// percentage and status all come from the database.
const STATUS_LABEL = { available: 'Available', used: 'Used', revoked: 'Revoked', expired: 'Expired' };

export const fmtCardDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export function CardStatus({ status }) {
  return <span className={`b-dc-status b-dc-status-${status}`}>{STATUS_LABEL[status] || status}</span>;
}

export default function DiscountCard({ card, percent, compact = false, selected = false }) {
  const pct = card.used_percent ?? percent;
  const pctText = pct == null ? '' : `${Number(pct) % 1 === 0 ? Number(pct) : Number(pct).toFixed(2)}%`;
  const dim = card.status && card.status !== 'available';
  return (
    <div className={'b-dc' + (compact ? ' b-dc-compact' : '') + (dim ? ' b-dc-dim' : '') + (selected ? ' b-dc-selected' : '')}>
      <div className="b-dc-shine" aria-hidden="true" />
      <div className="b-dc-top">
        <span className="b-dc-brand">Blendy</span>
        {card.status && <CardStatus status={card.status} />}
      </div>
      <div className="b-dc-mid">
        <strong className="b-dc-pct">{pctText}<small>OFF</small></strong>
        <span className="b-dc-kind">{card.source === 'gift' ? 'Gift card' : 'Discount card'}</span>
      </div>
      <div className="b-dc-bot">
        <span className="b-dc-code" aria-label="Card ID">{card.code}</span>
        <span className="b-dc-date">
          {card.issued_at && <>Issued {fmtCardDate(card.issued_at)}</>}
          {card.expires_at && card.status === 'available' && <> · Valid until {fmtCardDate(card.expires_at)}</>}
        </span>
      </div>
    </div>
  );
}
