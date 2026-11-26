import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../store/auth.jsx';
import { useCart } from '../store/cart.jsx';
import { useSettings } from '../store/settings.jsx';

const NAV = [
  ['/', 'Home'],
  ['/shop', 'Shop'],
  ['/about', 'About'],
  ['/contact', 'Contact'],
];

export default function SiteLayout() {
  const { user, isAdmin } = useAuth();
  const { count } = useCart();
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const loc = useLocation();

  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [loc.pathname]);

  return (
    <div className="b-site">
      {settings.announcement && <div className="b-announce">{settings.announcement}</div>}
      <header className="b-header">
        <div className="b-wrap b-header-in">
          <Link to="/" className="b-logo" aria-label="Blendy home">{settings.store_name || 'Blendy'}</Link>
          <nav className={'b-nav' + (open ? ' open' : '')} aria-label="Main">
            {NAV.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>)}
            {isAdmin && <NavLink to="/admin">Admin</NavLink>}
            <NavLink to={user ? '/account' : '/login'} className="b-nav-acct-m">{user ? 'My account' : 'Log in'}</NavLink>
          </nav>
          <div className="b-header-actions">
            <NavLink to={user ? '/account' : '/login'} className="b-icon-link b-hide-m" aria-label={user ? 'My account' : 'Log in'}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>
              <span>{user ? 'Account' : 'Log in'}</span>
            </NavLink>
            <NavLink to="/cart" className="b-icon-link b-cart-link" aria-label={`Cart, ${count} items`}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2" /><circle cx="10" cy="20.5" r="1.2" /><circle cx="17" cy="20.5" r="1.2" /></svg>
              <span>Cart</span>
              {count > 0 && <b className="b-badge">{count}</b>}
            </NavLink>
            <button type="button" className="b-burger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              <span /><span /><span />
            </button>
          </div>
        </div>
      </header>
      <main className="b-main"><Outlet /></main>
      <footer className="b-footer">
        <div className="b-wrap b-footer-in">
          <div>
            <div className="b-logo b-logo-sm">{settings.store_name || 'Blendy'}</div>
            <p>{settings.tagline || 'Real fruit smoothies'}</p>
          </div>
          <nav aria-label="Footer">
            <Link to="/shop">Shop</Link>
            <Link to="/about">About us</Link>
            <Link to="/contact">Contact</Link>
            <Link to={user ? '/account' : '/login'}>{user ? 'My account' : 'Log in'}</Link>
          </nav>
          <div className="b-footer-contact">
            {settings.contact_email && <a href={`mailto:${settings.contact_email}`}>{settings.contact_email}</a>}
            {settings.contact_phone && <a href={`tel:${settings.contact_phone.replace(/\s/g, '')}`}>{settings.contact_phone}</a>}
            <div className="b-social">
              {settings.instagram_url && <a href={settings.instagram_url} target="_blank" rel="noreferrer">Instagram</a>}
              {settings.facebook_url && <a href={settings.facebook_url} target="_blank" rel="noreferrer">Facebook</a>}
              {settings.tiktok_url && <a href={settings.tiktok_url} target="_blank" rel="noreferrer">TikTok</a>}
            </div>
          </div>
        </div>
        <div className="b-wrap b-copy">© {new Date().getFullYear()} {settings.store_name || 'Blendy'}. All rights reserved.</div>
      </footer>
    </div>
  );
}
