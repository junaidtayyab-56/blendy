import { money } from '../supabase.js';

export const STATUSES = ['pending', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled'];
export const centsToInput = (c) => (c == null ? '' : (c / 100).toFixed(2));
export const inputToCents = (v) => {
  if (v === '' || v == null) return null;
  const n = Math.round(parseFloat(String(v).replace(',', '.')) * 100);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};
export const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
export const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtDateTime = (d) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export { money };
