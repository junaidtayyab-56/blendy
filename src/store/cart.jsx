import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase.js';
import { useAuth } from './auth.jsx';

// Signed-in carts live in Supabase (cart_items). Guests keep a small cart in this
// browser, which is moved into their account as soon as they log in.
const KEY = 'blendy-guest-cart';
const PRODUCT_FIELDS = 'id, slug, name, price_cents, compare_at_price_cents, currency, image_url, bg_color, bg_image_url, stock, active, size_ml';
const CartCtx = createContext(null);

const readGuest = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const writeGuest = (c) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage full or blocked */ } };

export function CartProvider({ children }) {
  const { user } = useAuth();
  const userId = user?.id;
  const [items, setItems] = useState([]); // [{ key, product, quantity }]
  const [loading, setLoading] = useState(true);
  const merging = useRef(false);

  const load = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    if (userId) {
      const { data, error } = await supabase.from('cart_items').select(`id, quantity, product:products(${PRODUCT_FIELDS})`).order('created_at');
      if (error) console.error('[Blendy] cart', error);
      setItems((data || []).filter((r) => r.product).map((r) => ({ key: r.id, quantity: r.quantity, product: r.product })));
    } else {
      const g = readGuest();
      const ids = Object.keys(g);
      if (!ids.length) { setItems([]); setLoading(false); return; }
      const { data, error } = await supabase.from('products').select(PRODUCT_FIELDS).in('id', ids);
      if (error) console.error('[Blendy] guest cart', error);
      const known = new Set((data || []).map((p) => p.id));
      for (const id of ids) if (!known.has(id)) delete g[id];
      writeGuest(g);
      setItems((data || []).filter((p) => g[p.id]).map((p) => ({ key: p.id, quantity: g[p.id], product: p })));
    }
    setLoading(false);
  }, [userId]);

  // Move a guest cart into the account after login.
  useEffect(() => {
    (async () => {
      if (userId && !merging.current) {
        const g = readGuest();
        const entries = Object.entries(g);
        if (entries.length) {
          merging.current = true;
          for (const [pid, q] of entries) {
            const { error } = await supabase.rpc('add_to_cart', { p_product_id: pid, p_quantity: q });
            if (error) console.warn('[Blendy] could not move item to account cart', error.message);
          }
          writeGuest({});
          merging.current = false;
        }
      }
      load();
    })();
  }, [userId, load]);

  const add = useCallback(async (product, quantity = 1) => {
    if (!supabase) throw new Error('The shop is not connected yet.');
    if (userId) {
      const { error } = await supabase.rpc('add_to_cart', { p_product_id: product.id, p_quantity: quantity });
      if (error) throw new Error(error.message);
    } else {
      const g = readGuest();
      const next = (g[product.id] || 0) + quantity;
      if (product.stock != null && next > product.stock) throw new Error(`Only ${product.stock} left in stock`);
      g[product.id] = Math.min(99, next);
      writeGuest(g);
    }
    await load();
  }, [userId, load]);

  const setQuantity = useCallback(async (item, q) => {
    if (userId) {
      const { error } = q <= 0
        ? await supabase.from('cart_items').delete().eq('id', item.key)
        : await supabase.from('cart_items').update({ quantity: Math.min(q, 99) }).eq('id', item.key);
      if (error) throw new Error(error.message);
    } else {
      const g = readGuest();
      if (q <= 0) delete g[item.product.id]; else g[item.product.id] = Math.min(q, 99);
      writeGuest(g);
    }
    await load();
  }, [userId, load]);

  const count = items.reduce((n, i) => n + i.quantity, 0);
  const subtotal = items.reduce((n, i) => n + i.quantity * i.product.price_cents, 0);

  return (
    <CartCtx.Provider value={{ items, count, subtotal, loading, add, setQuantity, reload: load }}>
      {children}
    </CartCtx.Provider>
  );
}

export const useCart = () => useContext(CartCtx);
