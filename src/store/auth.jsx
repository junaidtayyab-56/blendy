import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabase.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(!supabase);
  const [checkedFor, setCheckedFor] = useState(null);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setSessionChecked(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (!s) setProfile(null);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const userId = session?.user?.id;

  const loadProfile = useCallback(async () => {
    if (!supabase || !userId) return;
    const { data, error } = await supabase.from('profiles').select('id, email, full_name, phone, role').eq('id', userId).maybeSingle();
    if (error) console.error('[Blendy] profile', error);
    setProfile(data || null);
    setCheckedFor(userId);
  }, [userId]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  const signOut = useCallback(async () => { await supabase?.auth.signOut(); }, []);

  // Ready once we know who is signed in and, if someone is, their profile has loaded.
  const ready = sessionChecked && (!userId || checkedFor === userId);

  const value = {
    session,
    user: session?.user || null,
    profile,
    isAdmin: profile?.role === 'admin',
    ready,
    recovery,
    clearRecovery: () => setRecovery(false),
    reloadProfile: loadProfile,
    signOut,
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
