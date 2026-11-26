import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../supabase.js';
import ProductArt from '../components/ProductArt.jsx';
import { useToast } from '../store/toast.jsx';
import { useSettings } from '../store/settings.jsx';
import { centsToInput, inputToCents, slugify } from './util.js';

export default function Products() {
  const [products, setProducts] = useState(null);
  const [q, setQ] = useState('');
  const { fmt } = useSettings();
  const flash = useToast();

  async function remove(p) {
    if (!window.confirm(`Delete "${p.name}"? It will be removed from the store and from carts. Past orders keep their line items. This cannot be undone.\n\nTip: untick "Show in store" on the product instead if you only want to hide it.`)) return;
    const { error } = await supabase.from('products').delete().eq('id', p.id);
    if (error) { flash(error.message); return; }
    setProducts((list) => list.filter((x) => x.id !== p.id));
    flash('Product deleted');
  }

  useEffect(() => {
    supabase.from('products').select('*, category:categories(name)').order('sort_order').order('name')
      .then(({ data, error }) => { if (error) console.error(error); setProducts(data || []); });
  }, []);

  const shown = useMemo(() => (products || []).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || (p.sku || '').toLowerCase().includes(q.toLowerCase())), [products, q]);

  return (
    <div>
      <div className="bx-head"><h1>Products</h1><Link className="b-btn" to="/admin/products/new">+ Add product</Link></div>
      <div className="bx-toolbar"><input className="bx-input" type="search" placeholder="Search name or SKU" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="bx-card bx-flush">
        {products === null ? <div className="bx-loading">Loading…</div> : shown.length === 0 ? <p className="bx-empty">No products yet.</p> : (
          <table className="bx-table bx-table-stack">
            <thead><tr><th></th><th>Product</th><th>Category</th><th className="r">Price</th><th className="r">Stock</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id}>
                  <td className="bx-thumb-cell"><ProductArt product={p} size="xs" /></td>
                  <td data-l="Product"><Link to={`/admin/products/${p.id}`}><strong>{p.name}</strong></Link><br /><small className="b-muted">{p.sku || p.slug}</small></td>
                  <td data-l="Category">{p.category?.name || '—'}</td>
                  <td data-l="Price" className="r">{fmt(p.price_cents)}</td>
                  <td data-l="Stock" className={'r' + (p.stock === 0 ? ' b-out' : p.stock <= 10 ? ' bx-warn' : '')}>{p.stock}</td>
                  <td data-l="Status">{p.active ? <span className="bx-chip ok">Active</span> : <span className="bx-chip">Hidden</span>}{p.show_on_home && <span className="bx-chip">Homepage</span>}{p.featured && <span className="bx-chip">Featured</span>}</td>
                  <td className="r bx-row-actions"><Link to={`/admin/products/${p.id}`}>Edit</Link><button type="button" className="bx-danger" onClick={() => remove(p)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const HERO_ART = ['berry', 'kiwi', 'banana', 'strawberry'];
const MAX_FRUITS = 4;

const EMPTY = { name: '', slug: '', description: '', ingredients: '', category_id: '', price: '', compare: '', stock: '0', sku: '', size_ml: '', bg_color: '#C2B0DC', image_url: '', featured: false, show_on_home: false, hero_fruits: [], active: true, sort_order: '0' };

export function ProductForm() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const flash = useToast();
  const [form, setForm] = useState(isNew ? EMPTY : null);
  const [cats, setCats] = useState([]);
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.from('categories').select('id, name').order('sort_order').then(({ data }) => setCats(data || []));
    if (!isNew) {
      supabase.from('products').select('*').eq('id', id).maybeSingle().then(({ data, error }) => {
        if (error || !data) { setError('Product not found'); return; }
        setForm({
          ...data, category_id: data.category_id || '', price: centsToInput(data.price_cents), compare: centsToInput(data.compare_at_price_cents),
          stock: String(data.stock), size_ml: data.size_ml ?? '', sku: data.sku || '', description: data.description || '', ingredients: data.ingredients || '',
          bg_color: data.bg_color || '#C2B0DC', image_url: data.image_url || '', hero_fruits: (data.hero_fruits && data.hero_fruits.length ? data.hero_fruits : (data.hero_fruit_url ? [data.hero_fruit_url] : [])), sort_order: String(data.sort_order ?? 0),
        });
      });
    }
  }, [id, isNew]);

  if (!form) return error ? <p className="b-error">{error}</p> : <div className="bx-loading">Loading…</div>;

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v, ...(k === 'name' && !slugTouched ? { slug: slugify(v) } : {}) }));
  };

  async function upload(e, field = 'image_url') {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { flash('Images must be under 5 MB'); return; }
    setUploading(true);
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${slugify(form.slug || form.name || 'product')}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('product-images').upload(path, file, { cacheControl: '31536000', contentType: file.type });
    setUploading(false);
    if (error) { flash(error.message); return; }
    const { data } = supabase.storage.from('product-images').getPublicUrl(path);
    setForm((f) => (field === 'hero_fruits' ? { ...f, hero_fruits: [...f.hero_fruits, data.publicUrl].slice(0, MAX_FRUITS) } : { ...f, [field]: data.publicUrl }));
    e.target.value = '';
    flash('Image uploaded. Save the product to keep it.');
  }

  async function save(e) {
    e.preventDefault();
    setError('');
    const price = inputToCents(form.price);
    const compare = inputToCents(form.compare);
    const stock = parseInt(form.stock, 10);
    if (!form.name.trim()) return setError('Name is required');
    if (!form.slug) return setError('URL slug is required');
    if (price == null || Number.isNaN(price)) return setError('Enter a valid price');
    if (Number.isNaN(compare)) return setError('Enter a valid compare-at price');
    if (!Number.isInteger(stock) || stock < 0) return setError('Stock must be 0 or more');
    const row = {
      name: form.name.trim(), slug: slugify(form.slug), description: form.description.trim() || null, ingredients: form.ingredients.trim() || null,
      category_id: form.category_id || null, price_cents: price, compare_at_price_cents: compare, stock, sku: form.sku.trim() || null,
      size_ml: form.size_ml === '' ? null : parseInt(form.size_ml, 10), bg_color: form.bg_color || null, image_url: form.image_url.trim() || null,
      featured: form.featured, show_on_home: form.show_on_home, hero_fruits: form.hero_fruits.slice(0, MAX_FRUITS), hero_fruit_url: form.hero_fruits[0] || null, active: form.active, sort_order: parseInt(form.sort_order, 10) || 0,
    };
    setBusy(true);
    const { data, error } = isNew ? await supabase.from('products').insert(row).select('id').single() : await supabase.from('products').update(row).eq('id', id).select('id').single();
    setBusy(false);
    if (error) { setError(error.code === '23505' ? 'That slug or SKU is already used by another product.' : error.message); return; }
    flash(isNew ? 'Product created' : 'Product saved');
    if (isNew) navigate(`/admin/products/${data.id}`, { replace: true });
  }

  async function remove() {
    if (!window.confirm(`Delete "${form.name}"? It will be removed from the store and from carts. Past orders keep their line items. This cannot be undone.`)) return;
    setBusy(true);
    const { error } = await supabase.from('products').delete().eq('id', id);
    setBusy(false);
    if (error) { flash(error.message); return; }
    flash('Product deleted');
    navigate('/admin/products', { replace: true });
  }

  const preview = { ...form, price_cents: inputToCents(form.price) || 0 };

  return (
    <form onSubmit={save}>
      <div className="bx-head">
        <div><Link to="/admin/products" className="bx-back">← Products</Link><h1>{isNew ? 'New product' : form.name || 'Product'}</h1></div>
        <div className="b-actions-row">
          {!isNew && <a className="b-btn b-btn-ghost" href={`/product/${form.slug}`} target="_blank" rel="noreferrer">View</a>}
          <button className="b-btn" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
      {error && <p className="b-error" role="alert">{error}</p>}
      <div className="bx-grid2 bx-grid-wide">
        <div className="bx-stack">
          <section className="bx-card">
            <h2>Details</h2>
            <div className="b-form-grid">
              <label className="b-field"><span>Name</span><input required value={form.name} onChange={set('name')} maxLength={120} /></label>
              <label className="b-field"><span>URL slug</span><input required value={form.slug} onChange={(e) => { setSlugTouched(true); set('slug')(e); }} maxLength={60} /></label>
              <label className="b-field b-span2"><span>Description</span><textarea rows={4} value={form.description} onChange={set('description')} maxLength={2000} /></label>
              <label className="b-field b-span2"><span>Ingredients</span><input value={form.ingredients} onChange={set('ingredients')} maxLength={300} /></label>
              <label className="b-field"><span>Category</span>
                <select value={form.category_id} onChange={set('category_id')}><option value="">No category</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              </label>
              <label className="b-field"><span>Size (ml)</span><input type="number" min="1" value={form.size_ml} onChange={set('size_ml')} /></label>
            </div>
          </section>
          <section className="bx-card">
            <h2>Pricing and inventory</h2>
            <div className="b-form-grid">
              <label className="b-field"><span>Price</span><input required inputMode="decimal" value={form.price} onChange={set('price')} placeholder="4.99" /></label>
              <label className="b-field"><span>Compare-at price (optional)</span><input inputMode="decimal" value={form.compare} onChange={set('compare')} placeholder="Original price for a sale" /></label>
              <label className="b-field"><span>Stock</span><input required type="number" min="0" value={form.stock} onChange={set('stock')} /></label>
              <label className="b-field"><span>SKU</span><input value={form.sku} onChange={set('sku')} maxLength={60} /></label>
            </div>
          </section>
        </div>
        <div className="bx-stack">
          <section className="bx-card">
            <h2>Image</h2>
            <ProductArt product={preview} size="md" />
            <label className="b-btn b-btn-ghost b-btn-block bx-upload">
              {uploading ? 'Uploading…' : 'Upload image'}
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" onChange={upload} disabled={uploading} hidden />
            </label>
            <label className="b-field"><span>Image URL</span><input value={form.image_url} onChange={set('image_url')} placeholder="Leave empty to use the Blendy bottle art" /></label>
            <label className="b-field"><span>Background colour</span><input type="color" value={form.bg_color || '#C2B0DC'} onChange={set('bg_color')} /></label>
          </section>
          {!HERO_ART.includes(form.slug) && (
            <section className="bx-card">
              <h2>Homepage fruit pictures</h2>
              <p className="b-muted bx-hint">Optional. Up to {MAX_FRUITS} different fruit pictures that float around the bottle in the homepage slider, like the original smoothies. PNGs with a transparent background look best.</p>
              {form.hero_fruits.length > 0 && (
                <div className="bx-fruits" style={{ background: form.bg_color || '#C2B0DC' }}>
                  {form.hero_fruits.map((url, i) => (
                    <div key={url + i} className="bx-fruit">
                      <img src={url} alt={`Fruit picture ${i + 1}`} />
                      <button type="button" aria-label={`Remove fruit picture ${i + 1}`} onClick={() => setForm((f) => ({ ...f, hero_fruits: f.hero_fruits.filter((_, j) => j !== i) }))}>×</button>
                    </div>
                  ))}
                </div>
              )}
              {form.hero_fruits.length < MAX_FRUITS && (
                <label className="b-btn b-btn-ghost b-btn-block bx-upload">
                  {uploading ? 'Uploading…' : form.hero_fruits.length ? 'Add another fruit picture' : 'Upload fruit picture'}
                  <input type="file" accept="image/png,image/webp,image/gif,image/avif,image/jpeg" onChange={(e) => upload(e, 'hero_fruits')} disabled={uploading} hidden />
                </label>
              )}
            </section>
          )}
          <section className="bx-card">
            <h2>Visibility</h2>
            <label className="b-check"><input type="checkbox" checked={form.active} onChange={set('active')} /> Show in store</label>
            <label className="b-check"><input type="checkbox" checked={form.show_on_home} onChange={set('show_on_home')} /> Show on homepage slider</label>
            {form.show_on_home && !form.image_url && !HERO_ART.includes(form.slug) && <p className="bx-tip">Add an image above so this product has a picture in the homepage slider.</p>}
            <p className="b-muted bx-hint">The slider shows up to 6 products, in sort order.</p>
            <label className="b-check"><input type="checkbox" checked={form.featured} onChange={set('featured')} /> Featured</label>
            <label className="b-field"><span>Sort order</span><input type="number" value={form.sort_order} onChange={set('sort_order')} /></label>
          </section>
          {!isNew && <button type="button" className="b-btn b-btn-danger b-btn-block" onClick={remove} disabled={busy}>Delete product</button>}
        </div>
      </div>
    </form>
  );
}
