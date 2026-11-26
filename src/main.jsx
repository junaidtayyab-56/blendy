import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './store/auth.jsx';
import { CartProvider } from './store/cart.jsx';
import { SettingsProvider } from './store/settings.jsx';
import { ToastProvider } from './store/toast.jsx';
import './hero.css';
import './site.css';

// The homepage sets html.is-home itself; set it before the first paint too so the
// hero never flashes a scrollbar.
if (window.location.pathname === '/') document.documentElement.classList.add('is-home');

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <SettingsProvider>
      <AuthProvider>
        <CartProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </CartProvider>
      </AuthProvider>
    </SettingsProvider>
  </BrowserRouter>
);
