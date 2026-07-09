// MemberReliability.jsx — Club Console PR #6 Phase B. The adult club member's OWN
// form: reliability (do I show up), appearances (P·W-D-L), goals, POTM and recent
// form — one card per club team they play for. The self-scoped twin of the coach's
// TeamManagerSquad reliability board (same visual idiom), powered by the member-auth
// self reader clubMemberGetSelfReliability (mig 519) which returns ONLY the caller's
// own rows — no other member's data ever reaches this screen.
//
// Renders inside [data-surface="mobile"] → shell amber tokens only. Read-only.

import { useState, useEffect, useCallback } from "react";
import { clubMemberGetSelfReliability } from "@platform/core";
import MIcon from "../icons.jsx";

const FORM_TOKEN = {
  W: { soft: "var(--ok-soft)", ink: "var(--ok-ink)" },
  L: { soft: "var(--live-soft)", ink: "var(--live-ink)" },
  D: { soft: "var(--s3)", ink: "var(--ink3)" },
};
// reliability % → token colour (green ≥75, amber ≥50, muted below) — matches the coach board.
function relToken(pct) {
  if (pct >= 75) return { soft: "var(--ok-soft)", ink: "var(--ok-ink)" };
  if (pct >= 50) return { soft: "var(--amber-soft)", ink: "var(--amber)" };
  return { soft: "var(--s3)", ink: "var(--ink3)" };
}

function FormPills({ form }) {
  const f = Array.isArray(form) ? form.slice(0, 5) : [];
  if (f.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 3, flex: "none" }}>
      {f.map((r, i) => {
        const ft = FORM_TOKEN[r] || FORM_TOKEN.D;
        return (
          <span key={i} style={{ width: 18, height: 18, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, background: ft.soft, color: ft.ink }}>{r}</span>
        );
      })}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: "var(--ink3)", fontWeight: 600, marginTop: 2, textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</div>
    </div>
  );
}

function TeamCard({ t }) {
  const rt = relToken(t.reliability);
  const noData = (t.played || 0) === 0 && (t.invited || 0) === 0;
  return (
    <div className="m-card" style={{ padding: "14px 15px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.team_name || "Your team"}</div>
          <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 2 }}>
            {noData ? "No matches logged yet" : `${t.reliability}% reliable · of ${t.invited} match${t.invited === 1 ? "" : "es"} asked`}
          </div>
        </div>
        <span style={{ height: 30, minWidth: 52, padding: "0 11px", borderRadius: "var(--r-pill)", flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, background: rt.soft, color: rt.ink }}>{t.reliability}%</span>
      </div>

      {!noData && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 13, paddingTop: 13, borderTop: "1px solid var(--s3)" }}>
            <Stat label="Played" value={t.played || 0} />
            <Stat label="W-D-L" value={`${t.wins || 0}-${t.draws || 0}-${t.losses || 0}`} />
            <Stat label="Goals" value={t.goals || 0} />
            <Stat label="POTM" value={t.potm || 0} />
          </div>
          {Array.isArray(t.form) && t.form.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 13 }}>
              <span style={{ fontSize: 11.5, color: "var(--ink3)", fontWeight: 600 }}>Recent form</span>
              <FormPills form={t.form} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function MemberReliability({ toast }) {
  const [state, setState] = useState({ loading: true, error: false, teams: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const data = await clubMemberGetSelfReliability();
      setState({ loading: false, error: false, teams: data?.teams || [] });
    } catch {
      setState({ loading: false, error: true, teams: null });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const { loading, error, teams } = state;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "6px 2px 14px" }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em", margin: 0 }}>Your form</h2>
        <span style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 600 }}>reliability &amp; POTM</span>
      </div>

      {loading && (
        <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5 }}>Loading your form…</div>
      )}

      {error && (
        <div className="m-card" style={{ padding: "14px 15px" }}>
          <p style={{ color: "var(--ink2)", fontSize: 13.5, margin: 0 }}>Couldn't load your form.</p>
          <button onClick={load} style={retryBtn}>Try again</button>
        </div>
      )}

      {!loading && !error && teams && teams.length === 0 && (
        <div className="m-card" style={{ padding: "20px 16px", textAlign: "center" }}>
          <div style={{ width: 44, height: 44, borderRadius: "var(--r-sm)", margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--amber-soft)" }}>
            <MIcon name="figure" size={22} color="var(--amber)" />
          </div>
          <p style={{ color: "var(--ink2)", fontSize: 14, fontWeight: 700, margin: 0 }}>You're not in a club team yet</p>
          <p style={{ color: "var(--ink3)", fontSize: 12.5, margin: "6px 0 0", lineHeight: 1.5 }}>
            Once your club adds you to a team, your reliability, goals and POTM show up here.
          </p>
        </div>
      )}

      {!loading && !error && teams && teams.length > 0 && (
        <>
          {teams.map((t) => <TeamCard key={t.team_id} t={t} />)}
          <div style={{ fontSize: 11.5, color: "var(--ink4)", margin: "4px 4px 20px", lineHeight: 1.5 }}>
            Reliability = the share of your team's matches you said you were available for (all-time).
          </div>
        </>
      )}
    </div>
  );
}

const retryBtn = {
  marginTop: 10, padding: "8px 14px", borderRadius: "var(--r-pill)", cursor: "pointer",
  background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 13,
};
