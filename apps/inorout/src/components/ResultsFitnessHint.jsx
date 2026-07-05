import { useState } from "react";
import { Lightning, X } from "@phosphor-icons/react";
import { isHealthAvailable } from "../native/native-health.js";

const DISMISS_KEY = "io_fitness_results_hint_dismissed";

// Instructional nudge at the top of the Results tab — NATIVE iOS ONLY.
//
// Tells players HOW to log match fitness: expand a game below and attach the Apple Watch workout,
// and which Apple workout type to record (Outdoor / Indoor Football — the types that link to a
// game). Same size as the My View FitnessNudge. Dismissible once; self-hides on web and when the
// feature is off. Parent gates the mount on there being games to expand.
export default function ResultsFitnessHint() {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch (e) { return false; }
  });

  if (!isHealthAvailable() || hidden) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch (e) { /* localStorage unavailable — just hide */ }
    setHidden(true);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 16px 12px", padding: "11px 13px", background: "var(--s2)", border: "0.5px solid var(--b2)", borderRadius: "var(--r)", fontFamily: "var(--font-body)" }}>
      <Lightning size={18} weight="thin" color="var(--gold)" style={{ flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, color: "var(--t1)", fontWeight: 600 }}>Add your match fitness</div>
        <div style={{ fontSize: 11, color: "var(--t2)", marginTop: 2 }}>Expand a game below and attach your Apple Watch workout — record it in Apple as Outdoor or Indoor Football.</div>
      </div>
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
