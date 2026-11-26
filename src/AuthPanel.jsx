import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase.js';
import Panel from './Panel.jsx';

const TITLES = {
  signup: 'Create your account',
  login: 'Welcome back',
  forgot: 'Reset your password',
  recover: 'Choose a new password',
};

export default function AuthPanel({ initialMode = 'signup', note, accent, onClose, onDone }) {
  const [mode, setMode] = useState(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const firstField = useRef(null);

  useEffect(() => { setError(''); setInfo(''); firstField.current?.focus(); }, [mode]);

  const redirectTo = window.location.origin;

  async function submit(e) {
    e.preventDefault();
    setError(''); setInfo('');
    if (!supabase) { setError('Accounts are not available right now.'); return; }
    setBusy(true);
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim() }, emailRedirectTo: redirectTo },
        });
        if (error) throw error;
        if (data.session) onDone(`Welcome to Blendy${name.trim() ? ', ' + name.trim() : ''}!`);
        else setInfo('Almost there! We sent a confirmation link to ' + email.trim() + '. Open it to activate your account, then log in.');
      } else if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        onDone('You are logged in');
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
        if (error) throw error;
        setInfo('If an account exists for ' + email.trim() + ', a reset link is on its way.');
      } else if (mode === 'recover') {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        onDone('Your password has been updated');
      }
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const needsEmail = mode !== 'recover';
  const needsPassword = mode !== 'forgot';

  return (
    <Panel title={TITLES[mode]} accent={accent} onClose={onClose} kind="dialog">
      {note && (mode === 'signup' || mode === 'login') && <p className="pn-note">{note}</p>}
      <form className="pn-form" onSubmit={submit} noValidate={false}>
        {mode === 'signup' && (
          <label className="pn-field">
            <span>Name</span>
            <input ref={firstField} type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </label>
        )}
        {needsEmail && (
          <label className="pn-field">
            <span>Email</span>
            <input ref={mode === 'signup' ? undefined : firstField} type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        )}
        {needsPassword && (
          <label className="pn-field">
            <span>{mode === 'recover' ? 'New password' : 'Password'}</span>
            <input
              ref={mode === 'recover' ? firstField : undefined}
              type="password"
              required
              minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode !== 'login' && <small>At least 8 characters</small>}
          </label>
        )}
        {error && <p className="pn-error" role="alert">{error}</p>}
        {info && <p className="pn-info" role="status">{info}</p>}
        <button className="pn-btn" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : mode === 'login' ? 'Log in' : mode === 'forgot' ? 'Send reset link' : 'Save password'}
        </button>
      </form>
      <div className="pn-switch">
        {mode === 'signup' && <>Already have an account? <button type="button" onClick={() => setMode('login')}>Log in</button></>}
        {mode === 'login' && (
          <>
            New to Blendy? <button type="button" onClick={() => setMode('signup')}>Create an account</button>
            <br />
            <button type="button" onClick={() => setMode('forgot')}>Forgot your password?</button>
          </>
        )}
        {mode === 'forgot' && <>Remembered it? <button type="button" onClick={() => setMode('login')}>Back to log in</button></>}
      </div>
    </Panel>
  );
}
