import { useCallback, useEffect, useRef, useState } from 'react';
import { startHero } from './heroEngine.js';
import { F } from './flavours.js';
import { supabase, supabaseConfigured } from './supabase.js';
import AuthPanel from './AuthPanel.jsx';
import CartPanel from './CartPanel.jsx';

let toastTimer;

export default function App() {
  const stageRef = useRef(null);
  const tabsRef = useRef(null);
  const ulRef = useRef(null);
  const prevRef = useRef(null);
  const nextRef = useRef(null);
  const heroRef = useRef(null);
  const panelRef = useRef(null);

  const [current, setCurrent] = useState(0);
  const [session, setSession] = useState(null);
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [panel, setPanel] = useState(null); // null | {type:'auth', mode, note} | {type:'cart'}
  const [pendingAdd, setPendingAdd] = useState(null);
  const [toast, setToast] = useState('');

  panelRef.current = panel;

  // Mount the original hero animation engine once.
  useEffect(() => {
    const hero = startHero({
      stage: stageRef.current,
      tabsEl: tabsRef.current,
      ul: ulRef.current,
      prevBtn: prevRef.current,
      nextBtn: nextRef.current,
      isPaused: () => panelRef.current !== null,
      onChange: setCurrent,
    });
    heroRef.current = hero;
    return () => hero.destroy();
  }, []);

  // Auth session.
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setPanel({ type: 'auth', mode: 'recover' });
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Products (public, read-only).
  useEffect(() => {
    if (!supabase) return;
    supabase
      .from('products')
      .select('id, slug, name, description, price_cents, currency')
      .eq('active', true)
      .order('sort_order')
      .then(({ data, error }) => {
        if (error) console.error('[Blendy] products', error);
        else setProducts(data);
      });
  }, []);

  const userId = session?.user?.id;

  const loadCart = useCallback(async () => {
    if (!supabase || !userId) { setCart([]); return; }
    const { data, error } = await supabase
      .from('cart_items')
      .select('id, quantity, product:products(id, slug, name, price_cents, currency)')
      .order('created_at');
    if (error) console.error('[Blendy] cart', error);
    else setCart(data);
  }, [userId]);

  useEffect(() => { loadCart(); }, [loadCart]);

  const flash = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setToast(''), 2600);
  }, []);

  const addToCart = useCallback(async (slug) => {
    const product = products.find((p) => p.slug === slug);
    if (!product) { flash('This flavour is not available right now.'); return false; }
    const { error } = await supabase.rpc('add_to_cart', { p_product_id: product.id, p_quantity: 1 });
    if (error) { console.error('[Blendy] add_to_cart', error); flash('Could not add to cart. Please try again.'); return false; }
    await loadCart();
    flash(`${product.name} smoothie added to your cart`);
    return true;
  }, [products, loadCart, flash]);

  // Finish an add that was waiting for sign-in.
  useEffect(() => {
    if (userId && pendingAdd && products.length) {
      const slug = pendingAdd;
      setPendingAdd(null);
      addToCart(slug);
    }
  }, [userId, pendingAdd, products, addToCart]);

  const onShop = (e) => {
    e.preventDefault();
    heroRef.current?.act();
    if (!supabaseConfigured) { flash('The shop is not connected yet.'); return; }
    const slug = F[current].name.toLowerCase();
    if (!userId) {
      setPendingAdd(slug);
      setPanel({ type: 'auth', mode: 'signup', note: `Create an account or log in to add ${F[current].name} to your cart.` });
      return;
    }
    addToCart(slug);
  };

  const onCart = (e) => {
    e.preventDefault();
    heroRef.current?.act();
    if (!userId) { setPanel({ type: 'auth', mode: 'login', note: 'Log in to see your cart.' }); return; }
    setPanel({ type: 'cart' });
  };

  const onAccount = async (e) => {
    e.preventDefault();
    heroRef.current?.act();
    if (userId) {
      await supabase.auth.signOut();
      setPendingAdd(null);
      flash('You are logged out');
    } else {
      setPanel({ type: 'auth', mode: 'signup' });
    }
  };

  const closePanel = () => { setPanel(null); setPendingAdd(null); };
  const count = cart.reduce((n, i) => n + i.quantity, 0);
  const accent = F[current].bg;

  return (
    <>
      <main className="stage" id="stage" aria-live="polite" ref={stageRef} />

      <div className="ui">
        <header className="hdr">
          <a className="logo rise" href="/" aria-label="Blendy home" onClick={(e) => { e.preventDefault(); heroRef.current?.act(); }}>Blendy</a>
          <nav className="tabs rise" id="tabs" aria-label="Flavours" ref={tabsRef}>
            {F.map((f) => <button type="button" key={f.name}>{f.name}</button>)}
            <span className="ul" id="ul" aria-hidden="true" ref={ulRef} />
          </nav>
          <div className="acct rise">
            <a href="#cart" onClick={onCart}>{count > 0 ? `Cart (${count})` : 'Cart'}</a>
            <span className="sep" aria-hidden="true">|</span>
            <a href="#account" onClick={onAccount}>{userId ? 'Log out' : 'Register'}</a>
          </div>
        </header>
        <button className="arrow prev rise" id="prev" type="button" aria-label="Previous flavour" ref={prevRef}>
          <svg viewBox="0 0 28 28" aria-hidden="true"><path d="M24 14H4 M12 6l-8 8 8 8" /></svg>
        </button>
        <a className="shop rise" href="#shop" onClick={onShop}>SHOP NOW</a>
        <button className="arrow next rise" id="next" type="button" aria-label="Next flavour" ref={nextRef}>
          <svg viewBox="0 0 28 28" aria-hidden="true"><path d="M4 14h20 M16 6l8 8-8 8" /></svg>
        </button>
      </div>

      {panel?.type === 'auth' && (
        <AuthPanel
          initialMode={panel.mode}
          note={panel.note}
          accent={accent}
          onClose={closePanel}
          onDone={(msg) => { setPanel(null); if (msg) flash(msg); }}
        />
      )}
      {panel?.type === 'cart' && (
        <CartPanel
          cart={cart}
          user={session?.user}
          accent={accent}
          reload={loadCart}
          onClose={closePanel}
          flash={flash}
        />
      )}

      <div className={'toast' + (toast ? ' show' : '')} role="status" aria-live="polite">{toast}</div>
    </>
  );
}
