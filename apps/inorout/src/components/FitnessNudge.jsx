import { useEffect, useState } from "react";
import { Lightning, X } from "@phosphor-icons/react";
import { isHealthAvailable } from "../native/native-health.js";
import { getMyMatchHealth, getMyShareMatchFitness } from "@platform/core";

const ATTACH_DISMISS = (matchId) => `io_fitness_attach_nudge_${matchId}`;
const SHARE_DISMISS = "io_fitness_share_nudge_dismissed";

// My View discovery nudges for Match Fitness — NATIVE iOS ONLY.
//
// The feature is otherwise silent: players don't know to attach a workout (adoption confirmed this —
// only the operator ever had). Two mutually exclusive, dismissible nudges, decided from one fetch:
//   • ATTACH — the player's most recent game has no workout attached yet → tap opens Results, where
//     the per-match card auto-detects the Apple Watch workout and offers the confirm sheet.
//   • SHARE  — the player HAS attached fitness but hasn't turned on teammate sharing → tap opens
//     their profile (the sharing toggle) so head-to-head / the squad board can populate.
// Self-hides on web, when the feature is off, when there's nothing to nudge, and once dismissed
// (per-game for attach; once for share). Read-only — reuses existing RPCs, no new backend.
export default function FitnessNudge({ matchHistory = [], onGoToResults, onOpenProfile }) {
  const recent = matchHistory?.[0];
  const [mode, setMode] = useState(null); // "attach" | "share" | null

  useEffect(() => {
    if (!isHealthAvailable()) return;
    let alive = true;
    (async () => {
      try {
        const [health, share] = await Promise.all([getMyMatchHealth(), getMyShareMatchFitness()]);
        if (!alive) return;
        const sessions = health?.sessions || [];
        const attached = new Set(sessions.map((s) => s.match_ref));
        // Priority 1 — nudge to attach the most recent game (not yet attached, not dismissed).
        if (recent?.id && !attached.has(recent.id) && localStorage.getItem(ATTACH_DISMISS(recent.id)) !== "1") {
          setMode("attach");
          return;
        }
        // Priority 2 — has attached something but isn't sharing → nudge to turn sharing on.
        if (sessions.length > 0 && share?.share_match_fitness === false && localStorage.getItem(SHARE_DISMISS) !== "1") {
          setMode("share");
        }
      } catch (e) {
        console.error("[fitness-nudge] check failed", e);
      }
    })();
    return () => { alive = false; };
  }, [recent?.id]);

  if (!mode) return null;

  const isAttach = mode === "attach";
  const dismiss = () => {
    try {
      localStorage.setItem(isAttach ? ATTACH_DISMISS(recent.id) : SHARE_DISMISS, "1");
    } catch (e) { /* localStorage unavailable — just hide */ }
    setMode(null);
  };
  const onTap = isAttach ? onGoToResults : onOpenProfile;
  const title = isAttach ? "Add your match fitness" : "Share your match fitness";
  const sub = isAttach
    ? "Attach your Apple Watch workout from your last game →"
    : "Turn on sharing to compare with your teammates →";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: "11px 13px", background: "var(--s2)", border: "0.5px solid var(--b2)", borderRadius: "var(--r)", fontFamily: "var(--font-body)" }}>
      <Lightning size={18} weight="thin" color="var(--gold)" style={{ flexShrink: 0 }} />
      <button
        type="button"
        onClick={onTap}
        style={{ flex: 1, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "var(--font-body)", WebkitTapHighlightColor: "transparent" }}
      >
        <div style={{ fontSize: 13, color: "var(--t1)", fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 11, color: "var(--t2)", marginTop: 2 }}>{sub}</div>
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        style={{ background: "none", border: "none", color: "var(--t2)", cursor: "pointer", padding: 4, display: "flex", WebkitTapHighlightColor: "transparent" }}
      >
        <X size={16} weight="thin" />
      </button>
    </div>
  );
}
