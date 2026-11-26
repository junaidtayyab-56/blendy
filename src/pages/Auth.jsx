import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabase.js';
import usePageTitle from '../components/usePageTitle.js';
import { useAuth } from '../store/auth.jsx';

const TITLES = { register: 'Create your account', login: 'Welcome back', forgot: 'Reset your password', reset: 'Choose a new password' };

// Login, register, forgot-password and reset-password pages.
export default function Auth({ mode, admin = false }) {
  usePageTitle(admin ? 'Admin login' : TITLES[mode]);
  const { user, recovery, clearRecovery } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = params.get('next') || (admin ? '/admin' : '/account');
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/account';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => { setError(''); setInfo(''); }, [mode]);

  if (user && (mode === 'login' || mode === 'register') && !busy) return <Navigate to={safeNext} replace />;

  const origin = window.location.origin;

  async function submit(e) {
    e.preventDefault();
    setError(''); setInfo('');
    if (!supabase) { setError('Accounts are not available right now.'); return; }
    setBusy(true);
    try {
      if (mode === 'register') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(), password,
          options: { data: { full_name: name.trim() }, emailRedirectTo: origin + '/account' },
        });
        if (error) throw error;
        if (data.session) navigate(safeNext, { replace: true });
        else setInfo(`Almost there! We sent a confirmation link to ${email.trim()}. Open it to activate your account, then log in.`);
      } else if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        navigate(safeNext, { replace: true });
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: origin + '/reset-password' });
        if (error) throw error;
        setInfo(`If an account exists for ${email.trim()}, a reset link is on its way.`);
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        clearRecovery();
        navigate('/account', { replace: true, state: { msg: 'Your password has been updated.' } });
      }
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const resetBlocked = mode === 'reset' && !user && !recovery;

  return (
    <div className="b-wrap b-page b-auth">
      <div className="b-panel b-auth-box">
        <h1>{admin ? 'Admin login' : TITLES[mode]}</h1>
        {admin && <p className="b-muted">Sign in with an admin account to manage the store.</p>}
        {resetBlocked ? (
          <p className="b-muted">Open the reset link from your email to choose a new password. <Link to="/forgot-password">Send a new link</Link></p>
        ) : (
          <form className="b-form" onSubmit={submit}>
            {mode === 'register' && (
              <label className="b-field"><span>Name</span>
                <input type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
              </label>
            )}
            {mode !== 'reset' && (
              <label className="b-field"><span>Email</span>
                <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus={mode !== 'register'} />
              </label>
            )}
            {mode !== 'forgot' && (
              <label className="b-field"><span>{mode === 'reset' ? 'New password' : 'Password'}</span>
                <input type="password" required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus={mode === 'reset'} />
                {mode !== 'login' && <small>At least 8 characters</small>}
              </label>
            )}
            {error && <p className="b-error" role="alert">{error}</p>}
            {info && <p className="b-info" role="status">{info}</p>}
            <button className="b-btn b-btn-block" type="submit" disabled={busy}>
              {busy ? 'Please wait…' : { register: 'Create account', login: 'Log in', forgot: 'Send reset link', reset: 'Save password' }[mode]}
            </button>
          </form>
        )}
        {!admin && (
          <div className="b-auth-switch">
            {mode === 'register' && <>Already have an account? <Link to={`/login${params.get('next') ? `?next=${encodeURIComponent(safeNext)}` : ''}`}>Log in</Link></>}
            {mode === 'login' && <>New to Blendy? <Link to={`/register${params.get('next') ? `?next=${encodeURIComponent(safeNext)}` : ''}`}>Create an account</Link><br /><Link to="/forgot-password">Forgot your password?</Link></>}
            {mode === 'forgot' && <>Remembered it? <Link to="/login">Back to log in</Link></>}
          </div>
        )}
        {admin && <div className="b-auth-switch"><Link to="/forgot-password">Forgot your password?</Link> · <Link to="/">Back to the store</Link></div>}
      </div>
    </div>
  );
}
