import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);

if (!supabaseConfigured) {
  console.error('[Blendy] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. Account and cart features are disabled.');
}

export const supabase = supabaseConfigured
  ? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

export const money = (cents, currency = 'USD') =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency }).format((cents || 0) / 100);
