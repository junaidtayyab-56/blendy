import { useState } from 'react';
import { supabase } from '../supabase.js';
import usePageTitle from '../components/usePageTitle.js';
import { useAuth } from '../store/auth.jsx';
import { useSettings } from '../store/settings.jsx';

export default function Contact() {
  usePageTitle('Contact us');
  const { settings } = useSettings();
  const { user, profile } = useAuth();
  const [form, setForm] = useState({ name: profile?.full_name || '', email: user?.email || '', subject: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const { error } = await supabase.from('contact_messages').insert({
      name: form.name.trim(), email: form.email.trim(), subject: form.subject.trim() || null, message: form.message.trim(),
    });
    setBusy(false);
    if (error) setError('Could not send your message. Please try again.');
    else setSent(true);
  }

  return (
    <div className="b-wrap b-page">
      <div className="b-page-head"><h1>Contact us</h1><p className="b-muted">Questions about an order or a flavour? We'd love to hear from you.</p></div>
      <div className="b-two b-two-rev">
        <section className="b-panel">
          {sent ? (
            <div className="b-confirm b-confirm-s">
              <div className="b-confirm-ico" aria-hidden="true">✓</div>
              <h2>Message sent</h2>
              <p>Thanks, {form.name.split(' ')[0]}. We'll reply to {form.email} soon.</p>
            </div>
          ) : (
            <form className="b-form" onSubmit={submit}>
              <div className="b-form-grid">
                <label className="b-field"><span>Name</span><input required maxLength={120} value={form.name} onChange={set('name')} autoComplete="name" /></label>
                <label className="b-field"><span>Email</span><input required type="email" maxLength={254} value={form.email} onChange={set('email')} autoComplete="email" /></label>
                <label className="b-field b-span2"><span>Subject (optional)</span><input maxLength={200} value={form.subject} onChange={set('subject')} /></label>
                <label className="b-field b-span2"><span>Message</span><textarea required rows={6} maxLength={5000} value={form.message} onChange={set('message')} /></label>
              </div>
              {error && <p className="b-error" role="alert">{error}</p>}
              <button className="b-btn" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send message'}</button>
            </form>
          )}
        </section>
        <aside className="b-panel b-contact-info">
          <h2>Get in touch</h2>
          {settings.contact_email && <p><span className="b-muted">Email</span><br /><a href={`mailto:${settings.contact_email}`}>{settings.contact_email}</a></p>}
          {settings.contact_phone && <p><span className="b-muted">Phone</span><br /><a href={`tel:${settings.contact_phone.replace(/\s/g, '')}`}>{settings.contact_phone}</a></p>}
          {settings.address && <p><span className="b-muted">Address</span><br />{settings.address}</p>}
          {!settings.contact_email && !settings.contact_phone && !settings.address && <p className="b-muted">Send us a message with the form and we'll reply by email.</p>}
        </aside>
      </div>
    </div>
  );
}
