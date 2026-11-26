import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase.js';
import ProductArt from '../components/ProductArt.jsx';
import { useToast } from '../store/toast.jsx';

export default function Inventory() {
  const flash = useToast();
  const [rows, setRows] = useState(null);
  const [draft, setDraft] = useState({});
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error } = await supabase.from('products').select('id, slug, name, sku, stock, active, image_url, bg_color').order('stock').order('name');
    if (error) console.error(error);
    setRows(data || []); setDraft({});
  }
  useEffect(() => { load(); }, []);

  const changed = Object.entries(draft).filter(([id, v]) => rows?.find((r) => r.id === id)?.stock !== v);

  async function saveAll() {
    if (changed.some(([, v]) => !Number.isInteger(v) || v < 0)) return flash('Stock must be a whole number, 0 or more');
    setBusy(true);
    for (const [id, stock] of changed) {
      const { error } = await supabase.from('products').update({ stock }).eq('id', id);
      if (error) { flash(error.message); setBusy(false); return; }
    }
    setBusy(false);
    flash(`Stock updated for ${changed.length} product${changed.length > 1 ? 's' : ''}`);
    load();
  }

  const shown = (rows || []).filter((r) => filter === 'all' || (filter === 'low' ? r.stock > 0 && r.stock <= 10 : r.stock === 0));
  const val = (r) => (draft[r.id] ?? r.stock);
  const setVal = (r, v) => setDraft((d) => ({ ...d, [r.id]: v }));

  return (
    <div>
      <div className="ad-head"><h1>Inventory</h1><button className="b-btn" type="button" disabled={!changed.length || busy} onClick={saveAll}>{busy ? 'Saving…' : changed.length ? `Save ${changed.length} change${changed.length > 1 ? 's' : ''}` : 'No changes'}</button></div>
      <div className="ad-toolbar">
        <div className="b-chips">
          {[['all', 'All'], ['low', 'Low stock (1–10)'], ['out', 'Out of stock']].map(([k, l]) => <button type="button" key={k} aria-selected={filter === k} onClick={() => setFilter(k)}>{l}</button>)}
        </div>
      </div>
      <div className="ad-card ad-flush">
        {rows === null ? <div className="ad-loading">Loading…</div> : shown.length === 0 ? <p className="ad-empty">Nothing here.</p> : (
          <table className="ad-table ad-table-stack">
            <thead><tr><th></th><th>Product</th><th>SKU</th><th>In stock</th><th>Adjust</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={draft[r.id] !== undefined && draft[r.id] !== r.stock ? 'ad-dirty' : ''}>
                  <td className="ad-thumb-cell"><ProductArt product={r} size="xs" /></td>
                  <td data-l="Product"><Link to={`/admin/products/${r.id}`}>{r.name}</Link>{!r.active && <span className="ad-chip">Hidden</span>}</td>
                  <td data-l="SKU">{r.sku || '—'}</td>
                  <td data-l="In stock" className={r.stock === 0 ? 'b-out' : r.stock <= 10 ? 'ad-warn' : ''}>{r.stock}</td>
                  <td data-l="Adjust">
                    <div className="ad-adjust">
                      <button type="button" onClick={() => setVal(r, Math.max(0, val(r) - 1))} aria-label="Remove one">−</button>
                      <input type="number" min="0" value={val(r)} onChange={(e) => setVal(r, e.target.value === '' ? 0 : parseInt(e.target.value, 10))} aria-label={`Stock for ${r.name}`} />
                      <button type="button" onClick={() => setVal(r, val(r) + 1)} aria-label="Add one">+</button>
                      <button type="button" className="ad-plus10" onClick={() => setVal(r, val(r) + 10)}>+10</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
