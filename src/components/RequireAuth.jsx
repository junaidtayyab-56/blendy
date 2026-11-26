import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../store/auth.jsx';

export default function RequireAuth({ children }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <div className="b-wrap b-loading">Loading…</div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return children;
}
