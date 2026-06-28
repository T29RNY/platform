import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { getTour, TOURS_DISABLED } from "../lib/tourRegistry.js";

// Tour — the context-aware guided-tour engine (multi-context nav, Phase 2).
//
// Revived + upgraded from the dormant FirstTimeHint into a full spotlight tour:
//   • full screen-dim + a glow-ring spotlight around the live target, computed
//     from getBoundingClientRect and recomputed on scroll/resize/orientation
//     (rAF-throttled) so it stays pixel-aligned;
//   • poll-until-mounted target resolution (async lists / lazy cards);
//   • scrolls the target into view before highlighting;
//   • no-ops a step gracefully when its target never appears (e.g. competition
//     cards between seasons) — degrades, never blocks;
//   • respects prefers-reduced-motion (no animation, instant scroll);
//   • auto-advances when the user taps the highlighted control, plus an explicit
//     Next / Skip on the card;
//   • marks the tour "seen" on first SHOW (not completion), so abandoning it
//     mid-way never nags again;
//   • suppresses itself while any modal/overlay is open (markers carry
//     data-tour-suppress) and resumes when they clear — which also gives the
//     first-run order SquadReady → install prompt → tour for free.
//
// Pure presentational + localStorage. Gated by the caller via `enabled` so the
// whole Phase 2 experience ships dark behind the per-team flag.

const OVERLAY_Z = 9000;          // below AuthGateModal (9999); we suppress under it anyway
const TARGET_PAD = 6;            // px of breathing room around the spotlit element
const POLL_MS = 100;
const MAX_POLLS = 40;            // ~4s to find a target before skipping the step
const SUPPRESS_POLL_MS = 400;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const isSuppressed = () =>
  typeof document !== "undefined" && !!document.querySelector("[data-tour-suppress]");

const wasSeen = (key) => {
  try { return !!localStorage.getItem(key); } catch { return false; }
};
const markSeen = (key) => {
  try { localStorage.setItem(key, "1"); } catch { /* private mode — non-fatal */ }
};

export default function Tour({ tourKey, enabled = false, active = true }) {
  const tour = tourKey ? getTour(tourKey) : null;
  const steps = tour?.steps || [];

  const [running, setRunning] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [suppressedNow, setSuppressedNow] = useState(false);
  const rafRef = useRef(0);

  const step = running ? steps[stepIndex] || null : null;

  const end = useCallback(() => {
    setRunning(false);
    setRect(null);
  }, []);

  const advance = useCallback(() => {
    setRect(null);
    setStepIndex((i) => {
      if (i + 1 >= steps.length) { setRunning(false); return i; }
      return i + 1;
    });
  }, [steps.length]);

  // Decide whether to start. Wait out any suppression (onboarding / install /
  // modals) before showing, then mark seen on first SHOW.
  useEffect(() => {
    if (TOURS_DISABLED || !enabled || !active || !tour || steps.length === 0) return;
    if (wasSeen(tourKey)) return;
    let cancelled = false;
    let timer = 0;
    const tryStart = () => {
      if (cancelled) return;
      if (isSuppressed()) { timer = window.setTimeout(tryStart, SUPPRESS_POLL_MS); return; }
      markSeen(tourKey);              // seen-on-show: abandonment never re-nags
      setStepIndex(0);
      setRect(null);
      setRunning(true);
    };
    timer = window.setTimeout(tryStart, 600); // let the screen settle first
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [enabled, active, tour, tourKey, steps.length]);

  // Resolve the current step's target: poll until mounted, scroll into view,
  // then measure. Skip the step if the target never appears.
  useEffect(() => {
    if (!running || !step) return;
    let cancelled = false;
    let polls = 0;
    let settleTimer = 0;
    const resolve = () => {
      if (cancelled) return;
      const el = document.querySelector(step.target);
      if (!el) {
        if (++polls > MAX_POLLS) { advance(); return; }   // graceful no-op → next step
        window.setTimeout(resolve, POLL_MS);
        return;
      }
      el.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
      settleTimer = window.setTimeout(() => {
        if (cancelled) return;
        const e2 = document.querySelector(step.target);
        if (e2) setRect(e2.getBoundingClientRect());
        else advance();
      }, reducedMotion() ? 0 : 280);
    };
    resolve();
    return () => { cancelled = true; window.clearTimeout(settleTimer); };
  }, [running, stepIndex, step, advance]);

  // Keep the spotlight aligned as the page scrolls / rotates / resizes.
  useEffect(() => {
    if (!running || !step) return;
    const recompute = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const el = document.querySelector(step.target);
        if (el) setRect(el.getBoundingClientRect());
      });
    };
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    window.addEventListener("orientationchange", recompute);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
      window.removeEventListener("orientationchange", recompute);
    };
  }, [running, step]);

  // Auto-advance when the user taps the highlighted control. The overlay lets
  // taps through (pointer-events:none on the dim), so the real action fires; we
  // advance on the next tick. Disabled for tours whose targets navigate away on
  // tap (e.g. the admin dashboard tiles) — those walk via the Next button so the
  // sequence isn't broken by a tile unmounting the screen.
  useEffect(() => {
    if (!running || !step || tour?.advanceOnTap === false) return;
    const onClick = (e) => {
      const el = document.querySelector(step.target);
      if (el && el.contains(e.target)) window.setTimeout(advance, 60);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [running, step, advance, tour]);

  // If a modal opens mid-tour, hide the overlay until it clears (don't lose place).
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setSuppressedNow(isSuppressed()), SUPPRESS_POLL_MS);
    setSuppressedNow(isSuppressed());
    return () => window.clearInterval(id);
  }, [running]);

  if (!running || !step || !rect || suppressedNow) return null;
  if (typeof document === "undefined") return null;

  const rm = reducedMotion();
  const vh = window.innerHeight;
  const holeTop = Math.max(0, rect.top - TARGET_PAD);
  const holeLeft = Math.max(0, rect.left - TARGET_PAD);
  const holeW = rect.width + TARGET_PAD * 2;
  const holeH = rect.height + TARGET_PAD * 2;

  // Place the card below the target if it sits in the top 55% of the viewport,
  // otherwise above — keeps the card on screen and clear of the spotlight.
  const below = rect.top + rect.height / 2 < vh * 0.55;
  const cardPos = below
    ? { top: Math.min(holeTop + holeH + 14, vh - 180) }
    : { bottom: Math.max(vh - holeTop + 14, 90) };

  const isLast = stepIndex + 1 >= steps.length;

  const overlay = (
    <AnimatePresence>
      <motion.div
        key="tour-overlay"
        initial={rm ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: rm ? 0 : 0.2 }}
        style={{
          position: "fixed", inset: 0, zIndex: OVERLAY_Z,
          pointerEvents: "none",
        }}
        role="dialog"
        aria-live="polite"
        aria-label={step.title}
      >
        {/* Spotlight: one element carries the full-screen dim (huge spread),
            the glow-ring and the rounded hole — taps pass through to the target. */}
        <motion.div
          initial={rm ? false : { opacity: 0 }}
          animate={{ opacity: 1, top: holeTop, left: holeLeft, width: holeW, height: holeH }}
          transition={{ duration: rm ? 0 : 0.25, ease: "easeOut" }}
          style={{
            position: "fixed",
            top: holeTop, left: holeLeft, width: holeW, height: holeH,
            borderRadius: 14,
            boxShadow: "0 0 0 9999px rgba(6,6,4,0.74), 0 0 0 2px var(--gold), 0 0 22px 5px rgba(232,160,32,0.45)",
            pointerEvents: "none",
          }}
        />

        {/* Coach card */}
        <motion.div
          initial={rm ? false : { opacity: 0, y: below ? -8 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: rm ? 0 : 0.2, delay: rm ? 0 : 0.08 }}
          style={{
            // Centre without transform — framer-motion's y animation drives
            // `transform`, so left/right + margin auto is the safe way to centre.
            position: "fixed",
            left: 16, right: 16, marginLeft: "auto", marginRight: "auto",
            width: "auto", maxWidth: 320,
            ...cardPos,
            background: "var(--gold2)",
            border: "0.5px solid var(--goldb)",
            borderLeft: "3px solid var(--gold)",
            borderRadius: "var(--r)",
            padding: "14px 16px",
            boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
            pointerEvents: "auto",
            zIndex: OVERLAY_Z + 1,
          }}
        >
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 15, letterSpacing: "0.08em",
            color: "var(--gold)", marginBottom: 6,
          }}>
            {step.title}
          </div>
          <div style={{ fontSize: 13, color: "var(--t1)", fontWeight: 300, lineHeight: 1.5 }}>
            {step.body}
          </div>
          <div style={{
            marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <button
              onClick={end}
              style={{
                background: "none", border: "none", padding: 4, margin: -4, cursor: "pointer",
                fontSize: 12, color: "var(--t2)", textDecoration: "underline",
                textDecorationStyle: "dotted",
              }}
            >
              Skip
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {steps.length > 1 && (
                <span style={{ fontSize: 11, color: "var(--t2)", letterSpacing: "0.06em" }}>
                  {stepIndex + 1} / {steps.length}
                </span>
              )}
              <button
                onClick={isLast ? end : advance}
                style={{
                  background: "var(--gold)", border: "none", borderRadius: "var(--r-button)",
                  padding: "7px 16px", cursor: "pointer",
                  fontFamily: "var(--font-display)", fontSize: 13, letterSpacing: "0.06em",
                  color: "var(--black)",
                }}
              >
                {isLast ? "Got it" : "Next"}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );

  return createPortal(overlay, document.body);
}
