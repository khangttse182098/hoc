import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

interface ToastState { message: string; kind: 'info' | 'error' }
interface ToastApi {
  show(message: string): void;
  error(message: string): void;
}

const ToastContext = createContext<ToastApi>({ show: () => {}, error: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number>(0);
  const push = useCallback((message: string, kind: 'info' | 'error') => {
    window.clearTimeout(timer.current);
    setToast({ message, kind });
    timer.current = window.setTimeout(() => setToast(null), kind === 'error' ? 6000 : 2500);
  }, []);
  const api = useMemo<ToastApi>(
    () => ({ show: (m) => push(m, 'info'), error: (m) => push(m, 'error') }),
    [push],
  );
  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.message}</div>}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
