import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase, money } from '../supabase.js';

const DEFAULTS = { store_name: 'Blendy', tagline: 'Real fruit smoothies', currency: 'USD', shipping_fee_cents: 0, free_shipping_threshold_cents: null };
const SettingsCtx = createContext({ settings: DEFAULTS, fmt: (c) => money(c), reload: () => {} });

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULTS);
  const reload = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from('store_settings').select('*').maybeSingle();
    if (error) console.error('[Blendy] settings', error);
    if (data) setSettings({ ...DEFAULTS, ...data });
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const fmt = useCallback((cents) => money(cents, settings.currency || 'USD'), [settings.currency]);
  return <SettingsCtx.Provider value={{ settings, fmt, reload }}>{children}</SettingsCtx.Provider>;
}

export const useSettings = () => useContext(SettingsCtx);

export function shippingFor(subtotal, s) {
  if (!subtotal) return 0;
  if (s.free_shipping_threshold_cents != null && subtotal >= s.free_shipping_threshold_cents) return 0;
  return s.shipping_fee_cents || 0;
}
