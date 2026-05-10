import { useState, useCallback } from "react";
import { storage } from "../storage/localStorage.js";

// Drop-in replacement for useState that auto-persists to localStorage
// Usage: const [squad, setSquad] = usePersistedState("squad", defaultValue)
// To migrate to Supabase: swap the storage import above — nothing else changes

export function usePersistedState(key, defaultValue) {
  const [state, setStateRaw] = useState(() => storage.get(key) ?? defaultValue);

  const setState = useCallback((valueOrUpdater) => {
    setStateRaw(prev => {
      const next = typeof valueOrUpdater === "function"
        ? valueOrUpdater(prev)
        : valueOrUpdater;
      storage.set(key, next);
      return next;
    });
  }, [key]);

  return [state, setState];
}
