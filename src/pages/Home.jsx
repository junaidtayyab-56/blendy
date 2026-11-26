import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { startHero } from '../heroEngine.js';
import { F } from '../flavours.js';
import { supabase } from '../supabase.js';
import { useAuth } from '../store/auth.jsx';
import { useCart } from '../store/cart.jsx';
import usePageTitle from '../components/usePageTitle.js';

// The original Blendy hero. The slides are the products ticked "Show on homepage" in the
// admin; the four original flavours keep their hand-made art, other products use their photo.
const MAX_SLIDES = 6;
const ORIGINAL = F.map((f) => ({ ...f, slug: f.name.toLowerCase() }));
const toSlide = (p) => {
  const art = F.find((f) => f.name.toLowerCase() === p.slug);
  return art ? { ...art, slug: p.slug } : { name: p.name, slug: p.slug, bg: p.bg_color || '#C2B0DC', image: p.image_url, fruit: p.hero_fruit_url };
};

function useHomeSlides() {
  const [list, setList] = useState(null);
  useEffect(() => {
    let done = false;
    const finish = (l) => { if (!done) { done = true; setList(l && l.length ? l : ORIGINAL); } };
    const t = setTimeout(() => finish(ORIGINAL), 2500);
    if (!supabase) finish(ORIGINAL);
    else supabase.from('products').select('slug, name, bg_color, image_url, hero_fruit_url')
      .eq('active', true).eq('show_on_home', true).order('sort_order').order('name').limit(MAX_SLIDES)
      .then(({ data, error }) => { if (error) console.error(error); finish((data || []).map(toSlide)); }, () => finish(ORIGINAL));
    return () => { done = true; clearTimeout(t); };
  }, []);
  return list;
}

export default function Home() {
  usePageTitle('');
  const list = useHomeSlides();
  const stageRef = useRef(null);
  const tabsRef = useRef(null);
  const ulRef = useRef(null);
  const prevRef = useRef(null);
  const nextRef = useRef(null);
  const heroRef = useRef(null);
  const [current, setCurrent] = useState(0);
  const { user } = useAuth();
  const { count } = useCart();
  const navigate = useNavigate();

  useEffect(() => {
    document.documentElement.classList.add('is-home');
    return () => document.documentElement.classList.remove('is-home');
  }, []);

  useEffect(() => {
    if (!list) return undefined;
    const hero = startHero({
      list,
      stage: stageRef.current,
      tabsEl: tabsRef.current,
      ul: ulRef.current,
      prevBtn: prevRef.current,
      nextBtn: nextRef.current,
      isPaused: () => false,
      onChange: setCurrent,
    });
    heroRef.current = hero;
    return () => hero.destroy();
  }, [list]);

  const slug = (list || ORIGINAL)[current]?.slug || 'berry';

  const onShop = (e) => {
    e.preventDefault();
    heroRef.current?.act();
    navigate(`/product/${slug}`);
  };

  return (
    <>
      <main className="stage" id="stage" aria-live="polite" ref={stageRef} />
      <div className="ui">
        <header className="hdr">
          <Link className="logo rise" to="/" aria-label="Blendy home" onClick={(e) => { e.preventDefault(); heroRef.current?.act(); }}>Blendy</Link>
          <nav className={'tabs rise' + ((list || ORIGINAL).length > 4 ? ' many' : '')} id="tabs" aria-label="Flavours" ref={tabsRef}>
            {(list || ORIGINAL).map((f) => <button type="button" key={f.slug}>{f.name}</button>)}
            <span className="ul" id="ul" aria-hidden="true" ref={ulRef} />
          </nav>
          <div className="acct rise">
            <Link to="/shop">Shop</Link>
            <span className="sep" aria-hidden="true">|</span>
            <Link to="/cart">{count > 0 ? `Cart (${count})` : 'Cart'}</Link>
            <span className="sep" aria-hidden="true">|</span>
            <Link to={user ? '/account' : '/register'}>{user ? 'Account' : 'Register'}</Link>
          </div>
        </header>
        <button className="arrow prev rise" id="prev" type="button" aria-label="Previous flavour" ref={prevRef}>
          <svg viewBox="0 0 28 28" aria-hidden="true"><path d="M24 14H4 M12 6l-8 8 8 8" /></svg>
        </button>
        <a className="shop rise" href={`/product/${slug}`} onClick={onShop}>SHOP NOW</a>
        <button className="arrow next rise" id="next" type="button" aria-label="Next flavour" ref={nextRef}>
          <svg viewBox="0 0 28 28" aria-hidden="true"><path d="M4 14h20 M16 6l8 8-8 8" /></svg>
        </button>
      </div>
    </>
  );
}
