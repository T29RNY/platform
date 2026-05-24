import { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "@phosphor-icons/react";

const readDismissed = (key) => {
  try { return !!localStorage.getItem(key); } catch { return false; }
};

const writeDismissed = (key) => {
  try { localStorage.setItem(key, "1"); } catch { /* Safari private mode */ }
  try { window.dispatchEvent(new CustomEvent("ioo-hint-dismissed", { detail: { key } })); } catch { /* ignore */ }
};

export function useFirstTimeHint(storageKey, prerequisite) {
  const [dismissed, setDismissed] = useState(() => readDismissed(storageKey));
  const [prereqMet, setPrereqMet] = useState(() => !prerequisite || readDismissed(prerequisite));

  useEffect(() => {
    const onDismissed = (e) => {
      const k = e?.detail?.key;
      if (k === storageKey) setDismissed(true);
      if (prerequisite && k === prerequisite) setPrereqMet(true);
    };
    const onStorage = (e) => {
      if (e.key === storageKey) setDismissed(readDismissed(storageKey));
      if (prerequisite && e.key === prerequisite) setPrereqMet(readDismissed(prerequisite));
    };
    window.addEventListener("ioo-hint-dismissed", onDismissed);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("ioo-hint-dismissed", onDismissed);
      window.removeEventListener("storage", onStorage);
    };
  }, [storageKey, prerequisite]);

  const dismiss = useCallback(() => {
    writeDismissed(storageKey);
    setDismissed(true);
  }, [storageKey]);

  const visible = !dismissed && prereqMet;
  return [visible, dismiss];
}

const PLACEMENT_STYLES = {
  bottom: { top: "calc(100% + 8px)", left: 0, right: 0 },
  top:    { bottom: "calc(100% + 8px)", left: 0, right: 0 },
  left:   { right: "calc(100% + 8px)", top: 0 },
  right:  { left: "calc(100% + 8px)", top: 0 },
};

export default function FirstTimeHint({
  storageKey,
  prerequisite,
  placement = "bottom",
  title,
  body,
  style,
  children,
}) {
  const [visible, dismiss] = useFirstTimeHint(storageKey, prerequisite);
  const pos = PLACEMENT_STYLES[placement] || PLACEMENT_STYLES.bottom;

  return (
    <div style={{ position: "relative", ...style }}>
      {children}
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            role="status"
            aria-live="polite"
            style={{
              position: "absolute",
              zIndex: 50,
              maxWidth: "min(280px, calc(100vw - 32px))",
              background: "var(--gold2)",
              border: "0.5px solid var(--goldb)",
              borderLeft: "3px solid var(--gold)",
              borderRadius: "var(--r)",
              padding: "12px 14px",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 10,
              boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
              ...pos,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              {title && (
                <div style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 13,
                  letterSpacing: "0.08em",
                  color: "var(--gold)",
                  marginBottom: 4,
                }}>
                  {title}
                </div>
              )}
              <div style={{
                fontSize: 12,
                color: "var(--t2)",
                fontWeight: 300,
                lineHeight: 1.5,
              }}>
                {body}
              </div>
            </div>
            <button
              onClick={dismiss}
              aria-label="Dismiss hint"
              style={{
                background: "none",
                border: "none",
                color: "var(--t2)",
                cursor: "pointer",
                padding: 4,
                margin: -4,
                lineHeight: 0,
                flexShrink: 0,
                minWidth: 24,
                minHeight: 24,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X size={14} weight="thin" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
