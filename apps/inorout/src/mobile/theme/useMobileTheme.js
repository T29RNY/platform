// useMobileTheme.js — light/dark/auto theme pref for the mobile surface ONLY.
//
// Ported from the design handoff's theme module (m-data.jsx) but DE-GLOBALISED:
// the prototype wrote data-theme onto <html>, which would repaint the whole app.
// Here the resolved theme is returned as a string the shell applies to its OWN
// [data-surface="mobile"] wrapper element — so the existing :root gold theme,
// the casual view, the Member view, and every laptop page are never touched.
//
// pref ('dark' | 'light' | 'system') persists in localStorage. The returned
// `resolved` is always concrete 'dark' | 'light' for the wrapper's data-theme.

import { useState, useEffect, useCallback } from "react";

const THEME_KEY = "ioo-mobile-theme";

function systemTheme() {
  return typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function readPref() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "dark";
  } catch (e) {
    return "dark";
  }
}

export function useMobileTheme() {
  const [pref, setPrefState] = useState(readPref);
  const [resolved, setResolved] = useState(() =>
    readPref() === "system" ? systemTheme() : readPref()
  );

  // Recompute resolved theme whenever pref changes, and follow the OS when on
  // 'system'. We never touch document.documentElement — the shell owns the
  // data-theme attribute on its scoped wrapper.
  useEffect(() => {
    const apply = () => setResolved(pref === "system" ? systemTheme() : pref);
    apply();
    if (pref !== "system" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onSys = () => apply();
    mq.addEventListener ? mq.addEventListener("change", onSys) : mq.addListener?.(onSys);
    return () => {
      mq.removeEventListener ? mq.removeEventListener("change", onSys) : mq.removeListener?.(onSys);
    };
  }, [pref]);

  const setPref = useCallback((next) => {
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {
      /* private mode — in-memory only */
    }
    setPrefState(next);
  }, []);

  return { pref, resolved, setPref };
}

export { THEME_KEY };
