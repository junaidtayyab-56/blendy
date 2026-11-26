import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../supabase.js';
import ProductCard from '../components/ProductCard.jsx';
import usePageTitle from '../components/usePageTitle.js';

export const PRODUCT_LIST_FIELDS = 'id, slug, name, description, price_cents, compare_at_price_cents, currency, image_url, bg_color, stock, featured, size_ml, sort_order, created_at, category:categories(id, name, slug)';

const SORTS = {
  featured: (a, b) => (b.featured - a.featured) || (a.sort_order - b.sort_order),
  'price-asc': (a, b) => a.price_cents - b.price_cents,
  'price-desc': (a, b) => b.price_cents - a.price_cents,
  name: (a, b) => a.name.localeCompare(b.name),
  newest: (a, b) => new Date(b.created_at) - new Date(a.created_at),
};

export default function Shop() {
  usePageTitle('Shop');
  const [params, setParams] = useSearchParams();
  const [products, setProducts] = useState(null);
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState('');
  const cat = params.get('category') || '';
  const q = params.get('q') || '';
  const sort = params.get('sort') || 'featured';
  const inStock = params.get('stock') === '1';
  const [query, setQuery] = useState(q);

  useEffect(() => {
    if (!supabase) { setError('The shop is not connected yet.'); return; }
    Promise.all([
      supabase.from('products').select(PRODUCT_LIST_FIELDS).eq('active', true),
      supabase.from('categories').select('id, name, slug').eq('active', true).order('sort_order'),
    ]).then(([p, c]) => {
      if (p.error) { setError('Could not load products. Please refresh.'); console.error(p.error); }
      setProducts(p.data || []);
      setCategories(c.data || []);
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => update({ q: query.trim() }), 250);
    return () => clearTimeout(t);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  function update(patch) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    setParams(next, { replace: true });
  }

  const shown = useMemo(() => {
    if (!products) return [];
    const needle = q.toLowerCase();
    return products
      .filter((p) => !cat || p.category?.slug === cat)
      .filter((p) => !needle || p.name.toLowerCase().includes(needle) || (p.description || '').toLowerCase().includes(needle))
      .filter((p) => !inStock || p.stock > 0)
      .sort(SORTS[sort] || SORTS.featured);
  }, [products, cat, q, sort, inStock]);

  return (
    <div className="b-wrap b-page">
      <div className="b-page-head">
        <h1>Shop smoothies</h1>
        <p className="b-muted">Blended from real fruit. Pick your flavour.</p>
      </div>
      <div className="b-filters">
        <div className="b-chips" role="tablist" aria-label="Categories">
          <button type="button" role="tab" aria-selected={!cat} onClick={() => update({ category: '' })}>All</button>
          {categories.map((c) => (
            <button type="button" role="tab" key={c.id} aria-selected={cat === c.slug} onClick={() => update({ category: c.slug })}>{c.name}</button>
          ))}
        </div>
        <div className="b-filter-row">
          <label className="b-search">
            <span className="b-sr">Search products</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
            <input type="search" placeholder="Search smoothies" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <label className="b-check">
            <input type="checkbox" checked={inStock} onChange={(e) => update({ stock: e.target.checked ? '1' : '' })} /> In stock only
          </label>
          <label className="b-select">
            <span className="b-sr">Sort by</span>
            <select value={sort} onChange={(e) => update({ sort: e.target.value === 'featured' ? '' : e.target.value })}>
              <option value="featured">Featured</option>
              <option value="newest">Newest</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>
      </div>
      {error && <p className="b-error">{error}</p>}
      {!products && !error && <div className="b-grid">{[0, 1, 2, 3].map((i) => <div key={i} className="b-card b-skel" />)}</div>}
      {products && (shown.length ? (
        <>
          <p className="b-muted b-count">{shown.length} {shown.length === 1 ? 'product' : 'products'}</p>
          <div className="b-grid">{shown.map((p) => <ProductCard key={p.id} product={p} />)}</div>
        </>
      ) : (
        <div className="b-empty">
          <p>No smoothies match your search.</p>
          <button type="button" className="b-btn b-btn-ghost" onClick={() => { setQuery(''); setParams({}, { replace: true }); }}>Clear filters</button>
        </div>
      ))}
    </div>
  );
}
