import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import SiteLayout from './components/SiteLayout.jsx';
import RequireAuth from './components/RequireAuth.jsx';
import Home from './pages/Home.jsx';
import Shop from './pages/Shop.jsx';
import Product from './pages/Product.jsx';
import Cart from './pages/Cart.jsx';
import Checkout from './pages/Checkout.jsx';
import OrderDetail from './pages/OrderDetail.jsx';
import Account from './pages/Account.jsx';
import Auth from './pages/Auth.jsx';
import About from './pages/About.jsx';
import Contact from './pages/Contact.jsx';
import NotFound from './pages/NotFound.jsx';
import { useAuth } from './store/auth.jsx';
import { Navigate, useLocation } from 'react-router-dom';

// The admin panel is a separate bundle, loaded only when someone opens /admin.
const AdminApp = lazy(() => import('./admin/AdminApp.jsx'));

function RecoveryRedirect() {
  const { recovery } = useAuth();
  const loc = useLocation();
  if (recovery && loc.pathname !== '/reset-password') return <Navigate to="/reset-password" replace />;
  return null;
}

export default function App() {
  return (
    <>
      <RecoveryRedirect />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/admin/*" element={<Suspense fallback={<div className="ad-center">Loading…</div>}><AdminApp /></Suspense>} />
        <Route element={<SiteLayout />}>
          <Route path="/shop" element={<Shop />} />
          <Route path="/product/:slug" element={<Product />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/checkout" element={<RequireAuth><Checkout /></RequireAuth>} />
          <Route path="/order/:id" element={<RequireAuth><OrderDetail /></RequireAuth>} />
          <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
          <Route path="/login" element={<Auth mode="login" />} />
          <Route path="/register" element={<Auth mode="register" />} />
          <Route path="/forgot-password" element={<Auth mode="forgot" />} />
          <Route path="/reset-password" element={<Auth mode="reset" />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}
