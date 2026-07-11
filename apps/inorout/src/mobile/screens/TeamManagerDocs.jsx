// TeamManagerDocs.jsx — Team-manager track: the coach's squad COMPLIANCE board.
// Holiday-hub P10b. Drill-in from TeamManagerPeople (local state, no MobileShell route
// change → additive, casual-safe). Renders inside [data-surface="mobile"] (amber tokens).
//
// Shows, per active squad member, whether their consents / proof-of-age / medical review
// are cleared or outstanding — so a coach knows who's ready to play and who to chase.
// STATUS FLAGS ONLY (the reader never returns medical content — that stays with the family):
//   clubManagerGetTeamDocStatus(teamId) → { ok, team, requirements{consents_required,id_mandate},
//     summary{members,all_clear,with_outstanding},
//     members:[{ member_profile_id, name, consents{signed,required,status}, id{status},
//               medical{status}, outstanding, all_clear }] }  (server-sorted worst-first)
//   status ∈ done | due | submitted | na.

import { useState, useEffect, useCallback } from "react";
import { clubManagerGetTeamDocStatus } from "@platform/core";
import MIcon from "../icons.jsx";

function initials(name) {
  const w = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[w.length - 1][0]).toUpperCase();
}

// status → chip tone. done = green, due = amber (needs chasing), submitted = neutral (in review).
function tone(status) {
  if (status === "done") return { soft: "var(--ok-soft)", ink: "var(--ok-ink)" };
  if (status === "due") return { soft: "var(--amber-soft)", ink: "var(--amber)" };
  return { soft: "var(--s3)", ink: "var(--ink3)" }; // submitted / anything else
}
const LABEL = { done: "✓", due: "!", submitted: "…" };

function Chip({ label, status }) {
  if (status === "na") return null;
  const t = tone(status);
  return (
    <span style={{
      height: 22, padding: "0 9px", borderRadius: "var(--r-pill)", flex: "none",
      display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700,
      background: t.soft, color: t.ink,
    }}>{label} {LABEL[status] || ""}</span>
  );
}

const retryBtn = {
  marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
  background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)",
  fontWeight: 700, fontSize: 13.5, fontFamily: "var(--m-font)",
};

export default function TeamManagerDocs({ teamId, teamName, toast, onBack }) {
  const [state, setState] = useState({ loading: true, error: false, data: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const data = await clubManagerGetTeamDocStatus(teamId);
      setState({ loading: false, error: false, data });
    } catch {
      setState({ loading: false, error: true, data: null });
    }
  }, [teamId]);
  useEffect(() => { load(); }, [load]);

  const { loading, error, data } = state;
  const members = data?.members || [];
  const summary = data?.summary || {};
  const reqs = data?.requirements || {};

  // Human "what's required" line.
  const reqBits = [];
  if ((reqs.consents_required || 0) > 0) reqBits.push(`${reqs.consents_required} consent form${reqs.consents_required === 1 ? "" : "s"}`);
  if (reqs.id_mandate) reqBits.push("proof of age");
  reqBits.push("a yearly medical check");

  return (
    <div>
      <button onClick={onBack} style={{
        display: "flex", alignItems: "center", gap: 5, background: "transparent", border: "none",
        cursor: "pointer", color: "var(--ink3)", fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 600, margin: "6px 0 2px",
      }}>
        <MIcon name="chevron" size={15} color="var(--ink3)" style={{ transform: "rotate(180deg)" }} /> People
      </button>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "6px 2px 12px" }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em", margin: 0 }}>{teamName || "Squad"}</h2>
        <span style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 600 }}>documents</span>
      </div>

      {loading && <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5 }}>Loading documents…</div>}
      {error && (
        <div className="m-card" style={{ padding: "14px 15px" }}>
          <p style={{ color: "var(--ink2)", fontSize: 13.5, margin: 0 }}>Couldn't load documents.</p>
          <button onClick={load} style={retryBtn}>Try again</button>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* summary */}
          <div className="m-card" style={{ padding: "13px 15px", marginBottom: 10, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 42, height: 42, borderRadius: 12, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
              background: (summary.with_outstanding || 0) === 0 ? "var(--ok-soft)" : "var(--amber-soft)",
            }}>
              <MIcon name={(summary.with_outstanding || 0) === 0 ? "check" : "alert"} size={20}
                color={(summary.with_outstanding || 0) === 0 ? "var(--ok-ink)" : "var(--amber)"} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>
                {(summary.with_outstanding || 0) === 0
                  ? "Everyone's cleared"
                  : `${summary.with_outstanding} of ${summary.members} need attention`}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>
                {summary.all_clear || 0} of {summary.members || 0} fully cleared
              </div>
            </div>
          </div>

          <div style={{ fontSize: 12, color: "var(--ink3)", lineHeight: 1.45, margin: "0 2px 12px" }}>
            Each player needs {reqBits.join(", ").replace(/, ([^,]*)$/, " and $1")}. Chips: <strong style={{ color: "var(--ok-ink)" }}>✓</strong> done · <strong style={{ color: "var(--amber)" }}>!</strong> outstanding · <strong style={{ color: "var(--ink3)" }}>…</strong> in review.
          </div>

          {members.length === 0 && (
            <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5 }}>No players in this squad yet.</div>
          )}

          {members.map((m) => (
            <div key={m.member_profile_id} className="m-card" style={{ padding: "11px 13px", marginBottom: 9 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                <span style={{
                  width: 32, height: 32, borderRadius: 10, flex: "none", display: "flex", alignItems: "center",
                  justifyContent: "center", background: "var(--s4)", color: "var(--ink3)", fontSize: 12, fontWeight: 800,
                }}>{initials(m.name)}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</span>
                {m.all_clear
                  ? <span style={{ height: 22, padding: "0 9px", borderRadius: "var(--r-pill)", flex: "none", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, background: "var(--ok-soft)", color: "var(--ok-ink)" }}><MIcon name="check" size={12} color="var(--ok-ink)" />Cleared</span>
                  : (m.outstanding || 0) > 0
                    ? <span style={{ height: 22, padding: "0 9px", borderRadius: "var(--r-pill)", flex: "none", fontSize: 11, fontWeight: 700, background: "var(--amber-soft)", color: "var(--amber)", display: "inline-flex", alignItems: "center" }}>{m.outstanding} to chase</span>
                    : <span style={{ height: 22, padding: "0 9px", borderRadius: "var(--r-pill)", flex: "none", fontSize: 11, fontWeight: 700, background: "var(--s3)", color: "var(--ink3)", display: "inline-flex", alignItems: "center" }}>In review</span>}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 9, paddingLeft: 43 }}>
                <Chip label={`Consents ${m.consents?.signed ?? 0}/${m.consents?.required ?? 0}`} status={m.consents?.status} />
                <Chip label="ID" status={m.id?.status} />
                <Chip label="Medical" status={m.medical?.status} />
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
