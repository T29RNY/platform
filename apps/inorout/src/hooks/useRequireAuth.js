import { useCallback, useRef, useState } from "react";
import { supabase } from "@platform/core/storage/supabase.js";

// useRequireAuth — gate an action behind an authenticated session.
//
// Usage:
//   const { requireAuth, gateProps } = useRequireAuth();
//   // ...
//   <button onClick={() => requireAuth(() => doThing(), { reason: "..." })}>...
//   <AuthGateModal {...gateProps} />
//
// If a session exists, the action runs immediately. Otherwise gateProps.open
// becomes true; after the user completes sign-in via AuthGateModal, the
// pending action runs.
export default function useRequireAuth() {
  const [open, setOpen]     = useState(false);
  const [reason, setReason] = useState(null);
  const pendingRef          = useRef(null);

  const requireAuth = useCallback(async (action, opts = {}) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        return action();
      }
    } catch (e) { /* fall through to modal */ }
    pendingRef.current = action;
    setReason(opts.reason || null);
    setOpen(true);
  }, []);

  const onAuthed = useCallback(() => {
    setOpen(false);
    const action = pendingRef.current;
    pendingRef.current = null;
    if (action) action();
  }, []);

  const onClose = useCallback(() => {
    setOpen(false);
    pendingRef.current = null;
  }, []);

  return { requireAuth, gateProps: { open, onClose, onAuthed, reason } };
}
