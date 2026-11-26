import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { startHero } from '../heroEngine.js';
import { F } from '../flavours.js';
import { useAuth } from '../store/auth.jsx';
import { useCart } from '../store/cart.jsx';
import usePageTitle from '../components/usePageTitle.js';

// The original Blendy hero, unchanged. Only the header links now lead into the shop.
export default function Home() {
  usePageTitle('');
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
    const hero = startHero({
      stage: stageRef.current,
      tabsEl: tabsRef.current,
      ul: ulRef.current,
      prevBtn: prevRef.current,
      nextBtn: nextRef.current,
      isPaused: () => false,
      onChange: setCurrent,
    });
    heroRef.current = hero;
    return () => { hero.destroy(); document.documentElement.classList.remove('is-home'); };
  }, []);

  const onShop = (e) => {
    e.preventDefault();
    heroRef.current?.act();
    navigate(`/product/${F[current].name.toLowerCase()}`);
  };

  return (
    <>
      <main className="stage" id="stage" aria-live="polite" ref={stageRef} />
      <div className="ui">
        <header className="hdr">
          <Link className="logo rise" to="/" aria-label="Blendy home" onClick={(e) => { e.preventDefault(); heroRef.current?.act(); }}>Blendy</Link>
          <nav className="tabs rise" id="tabs" aria-label="Flavours" ref={tabsRef}>
            {F.map((f) => <button type="button" key={f.name}>{f.name}</button>)}
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
        <a className="shop rise" href={`/product/${F[current].name.toLowerCase()}`} onClick={onShop}>SHOP NOW</a>
        <button className="arrow next rise" id="next" type="button" aria-label="Next flavour" ref={nextRef}>
          <svg viewBox="0 0 28 28" aria-hidden="true"><path d="M4 14h20 M16 6l8 8-8 8" /></svg>
        </button>
      </div>
    </>
  );
}
