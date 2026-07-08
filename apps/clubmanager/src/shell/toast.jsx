import React, { createContext, useCallback, useContext, useState } from "react";

// Minimal toast system for the console. Every Supabase-calling write uses the
// optimistic-UI + saving-guard + toast triad; this is the toast leg. show()
// returns nothing; toasts auto-dismiss. Kinds: "ok" | "error".
const ToastCtx = createContext({ show: () => {} });

export function useToast() { return useContext(ToastCtx); }

let _seq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((message, kind = "ok") => {
    const id = ++_seq;
    setToasts((ts) => [...ts, { id, message, kind }]);
    // auto-dismiss after 3.5s
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 3500);
  }, []);

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.kind}`} onClick={() => dismiss(t.id)}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
