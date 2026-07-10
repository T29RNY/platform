// TeamManagerPayments.jsx — Team-manager track, "Payments" (More sub-screen). A coach's
// read-only view of who's paid and who owes for their team — the phone twin of the desktop
// coach payments panel in apps/inorout/src/views/SessionsScreen.jsx (mig 398), reusing the
// SAME coach-auth reader so the figures are identical:
//   clubManagerTeamPayments(teamId) → { ok, team_name, members:[{ member_profile_id, name,
//     tier_name, membership_status, amount_pence, owes, overdue }] }
// Coach-gated server-side (auth.uid → club_team_managers). READ-ONLY by design: there is NO
// manual "chase" button — membership reminders go out automatically via the billing cron,
// exactly as the desktop states ("reminders go out automatically, so no chasing"). Adding a
// manual nudge would put mobile ahead of desktop. NO new backend.
//
// Renders inside [data-surface="mobile"] → shell amber tokens only.

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { clubManagerListTeamFixtures, clubManagerTeamPayments } from "@platform/core";
import MIcon from "../icons.jsx";

// pence → "£12" / "£12.50" (verbatim port of the money screens' gbp).
function gbp(pence) {
  const n = Number(pence || 0) / 100;
  return "£" + n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

function initials(name) {
  const w = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[w.length - 1][0]).toUpperCase();
}

// A team member with no active membership isn't "paid" — they have no fee. Desktop shows
// "—" for them (not a green "Paid"); mirror that so a non-member is never mislabelled.
const isActive = (m) => String(m.membership_status || "").toLowerCase() === "active";

export default function TeamManagerPayments({ onBack }) {
  const [teamsState, setTeamsState] = useState({ loading: true, error: false, teams: [] });
  const [teamIdx, setTeamIdx] = useState(0);
  const [pay, setPay] = useState({ loading: false, error: false, members: [] });

  const loadTeams = useCallback(async () => {
    setTeamsState((s) => ({ ...s, loading: true, error: false }));
    try {
      const res = await clubManagerListTeamFixtures();
      setTeamsState({ loading: false, error: false, teams: res?.teams || [] });
    } catch {
      setTeamsState({ loading: false, error: true, teams: [] });
    }
  }, []);
  useEffect(() => { loadTeams(); }, [loadTeams]);

  const teams = teamsState.teams;
  const team = teams[teamIdx] || teams[0] || null;
  const teamId = team?.team_id || null;

  const reqRef = useRef(0);
  const loadPay = useCallback(async () => {
    if (!teamId) { setPay({ loading: false, error: false, members: [] }); return; }
    const reqId = ++reqRef.current;
    setPay({ loading: true, error: false, members: [] });
    try {
      const data = await clubManagerTeamPayments(teamId);
      if (reqId !== reqRef.current) return;
      const members = Array.isArray(data?.members) ? data.members : [];
      setPay({ loading: false, error: false, members });
    } catch {
      if (reqId !== reqRef.current) return;
      setPay({ loading: false, error: true, members: [] });
    }
  }, [teamId]);
  useEffect(() => { loadPay(); }, [loadPay]);

  const members = pay.members;
  const owing = useMemo(() => members.filter((m) => m.owes), [members]);
  const paidCount = useMemo(() => members.filter((m) => !m.owes && isActive(m)).length, [members]);
  // owes first (overdue at the very top), then settled — worst surfaces first.
  const sorted = useMemo(() => [...members].sort((a, b) => {
    const rank = (m) => (m.owes ? (m.overdue ? 0 : 1) : 2);
    return (rank(a) - rank(b)) || String(a.name || "").localeCompare(String(b.name || ""));
  }), [members]);

  return (
    <div>
      <button onClick={onBack} style={backBtn}>
        <MIcon name="chevron" size={15} color="var(--ink3)" style={{ transform: "rotate(180deg)" }} /> More
      </button>

      {teamsState.loading && <Card><div className="m-eyebrow">Payments</div><p style={muted}>Loading your teams…</p></Card>}
      {teamsState.error && (
        <Card><div className="m-eyebrow">Payments</div><p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>Couldn't load your teams.</p>
          <button onClick={loadTeams} style={retryBtn}>Try again</button></Card>
      )}
      {!teamsState.loading && !teamsState.error && !team && (
        <Card><div className="m-eyebrow">Payments</div><p style={muted}>No teams to manage yet.</p></Card>
      )}

      {!teamsState.loading && !teamsState.error && team && (
        <>
          {teams.length > 1 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 2px 4px" }}>
              {teams.map((t, i) => {
                const on = i === teamIdx;
                return <button key={t.team_id} onClick={() => setTeamIdx(i)} style={pill(on)}>{t.team_name}</button>;
              })}
            </div>
          )}

          {/* summary + auto-reminder framing (mirrors desktop copy) */}
          <div className="m-card" style={{ marginTop: 12, padding: "14px 15px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: owing.length ? "var(--live-ink)" : "var(--ok-ink)", letterSpacing: "-0.01em" }}>
                  {pay.loading ? "…" : owing.length}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 600 }}>owe{owing.length === 1 ? "s" : ""} right now</div>
              </div>
              <div style={{ width: 1, alignSelf: "stretch", background: "var(--hair)" }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em" }}>
                  {pay.loading ? "…" : paidCount}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 600 }}>paid up</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 12, paddingTop: 11, borderTop: "1px solid var(--hair)", color: "var(--ink4)", fontSize: 12, lineHeight: 1.45 }}>
              <MIcon name="bell" size={13} color="var(--ink4)" /> Reminders go out automatically — no chasing needed.
            </div>
          </div>

          {pay.loading && <Card><p style={muted}>Loading payments…</p></Card>}
          {pay.error && (
            <Card><p style={{ color: "var(--ink2)", fontSize: 13.5, margin: 0 }}>Couldn't load payments for this team.</p>
              <button onClick={loadPay} style={retryBtn}>Try again</button></Card>
          )}
          {!pay.loading && !pay.error && members.length === 0 && (
            <Card><p style={muted}>No players on this team yet.</p></Card>
          )}
          {!pay.loading && !pay.error && members.length > 0 && (
            <div className="m-card" style={{ padding: "6px 4px", marginTop: 12 }}>
              {sorted.map((m) => {
                const name = m.name || "Player";
                return (
                  <div key={m.member_profile_id || name} style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 10px" }}>
                    <span style={{ width: 32, height: 32, borderRadius: 10, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--s4)", color: "var(--ink3)", fontSize: 12, fontWeight: 800 }}>{initials(name)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
                      {m.tier_name && <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.tier_name}</div>}
                    </div>
                    {m.owes ? (
                      <span style={{
                        height: 24, padding: "0 10px", borderRadius: "var(--r-pill)", flex: "none",
                        display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700,
                        background: "var(--live-soft)", color: "var(--live-ink)",
                      }}>{m.overdue ? "Overdue" : "Owes"}{m.amount_pence != null ? ` ${gbp(m.amount_pence)}` : ""}</span>
                    ) : isActive(m) ? (
                      <span style={{
                        height: 24, padding: "0 10px", borderRadius: "var(--r-pill)", flex: "none",
                        display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 700,
                        background: "var(--ok-soft)", color: "var(--ok-ink)",
                      }}>Paid</span>
                    ) : (
                      // No active membership → no fee. Neutral "—", never a green "Paid" (matches desktop).
                      <span title="No membership" style={{
                        height: 24, minWidth: 34, padding: "0 10px", borderRadius: "var(--r-pill)", flex: "none",
                        display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700,
                        background: "var(--s3)", color: "var(--ink4)",
                      }}>—</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Card({ children }) { return <div className="m-card" style={{ marginTop: 8 }}>{children}</div>; }
const muted = { color: "var(--ink3)", fontSize: 14, marginTop: 8 };
const backBtn = {
  display: "flex", alignItems: "center", gap: 5, background: "transparent", border: "none",
  cursor: "pointer", color: "var(--ink3)", fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 600, margin: "6px 0 2px",
};
const pill = (on) => ({
  height: 32, padding: "0 14px", borderRadius: "var(--r-pill)", cursor: "pointer",
  fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 700, border: "1px solid",
  background: on ? "var(--amber-soft)" : "transparent",
  color: on ? "var(--amber)" : "var(--ink3)",
  borderColor: on ? "var(--amber-glow)" : "var(--hair2)",
});
const retryBtn = {
  marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
  background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 13.5,
};
