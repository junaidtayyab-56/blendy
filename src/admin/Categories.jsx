import { useEffect, useState } from 'react';
import { supabase } from '../supabase.js';
import { useToast } from '../store/toast.jsx';
import { slugify } from './util.js';

const BLANK = { name: '', slug: '', description: '', sort_order: '0', active: true };

export default function Categories() {
  const flash = useToast();
  const [cats, setCats] = useState(null);
  const [edit, setEdit] = useState(null); // null | 'new' | id
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error } = await supabase.from('categories').select('*, products(count)').order('sort_order').order('name');
    if (error) console.error(error);
    setCats(data || []);
  }
  useEffect(() => { load(); }, []);

  function start(c) {
    setEdit(c ? c.id : 'new');
    setForm(c ? { name: c.name, slug: c.slug, description: c.description || '', sort_order: String(c.sort_order), active: c.active } : BLANK);
  }

  async function save(e) {
    e.preventDefault();
    const row = { name: form.name.trim(), slug: slugify(form.slug || form.name), description: form.description.trim() || null, sort_order: parseInt(form.sort_order, 10) || 0, active: form.active };
    if (!row.name) return flash('Name is required');
    setBusy(true);
    const { error } = edit === 'new' ? await supabase.from('categories').insert(row) : await supabase.from('categories').update(row).eq('id', edit);
    setBusy(false);
    if (error) return flash(error.code === '23505' ? 'That slug is already used.' : error.message);
    flash('Category saved'); setEdit(null); load();
  }

  async function remove(c) {
    if (!window.confirm(`Delete the category "${c.name}"? Its products stay in the store without a category.`)) return;
    const { error } = await supabase.from('categories').delete().eq('id', c.id);
    if (error) flash(error.message); else { flash('Category deleted'); load(); }
  }

  const formEl = (
    <form className="bx-card bx-inline-form" onSubmit={save}>
      <h2>{edit === 'new' ? 'New category' : 'Edit category'}</h2>
      <div className="b-form-grid">
        <label className="b-field"><span>Name</span><input required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: edit === 'new' ? slugify(e.target.value) : form.slug })} /></label>
        <label className="b-field"><span>Slug</span><input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></label>
        <label className="b-field b-span2"><span>Description</span><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <label className="b-field"><span>Sort order</span><input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} /></label>
        <label className="b-check bx-check-mid"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Visible in store</label>
      </div>
      <div className="b-actions-row"><button className="b-btn" disabled={busy}>Save</button><button type="button" className="b-btn b-btn-ghost" onClick={() => setEdit(null)}>Cancel</button></div>
    </form>
  );

  return (
    <div>
      <div className="bx-head"><h1>Categories</h1>{edit === null && <button className="b-btn" type="button" onClick={() => start(null)}>+ Add category</button>}</div>
      {edit !== null && formEl}
      <div className="bx-card bx-flush">
        {cats === null ? <div className="bx-loading">Loading…</div> : cats.length === 0 ? <p className="bx-empty">No categories yet.</p> : (
          <table className="bx-table bx-table-stack">
            <thead><tr><th>Name</th><th>Slug</th><th className="r">Products</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {cats.map((c) => (
                <tr key={c.id}>
                  <td data-l="Name"><strong>{c.name}</strong>{c.description && <><br /><small className="b-muted">{c.description}</small></>}</td>
                  <td data-l="Slug">{c.slug}</td>
                  <td data-l="Products" className="r">{c.products?.[0]?.count ?? 0}</td>
                  <td data-l="Status">{c.active ? <span className="bx-chip ok">Visible</span> : <span className="bx-chip">Hidden</span>}</td>
                  <td className="r bx-row-actions"><button type="button" onClick={() => start(c)}>Edit</button><button type="button" className="bx-danger" onClick={() => remove(c)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
