import { useEffect, useState } from 'react';
import { supabase } from '../supabase.js';
import { useToast } from '../store/toast.jsx';
import { fmtDateTime } from './util.js';

export default function Messages() {
  const flash = useToast();
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('inbox');
  const [openId, setOpenId] = useState(null);

  async function load() {
    const { data, error } = await supabase.from('contact_messages').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) flash(error.message);
    setRows(data || []);
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function setStatus(m, status) {
    const { error } = await supabase.from('contact_messages').update({ status }).eq('id', m.id);
    if (error) flash(error.message); else setRows((rs) => rs.map((r) => (r.id === m.id ? { ...r, status } : r)));
  }
  async function remove(m) {
    if (!window.confirm('Delete this message? This cannot be undone.')) return;
    const { error } = await supabase.from('contact_messages').delete().eq('id', m.id);
    if (error) flash(error.message); else setRows((rs) => rs.filter((r) => r.id !== m.id));
  }
  function open(m) {
    setOpenId(openId === m.id ? null : m.id);
    if (m.status === 'new') setStatus(m, 'read');
  }

  const shown = (rows || []).filter((r) => (filter === 'inbox' ? r.status !== 'archived' : r.status === 'archived'));

  return (
    <div>
      <div className="ad-head"><h1>Messages</h1></div>
      <div className="ad-toolbar"><div className="b-chips">
        <button type="button" aria-selected={filter === 'inbox'} onClick={() => setFilter('inbox')}>Inbox</button>
        <button type="button" aria-selected={filter === 'archived'} onClick={() => setFilter('archived')}>Archived</button>
      </div></div>
      <div className="ad-card ad-flush">
        {rows === null ? <div className="ad-loading">Loading…</div> : shown.length === 0 ? <p className="ad-empty">No messages.</p> : (
          <ul className="ad-msgs">
            {shown.map((m) => (
              <li key={m.id} className={m.status === 'new' ? 'new' : ''}>
                <button type="button" className="ad-msg-head" onClick={() => open(m)} aria-expanded={openId === m.id}>
                  <span><strong>{m.name}</strong> <span className="b-muted">{m.email}</span></span>
                  <span className="ad-msg-sub">{m.subject || m.message.slice(0, 80)}</span>
                  <small className="b-muted">{fmtDateTime(m.created_at)}</small>
                </button>
                {openId === m.id && (
                  <div className="ad-msg-body">
                    <p>{m.message}</p>
                    <div className="ad-row-actions">
                      <a href={`mailto:${m.email}?subject=${encodeURIComponent('Re: ' + (m.subject || 'Your message to Blendy'))}`}>Reply by email</a>
                      {m.status !== 'archived' ? <button type="button" onClick={() => setStatus(m, 'archived')}>Archive</button> : <button type="button" onClick={() => setStatus(m, 'read')}>Move to inbox</button>}
                      <button type="button" className="ad-danger" onClick={() => remove(m)}>Delete</button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
