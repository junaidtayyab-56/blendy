import { useEffect, useState } from 'react';
import { supabase } from '../supabase.js';
import { useSettings } from '../store/settings.jsx';
import { useToast } from '../store/toast.jsx';
import { centsToInput, inputToCents } from './util.js';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'PKR', 'INR', 'AED', 'SAR', 'CAD', 'AUD'];

export default function Settings() {
  const { reload } = useSettings();
  const flash = useToast();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from('store_settings').select('*').maybeSingle().then(({ data }) => {
      const d = data || {};
      setForm({
        store_name: d.store_name || 'Blendy', tagline: d.tagline || '', about: d.about || '', contact_email: d.contact_email || '', contact_phone: d.contact_phone || '',
        address: d.address || '', currency: d.currency || 'USD', shipping: centsToInput(d.shipping_fee_cents ?? 0), free_over: centsToInput(d.free_shipping_threshold_cents),
        announcement: d.announcement || '', instagram_url: d.instagram_url || '', facebook_url: d.facebook_url || '', tiktok_url: d.tiktok_url || '',
      });
    });
  }, []);

  if (!form) return <div className="bx-loading">Loading…</div>;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    const shipping = inputToCents(form.shipping) ?? 0;
    const freeOver = inputToCents(form.free_over);
    if (Number.isNaN(shipping) || Number.isNaN(freeOver)) return flash('Enter valid amounts for shipping');
    const t = (v) => v.trim() || null;
    setBusy(true);
    const { error } = await supabase.from('store_settings').update({
      store_name: form.store_name.trim() || 'Blendy', tagline: t(form.tagline), about: t(form.about), contact_email: t(form.contact_email), contact_phone: t(form.contact_phone),
      address: t(form.address), currency: form.currency, shipping_fee_cents: shipping, free_shipping_threshold_cents: freeOver, announcement: t(form.announcement),
      instagram_url: t(form.instagram_url), facebook_url: t(form.facebook_url), tiktok_url: t(form.tiktok_url),
    }).eq('id', true);
    setBusy(false);
    if (error) flash(error.message); else { flash('Settings saved'); reload(); }
  }

  return (
    <form onSubmit={save}>
      <div className="bx-head"><h1>Website settings</h1><button className="b-btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button></div>
      <div className="bx-grid2">
        <section className="bx-card">
          <h2>Store</h2>
          <label className="b-field"><span>Store name</span><input required value={form.store_name} onChange={set('store_name')} maxLength={60} /></label>
          <label className="b-field"><span>Tagline</span><input value={form.tagline} onChange={set('tagline')} maxLength={120} /></label>
          <label className="b-field"><span>Announcement bar (leave empty to hide)</span><input value={form.announcement} onChange={set('announcement')} maxLength={160} placeholder="Free delivery this weekend!" /></label>
          <label className="b-field"><span>About us text</span><textarea rows={7} value={form.about} onChange={set('about')} maxLength={4000} placeholder="Shown on the About page. Leave empty for the default text." /></label>
        </section>
        <div className="bx-stack">
          <section className="bx-card">
            <h2>Checkout</h2>
            <div className="b-form-grid">
              <label className="b-field"><span>Currency</span><select value={form.currency} onChange={set('currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label className="b-field"><span>Shipping fee</span><input inputMode="decimal" value={form.shipping} onChange={set('shipping')} /></label>
              <label className="b-field b-span2"><span>Free shipping over (optional)</span><input inputMode="decimal" value={form.free_over} onChange={set('free_over')} placeholder="Leave empty for no free shipping" /></label>
            </div>
            <p className="b-muted b-small">Payment method: cash on delivery. Changing the currency doesn't convert product prices.</p>
          </section>
          <section className="bx-card">
            <h2>Contact and social</h2>
            <div className="b-form-grid">
              <label className="b-field"><span>Email</span><input type="email" value={form.contact_email} onChange={set('contact_email')} /></label>
              <label className="b-field"><span>Phone</span><input value={form.contact_phone} onChange={set('contact_phone')} /></label>
              <label className="b-field b-span2"><span>Address</span><input value={form.address} onChange={set('address')} /></label>
              <label className="b-field"><span>Instagram URL</span><input type="url" value={form.instagram_url} onChange={set('instagram_url')} /></label>
              <label className="b-field"><span>Facebook URL</span><input type="url" value={form.facebook_url} onChange={set('facebook_url')} /></label>
              <label className="b-field b-span2"><span>TikTok URL</span><input type="url" value={form.tiktok_url} onChange={set('tiktok_url')} /></label>
            </div>
          </section>
        </div>
      </div>
    </form>
  );
}
