import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../store/auth.jsx';
import Auth from '../pages/Auth.jsx';
import Dashboard from './Dashboard.jsx';
import Orders, { AdminOrder } from './Orders.jsx';
import Products, { ProductForm } from './Products.jsx';
import Categories from './Categories.jsx';
import Inventory from './Inventory.jsx';
import Customers from './Customers.jsx';
import Messages from './Messages.jsx';
import Settings from './Settings.jsx';
import './admin.css';

const NAV = [
  ['', 'Dashboard', 'M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z'],
  ['orders', 'Orders', 'M6 2l-2 4v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6l-2-4zM4 6h16M16 10a4 4 0 0 1-8 0'],
  ['products', 'Products', 'M21 16V8l-9-5-9 5v8l9 5zM3.3 7L12 12l8.7-5M12 22V12'],
  ['categories', 'Categories', 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'],
  ['inventory', 'Inventory', 'M3 3h18v4H3zM5 7v14h14V7M9 11h6'],
  ['customers', 'Customers', 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8'],
  ['messages', 'Messages', 'M4 4h16v12H5.2L4 17.2zM4 4l8 7 8-7'],
  ['settings', 'Settings', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 10h.1a2 2 0 1 1 0 4z'],
];

export default function AdminApp() {
  const { user, profile, isAdmin, ready, signOut } = useAuth();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => { document.title = 'Admin | Blendy'; }, [loc.pathname]);

  if (!ready) return <div className="ad-center">Loading…</div>;
  if (!user) {
    return (
      <Routes>
        <Route path="login" element={<div className="ad-login"><Auth mode="login" admin /></div>} />
        <Route path="*" element={<Navigate to={`/admin/login?next=${encodeURIComponent(loc.pathname)}`} replace />} />
      </Routes>
    );
  }
  if (!isAdmin) {
    return (
      <div className="ad-center">
        <div className="b-panel ad-denied">
          <h1>No admin access</h1>
          <p className="b-muted">You're signed in as {user.email}, which is a customer account. Ask the store owner to give this account the admin role.</p>
          <div className="b-actions-row"><a className="b-btn" href="/">Back to the store</a><button className="b-btn b-btn-ghost" type="button" onClick={signOut}>Log out</button></div>
        </div>
      </div>
    );
  }

  return (
    <div className="ad">
      <aside className={'ad-side' + (open ? ' open' : '')}>
        <div className="ad-brand"><span className="b-logo">Blendy</span><span className="ad-pill">Admin</span></div>
        <nav>
          {NAV.map(([to, label, d]) => (
            <NavLink key={to} to={`/admin${to ? '/' + to : ''}`} end={!to}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>{label}
            </NavLink>
          ))}
        </nav>
        <div className="ad-side-foot">
          <a href="/" target="_blank" rel="noreferrer">View store ↗</a>
          <span className="ad-me">{profile?.full_name || user.email}</span>
          <button type="button" onClick={signOut}>Log out</button>
        </div>
      </aside>
      {open && <div className="ad-scrim" onClick={() => setOpen(false)} />}
      <div className="ad-main">
        <header className="ad-top">
          <button type="button" className="b-burger ad-burger" aria-label="Menu" onClick={() => setOpen(true)}><span /><span /><span /></button>
          <span className="b-logo ad-top-logo">Blendy admin</span>
        </header>
        <div className="ad-body">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="login" element={<Navigate to="/admin" replace />} />
            <Route path="orders" element={<Orders />} />
            <Route path="orders/:id" element={<AdminOrder />} />
            <Route path="products" element={<Products />} />
            <Route path="products/new" element={<ProductForm />} />
            <Route path="products/:id" element={<ProductForm />} />
            <Route path="categories" element={<Categories />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="customers" element={<Customers />} />
            <Route path="messages" element={<Messages />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
