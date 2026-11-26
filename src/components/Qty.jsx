export default function Qty({ value, onChange, min = 1, max = 99, disabled, label = 'Quantity' }) {
  return (
    <div className="b-qty" role="group" aria-label={label}>
      <button type="button" aria-label="Decrease" disabled={disabled || value <= min} onClick={() => onChange(value - 1)}>−</button>
      <span aria-live="polite">{value}</span>
      <button type="button" aria-label="Increase" disabled={disabled || value >= max} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}
