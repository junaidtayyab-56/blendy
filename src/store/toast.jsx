import { createContext, useCallback, useContext, useRef, useState } from 'react';

const ToastCtx = createContext(() => {});

export function ToastProvider({ children }) {
  const [msg, setMsg] = useState('');
  const timer = useRef();
  const flash = useCallback((m) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(''), 2800);
  }, []);
  return (
    <ToastCtx.Provider value={flash}>
      {children}
      <div className={'toast' + (msg ? ' show' : '')} role="status" aria-live="polite">{msg}</div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
