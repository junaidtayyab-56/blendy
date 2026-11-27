// Blendy: email the admin when a customer places an order.
//
// Called by the database (pg_net) right after an order is saved, with {"order_id": "..."}.
// It only ever sends an email whose row in admin_order_emails is 'pending', and it claims
// that row first, so a repeated call can never send the same order twice. Anyone may call
// it with an order id, but that can only send the store's own pending email to the
// store's own admin address, once.
//
// {"test": true} sends a test email; that needs a signed-in admin.
//
// Secrets (Supabase > Edge Functions > Secrets), never in the website code:
//   GMAIL_USER          the Gmail address that sends the emails
//   GMAIL_APP_PASSWORD  a Gmail app password (16 letters) for that address
// or, instead of Gmail:
//   RESEND_API_KEY      a Resend API key   (optional RESEND_FROM, e.g. "Blendy <orders@yourdomain.com>")
// Optional: STORE_TIMEZONE (default Asia/Karachi), SITE_URL (default https://blendy-neon.vercel.app)
// SUPABASE_URL and the server key (SUPABASE_SECRET_KEYS or SUPABASE_SERVICE_ROLE_KEY) are provided by Supabase.

import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6.9.16';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TZ = Deno.env.get('STORE_TIMEZONE') || 'Asia/Karachi';
const SITE = (Deno.env.get('SITE_URL') || 'https://blendy-neon.vercel.app').replace(/\/$/, '');

// Server key: the new-style secret key when the project has one, else the legacy service role key.
function serverKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
    const k = keys.default || Object.values(keys)[0];
    if (typeof k === 'string' && k) return k;
  } catch { /* not set */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}

const db = createClient(Deno.env.get('SUPABASE_URL')!, serverKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function money(cents: number, currency: string) {
  try {
    const whole = (cents || 0) % 100 === 0;
    return new Intl.NumberFormat('en', {
      style: 'currency', currency: currency || 'USD', ...(whole ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    }).format((cents || 0) / 100);
  } catch {
    return `${currency} ${((cents || 0) / 100).toFixed(2)}`;
  }
}

function when(iso: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

const PAYMENT: Record<string, string> = { cod: 'Cash on delivery' };

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------
async function sendEmail(to: string, subject: string, html: string, text: string) {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (resendKey) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: Deno.env.get('RESEND_FROM') || 'Blendy Orders <onboarding@resend.dev>', to: [to], subject, html, text }),
    });
    if (!res.ok) throw new Error(`Resend: ${res.status} ${(await res.text()).slice(0, 300)}`);
    return;
  }
  const user = Deno.env.get('GMAIL_USER');
  const pass = Deno.env.get('GMAIL_APP_PASSWORD');
  if (!user || !pass) throw new Error('Email is not set up yet: add GMAIL_USER and GMAIL_APP_PASSWORD in Supabase Edge Function secrets.');
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user, pass: pass.replace(/\s+/g, '') },
  });
  await transport.sendMail({ from: `"Blendy Orders" <${user}>`, to, subject, html, text });
}

// ---------------------------------------------------------------------------
// Template (inline styles: email apps ignore stylesheets)
// ---------------------------------------------------------------------------
const INK = '#2f2440';
const MUTED = '#7a6f88';
const LINE = '#ece4f3';
const BG = '#f6f1fa';

function layout(title: string, inner: string, storeName: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${BG};font-family:Poppins,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 10px 30px rgba(50,30,70,.08)">
<tr><td style="background:${INK};padding:22px 28px">
  <span style="font-size:24px;font-weight:800;letter-spacing:-.02em;color:#ffffff">${esc(storeName)}</span>
  <span style="float:right;margin-top:6px;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#f3da8a">${esc(title)}</span>
</td></tr>
<tr><td style="padding:28px">${inner}</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid ${LINE};font-size:12px;color:${MUTED}">Sent automatically by your ${esc(storeName)} store.</td></tr>
</table></td></tr></table></body></html>`;
}

const row = (label: string, value: string) =>
  `<tr><td style="padding:6px 0;color:${MUTED};font-size:13px;width:140px;vertical-align:top">${esc(label)}</td><td style="padding:6px 0;font-size:14px;font-weight:500">${value}</td></tr>`;

// deno-lint-ignore no-explicit-any
function orderEmail(order: any, items: any[], storeName: string) {
  const cur = order.currency;
  const num = `#${order.order_number ?? String(order.id).slice(0, 8)}`;
  const address = [order.shipping_address, order.shipping_city, order.shipping_postal_code, order.shipping_country].filter(Boolean).join(', ');
  const lines = items.map((i) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid ${LINE};font-size:14px">${esc(i.product_name)}</td>
      <td style="padding:10px 0;border-bottom:1px solid ${LINE};font-size:14px;text-align:center">${esc(i.quantity)}</td>
      <td style="padding:10px 0;border-bottom:1px solid ${LINE};font-size:14px;text-align:right">${esc(money(i.unit_price_cents, cur))}</td>
      <td style="padding:10px 0;border-bottom:1px solid ${LINE};font-size:14px;text-align:right;font-weight:600">${esc(money(i.unit_price_cents * i.quantity, cur))}</td>
    </tr>`).join('');
  const total = (label: string, cents: number, strong = false) =>
    `<tr><td colspan="3" style="padding:4px 0;text-align:right;font-size:${strong ? 16 : 13}px;color:${strong ? INK : MUTED};font-weight:${strong ? 700 : 400}">${esc(label)}</td>
     <td style="padding:4px 0;text-align:right;font-size:${strong ? 16 : 13}px;font-weight:${strong ? 700 : 500}">${esc(money(cents, cur))}</td></tr>`;

  const inner = `
    <h1 style="margin:0 0 4px;font-size:22px;font-weight:700">New order ${esc(num)}</h1>
    <p style="margin:0 0 22px;color:${MUTED};font-size:14px">${esc(when(order.created_at))}</p>

    <h2 style="margin:0 0 6px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">Customer</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px">
      ${row('Name', esc(order.shipping_name))}
      ${row('Email', order.email ? `<a href="mailto:${esc(order.email)}" style="color:${INK}">${esc(order.email)}</a>` : '—')}
      ${row('Phone', order.shipping_phone ? `<a href="tel:${esc(String(order.shipping_phone).replace(/\s/g, ''))}" style="color:${INK}">${esc(order.shipping_phone)}</a>` : '—')}
      ${row('Delivery address', esc(address))}
      ${row('Payment', esc(PAYMENT[order.payment_method] || order.payment_method))}
      ${order.notes ? row('Notes', esc(order.notes)) : ''}
    </table>

    <h2 style="margin:0 0 6px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED}">Items</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <th align="left" style="padding:6px 0;border-bottom:2px solid ${LINE};font-size:12px;color:${MUTED};font-weight:600">Product</th>
        <th style="padding:6px 0;border-bottom:2px solid ${LINE};font-size:12px;color:${MUTED};font-weight:600">Qty</th>
        <th align="right" style="padding:6px 0;border-bottom:2px solid ${LINE};font-size:12px;color:${MUTED};font-weight:600">Price</th>
        <th align="right" style="padding:6px 0;border-bottom:2px solid ${LINE};font-size:12px;color:${MUTED};font-weight:600">Amount</th>
      </tr>
      ${lines}
      <tr><td colspan="4" style="height:10px"></td></tr>
      ${total('Subtotal', order.subtotal_cents)}
      ${order.discount_cents > 0 ? total('Discount cards', -order.discount_cents) : ''}
      ${total('Shipping', order.shipping_cents)}
      ${total('Total', order.total_cents, true)}
    </table>

    <p style="margin:28px 0 0;text-align:center">
      <a href="${esc(`${SITE}/admin/orders/${order.id}`)}" style="display:inline-block;background:${INK};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 26px;border-radius:999px">Open order in admin</a>
    </p>`;

  const text = [
    `New order ${num}`,
    when(order.created_at),
    '',
    `Customer: ${order.shipping_name}`,
    `Email: ${order.email || '-'}`,
    `Phone: ${order.shipping_phone || '-'}`,
    `Delivery address: ${address}`,
    `Payment: ${PAYMENT[order.payment_method] || order.payment_method}`,
    order.notes ? `Notes: ${order.notes}` : '',
    '',
    ...items.map((i) => `${i.quantity} x ${i.product_name} @ ${money(i.unit_price_cents, cur)} = ${money(i.unit_price_cents * i.quantity, cur)}`),
    '',
    `Subtotal: ${money(order.subtotal_cents, cur)}`,
    order.discount_cents > 0 ? `Discount cards: -${money(order.discount_cents, cur)}` : '',
    `Shipping: ${money(order.shipping_cents, cur)}`,
    `Total: ${money(order.total_cents, cur)}`,
    '',
    `${SITE}/admin/orders/${order.id}`,
  ].join('\n');

  return {
    subject: `New ${storeName} order ${num} · ${money(order.total_cents, cur)} · ${order.shipping_name}`,
    html: layout('New order', inner, storeName),
    text,
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
async function settings() {
  const [{ data: ns }, { data: store }] = await Promise.all([
    db.from('notification_settings').select('admin_email, order_emails_enabled').maybeSingle(),
    db.from('store_settings').select('store_name').maybeSingle(),
  ]);
  return { to: ns?.admin_email as string | null, enabled: ns?.order_emails_enabled !== false, storeName: (store?.store_name as string) || 'Blendy' };
}

async function sendOrder(orderId: string) {
  const { data: claimed, error: claimError } = await db.rpc('claim_order_email', { p_order: orderId });
  if (claimError) throw claimError;
  if (!claimed?.id) return json({ ok: true, skipped: 'not pending (already sent, sending, or not queued)' });

  let to: string | null = null;
  try {
    const s = await settings();
    to = s.to;
    if (!s.enabled) throw new Error('Order emails are turned off');
    if (!to) throw new Error('No admin email address is set');
    const { data: order, error } = await db.from('orders').select('*').eq('id', orderId).single();
    if (error) throw error;
    const { data: items, error: itemsError } = await db.from('order_items')
      .select('product_name, unit_price_cents, quantity').eq('order_id', orderId).order('product_name');
    if (itemsError) throw itemsError;
    const mail = orderEmail(order, items || [], s.storeName);
    await sendEmail(to, mail.subject, mail.html, mail.text);
    await db.rpc('finish_order_email', { p_order: orderId, p_ok: true, p_recipient: to });
    return json({ ok: true, sent: to });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.rpc('finish_order_email', { p_order: orderId, p_ok: false, p_recipient: to, p_error: message });
    console.error('order email failed', orderId, message);
    return json({ ok: false, error: message }, 500);
  }
}

async function sendTest(req: Request) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return json({ ok: false, error: 'Please sign in as an admin' }, 401);
  const { data: profile } = await db.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (profile?.role !== 'admin') return json({ ok: false, error: 'Admins only' }, 403);

  const s = await settings();
  if (!s.to) return json({ ok: false, error: 'Set the admin notification email first' }, 400);
  const inner = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700">Order emails are working</h1>
    <p style="margin:0;font-size:14px;line-height:1.6">This is a test from your ${esc(s.storeName)} admin panel. From now on, every new order will be emailed to <strong>${esc(s.to)}</strong>.</p>`;
  try {
    await sendEmail(s.to, `${s.storeName}: test order notification`, layout('Test', inner, s.storeName),
      `Order emails are working. Every new order will be emailed to ${s.to}.`);
    return json({ ok: true, sent: s.to });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);
  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* empty body */ }
  try {
    if (body?.test === true) return await sendTest(req);
    if (typeof body?.order_id === 'string' && UUID.test(body.order_id)) return await sendOrder(body.order_id);
    return json({ ok: false, error: 'Send {"order_id": "<uuid>"}' }, 400);
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
