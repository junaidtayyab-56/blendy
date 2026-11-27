import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase.js';
import { useAuth } from '../store/auth.jsx';

const LIMIT = 30;

function ago(d) {
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// Newest first, one entry per id (a realtime event and a refetch can deliver the same row).
const merge = (list, rows) => {
  const byId = new Map(list.map((n) => [n.id, n]));
  rows.forEach((r) => byId.set(r.id, { ...byId.get(r.id), ...r }));
  return [...byId.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, LIMIT);
};

export default function NotificationBell() {
  const { user } = useAuth();
  const uid = user?.id;
  const navigate = useNavigate();
  const [items, setItems] = useState(null); // null = loading
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrap = useRef(null);

  const load = useCallback(async () => {
    if (!supabase || !uid) return;
    const { data, error } = await supabase.from('notifications')
      .select('id, kind, title, body, link, card_id, read_at, created_at')
      .eq('user_id', uid).order('created_at', { ascending: false }).limit(LIMIT);
    if (error) { setError('Could not load notifications.'); setItems((l) => l || []); return; }
    setError('');
    setItems(data || []);
  }, [uid]);

  // First load, live updates, and a refresh when the tab comes back into view.
  useEffect(() => {
    if (!supabase || !uid) { setItems(null); return undefined; }
    load();
    const channel = supabase.channel(`notifications:${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, (p) => {
        if (p.eventType === 'DELETE') setItems((l) => (l || []).filter((n) => n.id !== p.old?.id));
        else if (p.new?.id) setItems((l) => merge(l || [], [p.new]));
      })
      .subscribe((status) => { if (status === 'SUBSCRIBED') load(); });
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); supabase.removeChannel(channel); };
  }, [uid, load]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!uid) return null;

  const list = items || [];
  const unread = list.filter((n) => !n.read_at).length;

  async function markRead(ids) {
    const now = new Date().toISOString();
    setItems((l) => (l || []).map((n) => (!n.read_at && (!ids || ids.includes(n.id)) ? { ...n, read_at: now } : n)));
    const { error } = await supabase.rpc('mark_notifications_read', { p_ids: ids });
    if (error) { setError('Could not update. Please try again.'); load(); }
  }

  async function openItem(n) {
    setOpen(false);
    if (!n.read_at) markRead([n.id]);
    if (n.link) navigate(n.link);
  }

  async function markAll() {
    setBusy(true);
    await markRead(null);
    setBusy(false);
  }

  return (
    <div className="b-notif" ref={wrap}>
      <button type="button" className={'b-icon-link b-notif-btn' + (open ? ' active' : '')} aria-haspopup="true" aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} onClick={() => { setOpen((o) => !o); if (!open) load(); }}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
        {unread > 0 && <b className="b-badge">{unread > 9 ? '9+' : unread}</b>}
      </button>
      {open && (
        <div className="b-notif-panel" role="dialog" aria-label="Notifications">
          <div className="b-notif-head">
            <strong>Notifications</strong>
            {unread > 0 && <button type="button" className="b-link-btn" onClick={markAll} disabled={busy}>Mark all as read</button>}
          </div>
          {error && <p className="b-notif-error" role="alert">{error} <button type="button" className="b-link-btn" onClick={load}>Retry</button></p>}
          {items === null ? (
            <div className="b-notif-empty">Loading…</div>
          ) : list.length === 0 ? (
            <div className="b-notif-empty">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
              <p>No notifications yet.</p>
              <small>We'll let you know when you get a discount card.</small>
            </div>
          ) : (
            <ul className="b-notif-list">
              {list.map((n) => (
                <li key={n.id}>
                  <button type="button" className={'b-notif-item' + (n.read_at ? '' : ' unread')} onClick={() => openItem(n)}>
                    <span className="b-notif-ico" aria-hidden="true">
                      <svg viewBox="0 0 24 24"><path d="M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z" /><path d="M9 9h.01M15 15h.01M15.5 8.5l-7 7" /></svg>
                    </span>
                    <span className="b-notif-text">
                      <strong>{n.title}</strong>
                      <span>{n.body}</span>
                      <small>{ago(n.created_at)}{n.read_at ? '' : ' · New'}</small>
                    </span>
                    {!n.read_at && <i className="b-notif-dot" aria-hidden="true" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
