// OperationsTonight.jsx — Operator track, screen 1 ("Tonight"), mounted at /hub
// for an operator role (owner | manager | staff), tab "tonight".
//
// Honest mobile re-presentation of the laptop venue dashboard's Operations view
// (apps/venue/src/views/Operations.jsx) in the scoped amber theme. ALL data comes
// from one existing call — venueGetState(venue_id) → venue_get_state (mig 250):
// fixtures.tonight, teams, pitches, refs, open_incidents, pending_registrations,
// payments_summary. No new reader.
//
// AUTH: a mobile operator passes their venue_id as the credential. resolve_venue_caller
// stage 1b authenticates them via auth.uid() against venue_admins — the same path the
// laptop app uses (credential = selectedVenueId). No token, no new RPC.
//
// Quick actions reuse existing writers: venueApproveTeamRegistration /
// venueRejectTeamRegistration (mig 250) and venueResolveIncident with the structured
// outcome arg (mig 437). "Notify affected teams" is intentionally absent — deferred to
// the Broadcast-composer cycle where the fan-out target exists.

import { useState, useEffect, useCallback, useRef } from "react";
import {
  venueGetState, venueResolveIncident, venueLogIncident,
  venueApproveTeamRegistration, venueRejectTeamRegistration,
  venueTriageIncident, venueEscalateIncident, venueListAssignableStaff,
  venueFlagSafeguarding,
} from "@platform/core";
import MIcon from "../icons.jsx";
import MobileSheet from "../MobileSheet.jsx";
import SwipeRow from "../SwipeRow.jsx";

// Triage display (mig 461–465). Category values offered exclude 'safeguarding'
// (DB-valid but never surfaced — disclosures go to the safeguarding route).
const CATEGORIES = [
  ["facility", "Facility"], ["equipment", "Equipment"], ["safety", "Safety"],
  ["medical", "Medical"], ["conduct", "Conduct"], ["security", "Security"],
  ["weather", "Weather"], ["other", "Other"],
];
const PRIORITY_TONE = { urgent: "var(--live)", high: "var(--amber)", normal: "var(--ink3)", low: "var(--ink3)" };

function TriagePill({ text, tone }) {
  return (
    <span style={{
      height: 18, padding: "0 7px", borderRadius: "var(--r-pill)", display: "inline-flex", alignItems: "center",
      fontSize: 10.5, fontWeight: 800, letterSpacing: "0.02em", textTransform: "uppercase",
      background: "var(--s3)", color: tone || "var(--ink3)",
    }}>{text}</span>
  );
}

// Safety ship-gate: shown on the resolve sheet so the operational queue never
// silently swallows a safeguarding disclosure.
function SafeguardingNotice() {
  return (
    <div style={{
      marginTop: 14, padding: "10px 12px", borderRadius: 12, fontSize: 12.5, lineHeight: 1.4,
      background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--ink2)",
    }}>
      <strong style={{ color: "var(--amber)" }}>Not for safeguarding.</strong> Child-protection or
      welfare concerns must go through your safeguarding route — never this queue.
    </div>
  );
}

function gbp(pence) {
  const n = Number(pence || 0) / 100;
  return "£" + n.toLocaleString("en-GB", {
    minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2,
  });
}

function initials(name) {
  const w = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
}

// Deterministic HSL tint fallback when a team has no stored brand colour.
function hueFor(name) {
  let h = 0;
  const s = String(name || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

// Internal-league teams DO carry brand colours (unlike grassroots), so use them
// when present; the value is DB-sourced (not a hardcoded hex literal).
function Crest({ team, name, size = 26, r = 7 }) {
  const label = team?.name || name || "TBC";
  const c1 = team?.primary_colour || null;
  const c2 = team?.secondary_colour || team?.primary_colour || null;
  const hue = hueFor(label);
  const bg = c1
    ? `linear-gradient(135deg, ${c1} 0 55%, ${c2} 100%)`
    : `linear-gradient(135deg, hsl(${hue} 46% 42%) 0 52%, hsl(${hue} 46% 30%) 100%)`;
  return (
    <div style={{
      width: size, height: size, borderRadius: r, flex: "none",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: bg, color: "white", fontSize: size * 0.34, fontWeight: 800, letterSpacing: "-0.02em",
    }}>{initials(label)}</div>
  );
}

const OUTCOMES = [
  { id: "fixed",      label: "Fixed",            desc: "Resolved on site",         icon: "check" },
  { id: "safe",       label: "Made safe",        desc: "Isolated / closed for now", icon: "shield" },
  { id: "contractor", label: "Contractor booked", desc: "External fix scheduled",   icon: "cog" },
  { id: "nofault",    label: "No fault found",   desc: "Checked — nothing wrong",  icon: "info" },
];

export default function OperationsTonight({ venueId, venueName, toast, onNavigate }) {
  // Stat tiles scroll to their section (Live now / Open issues) or jump to another
  // tab (Outstanding → Payments), so each glance is a shortcut, not just a number.
  const liveRef = useRef(null);
  const issuesRef = useRef(null);
  const scrollTo = (r) => r.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const [state, setState] = useState({ loading: true, error: false, data: null });
  const [busyReg, setBusyReg] = useState({});     // competition_team_id → bool
  const [resolving, setResolving] = useState(null); // open incident object or null
  const [assigning, setAssigning] = useState(null); // incident being assigned, or null
  const [escalating, setEscalating] = useState(null); // incident being escalated, or null
  const [flagging, setFlagging] = useState(null);   // incident being flagged for safeguarding, or null
  const [staff, setStaff] = useState(null);         // cached assignable staff (lazy)
  const [ackBusy, setAckBusy] = useState({});       // incident_id → bool
  const [addIssue, setAddIssue] = useState(false);  // "Log an issue" sheet open

  const load = useCallback(async () => {
    if (!venueId) { setState({ loading: false, error: false, data: null }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const data = await venueGetState(venueId);
      setState({ loading: false, error: false, data });
    } catch {
      setState({ loading: false, error: true, data: null });
    }
  }, [venueId]);

  useEffect(() => { load(); }, [load]);

  const { loading, error, data } = state;

  if (loading) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">Operations</div>
        <p style={{ color: "var(--ink3)", fontSize: 14, marginTop: 8 }}>Loading tonight at {venueName || "your venue"}…</p>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">Operations</div>
        <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>Couldn't load the venue right now.</p>
        <button onClick={load} style={{
          marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
          background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 13.5,
        }}>Try again</button>
      </div>
    );
  }

  const teams = data.teams || {};
  const tonight = data.fixtures?.tonight || [];
  const regs = data.pending_registrations || [];
  const incidents = data.open_incidents || [];
  const pitchById = Object.fromEntries((data.pitches || []).map((p) => [p.id, p]));
  const refById = Object.fromEntries((data.refs || []).map((r) => [r.id, r]));
  const outstanding = data.payments_summary?.outstanding_pence || 0;

  const live = tonight.filter((f) => f.status === "in_progress");
  const upcoming = tonight.filter((f) => !["in_progress", "completed", "walkover", "forfeit", "voided"].includes(f.status));
  const toAssign = tonight.filter((f) => !f.playing_area_id || !f.official_id).length;
  const issues = regs.length + incidents.length;

  const teamName = (id) => teams[id]?.name || "TBC";

  // ── Registration approve / reject ──
  const decide = async (r, approve) => {
    if (busyReg[r.id]) return;
    setBusyReg((s) => ({ ...s, [r.id]: true }));
    try {
      if (approve) await venueApproveTeamRegistration(venueId, r.id);
      else await venueRejectTeamRegistration(venueId, r.id, null);
      toast?.({
        icon: approve ? "check" : "x",
        text: `${r.team_name || "Team"} ${approve ? "approved" : "declined"}`,
        sub: r.competition_name || "",
      });
      await load();
    } catch {
      toast?.({ icon: "alert", text: "Couldn't update — try again" });
    } finally {
      setBusyReg((s) => ({ ...s, [r.id]: false }));
    }
  };

  // ── One-tap acknowledge ("I'm on it") ──
  const acknowledge = async (inc) => {
    if (ackBusy[inc.id] || inc.acknowledged_at) return;
    setAckBusy((s) => ({ ...s, [inc.id]: true }));
    try {
      await venueTriageIncident(venueId, inc.id, { acknowledge: true });
      toast?.({ icon: "check", text: "Acknowledged — you're on it" });
      await load();
    } catch {
      toast?.({ icon: "alert", text: "Couldn't acknowledge — try again" });
    } finally {
      setAckBusy((s) => ({ ...s, [inc.id]: false }));
    }
  };

  // ── Open the Assign sheet, lazy-loading venue staff once ──
  const openAssign = async (inc) => {
    setAssigning(inc);
    if (staff === null) {
      try { const res = await venueListAssignableStaff(venueId); setStaff(res?.staff || []); }
      catch { setStaff([]); }
    }
  };

  return (
    <div>
      {/* ── stat strip ── */}
      <div style={{ display: "flex", gap: 10, overflowX: "auto", padding: "8px 0 2px", scrollbarWidth: "none" }}>
        <StatTile tone="live" live label="Live now" value={live.length} sub="in play" onClick={() => scrollTo(liveRef)} />
        <StatTile tone="amber" label="To assign" value={toAssign} sub="pitch / ref" onClick={() => scrollTo(liveRef)} />
        <StatTile tone="ink" label="Issues" value={issues} sub={`${regs.length} regs · ${incidents.length} alerts`} onClick={() => scrollTo(issuesRef)} />
        <StatTile tone="amber" label="Outstanding" value={gbp(outstanding)} sub="this cycle" mono onClick={onNavigate ? () => onNavigate("payments") : undefined} />
      </div>

      {/* ── LIVE NOW ── */}
      <div ref={liveRef}>
        <SecHead title="Live now" meta={live.length ? `${live.length} of ${tonight.length}` : "tonight"} />
      </div>
      {live.length === 0 ? (
        <div className="m-card" style={{ padding: "16px 15px", display: "flex", alignItems: "center", gap: 13 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 13, flex: "none", background: "var(--s4)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}><MIcon name="clock" size={20} color="var(--ink3)" /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>No match in play</div>
            <div style={{ fontSize: 12.5, color: "var(--ink3)", marginTop: 2 }}>
              {tonight.length ? `${tonight.length} fixture${tonight.length === 1 ? "" : "s"} scheduled tonight` : "Quiet night at the venue"}
            </div>
          </div>
        </div>
      ) : live.map((f) => (
        <button key={f.id} onClick={() => toast?.({ icon: "pulse", text: "Live match view coming soon" })}
          className="m-card" style={{ width: "100%", textAlign: "left", cursor: "pointer", padding: "12px 14px", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span className="m-eyebrow">{f.round_name || pitchById[f.playing_area_id]?.name || "Match"}</span>
            <span style={{
              height: 20, padding: "0 8px", borderRadius: "var(--r-pill)", display: "inline-flex", alignItems: "center", gap: 5,
              background: "var(--live-soft)", color: "var(--live-ink)", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.04em",
            }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--live)" }} />LIVE</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              <TeamRow team={teams[f.home_team_id]} name={teamName(f.home_team_id)} />
              <TeamRow team={teams[f.away_team_id]} name={teamName(f.away_team_id)} />
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--ink)", flex: "none", fontVariantNumeric: "tabular-nums" }}>
              {f.home_score ?? 0}<span style={{ color: "var(--ink4)", margin: "0 4px" }}>:</span>{f.away_score ?? 0}
            </div>
          </div>
        </button>
      ))}

      {/* ── NEEDS YOU ── */}
      <div ref={issuesRef} style={{ scrollMarginTop: 12 }}>
        <SecHead title="Needs you" meta={issues ? `${issues} item${issues === 1 ? "" : "s"}` : ""} />
      </div>
      {/* Log an issue — always available (reuses venue_log_incident, the desktop path). */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -6, marginBottom: 12 }}>
        <button onClick={() => setAddIssue(true)} style={{
          height: 32, padding: "0 12px", borderRadius: "var(--r-pill)", cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--m-font)", fontWeight: 700, fontSize: 12.5,
          background: "var(--amber-soft)", color: "var(--amber)", border: "1px solid var(--amber-glow)",
        }}>
          <MIcon name="plus" size={14} color="var(--amber)" /> Log issue
        </button>
      </div>
      {issues === 0 && (
        <div className="m-card" style={{ padding: "24px 18px", textAlign: "center" }}>
          <MIcon name="check" size={26} color="var(--ok)" />
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8, color: "var(--ink2)" }}>All clear — nothing needs you</div>
        </div>
      )}
      {regs.length > 0 && <div className="m-eyebrow" style={{ margin: "2px 2px 9px" }}>New registrations · swipe</div>}
      {regs.map((r) => {
        const busy = !!busyReg[r.id];
        return (
          <SwipeRow key={`reg-${r.id}`} disabled={busy} onApprove={() => decide(r, true)} onDecline={() => decide(r, false)}>
            <div className="m-card" style={{ padding: "13px 14px", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 38, height: 38, borderRadius: 11, flex: "none", background: "var(--amber-soft)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}><MIcon name="shield" size={19} color="var(--amber)" /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.team_name || "New team"}</div>
                <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {[r.competition_name, r.captain_email].filter(Boolean).join(" · ") || "Pending registration"}
                </div>
              </div>
              <div style={{ display: "flex", gap: 7, flex: "none" }}>
                <IconAction icon="x" tone="live" busy={busy} onClick={() => decide(r, false)} aria="Decline" />
                <IconAction icon="check" tone="ok" busy={busy} onClick={() => decide(r, true)} aria="Approve" />
              </div>
            </div>
          </SwipeRow>
        );
      })}
      {incidents.length > 0 && <div className="m-eyebrow" style={{ margin: "14px 2px 9px" }}>Open issues</div>}
      {incidents.map((inc) => {
        const crit = inc.severity === "critical";
        const acked = !!inc.acknowledged_at;
        const escalated = !!inc.escalated_at;
        return (
          <div key={`inc-${inc.id}`} className="m-card" style={{ padding: "13px 14px", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%", marginTop: 5, flex: "none",
                background: crit ? "var(--live)" : "var(--amber)",
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{inc.description}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
                  <TriagePill text={inc.priority || "normal"} tone={PRIORITY_TONE[inc.priority] || "var(--ink3)"} />
                  {inc.category && <TriagePill text={CATEGORIES.find(([v]) => v === inc.category)?.[1] || inc.category} />}
                  {escalated && <TriagePill text="Escalated" tone="var(--live)" />}
                  {acked && <TriagePill text="Ack'd" tone="var(--ok)" />}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 5 }}>
                  {(inc.severity || "info")}
                  {inc.assigned_to_name ? ` · ${inc.assigned_to_name}` : " · unassigned"}
                  {inc.reported_by_name ? ` · by ${inc.reported_by_name}` : ""}
                </div>
              </div>
              {/* Card-level safeguarding flag — a shield icon-button, distinct from
                  the triage row; opens a confirm sheet, never a direct write. */}
              <button onClick={() => setFlagging(inc)} aria-label="Flag as safeguarding"
                title="Flag as a child-protection / welfare concern" style={{
                  width: 34, height: 34, borderRadius: 10, flex: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "var(--s3)", border: "1px solid var(--hair2)",
                }}>
                <MIcon name="shield" size={17} color="var(--ink2)" />
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 11 }}>
              <TriageAction icon="check" label={acked ? "Ack'd" : "Ack"} on={acked} busy={!!ackBusy[inc.id]} onClick={() => acknowledge(inc)} />
              <TriageAction icon="users" label="Assign" onClick={() => openAssign(inc)} />
              {!escalated && <TriageAction icon="flag" label="Escalate" onClick={() => setEscalating(inc)} />}
              <button onClick={() => setResolving(inc)} style={{
                flex: 1, height: 36, borderRadius: "var(--r-pill)", cursor: "pointer",
                background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 800, fontSize: 13, fontFamily: "var(--m-font)",
              }}>Resolve</button>
            </div>
          </div>
        );
      })}

      {/* ── COMING UP ── */}
      {upcoming.length > 0 && (
        <>
          <SecHead title="Coming up" meta="tonight" />
          {upcoming.map((f) => {
            const pitch = pitchById[f.playing_area_id];
            const ref = refById[f.official_id];
            return (
              <div key={f.id} className="m-card" style={{ padding: "12px 14px", marginBottom: 10, display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 46, flex: "none", textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink2)" }}>{f.kickoff_time ? f.kickoff_time.slice(0, 5) : "TBC"}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", flex: "none" }}>
                  <Crest team={teams[f.home_team_id]} name={teamName(f.home_team_id)} />
                  <div style={{ marginLeft: -7 }}><Crest team={teams[f.away_team_id]} name={teamName(f.away_team_id)} /></div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {teamName(f.home_team_id)} <span style={{ color: "var(--ink4)" }}>v</span> {teamName(f.away_team_id)}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 5 }}>
                    <AssignChip ok={!!pitch} okText={pitch?.name} warnText="No pitch" />
                    <AssignChip ok={!!ref} okText={ref?.name} warnText="No ref" />
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}

      {resolving && (
        <ResolveSheet
          inc={resolving}
          venueId={venueId}
          onClose={() => setResolving(null)}
          onDone={async () => { setResolving(null); await load(); }}
          toast={toast}
        />
      )}
      {assigning && (
        <AssignSheet
          inc={assigning}
          venueId={venueId}
          staff={staff}
          onClose={() => setAssigning(null)}
          onDone={async () => { setAssigning(null); await load(); }}
          toast={toast}
        />
      )}
      {escalating && (
        <EscalateSheet
          inc={escalating}
          venueId={venueId}
          onClose={() => setEscalating(null)}
          onDone={async () => { setEscalating(null); await load(); }}
          toast={toast}
        />
      )}
      {flagging && (
        <FlagSafeguardingSheet
          inc={flagging}
          venueId={venueId}
          onClose={() => setFlagging(null)}
          onDone={async () => { setFlagging(null); await load(); }}
          toast={toast}
        />
      )}
      {addIssue && (
        <AddIssueSheet
          venueId={venueId}
          onClose={() => setAddIssue(false)}
          onDone={async () => { setAddIssue(false); await load(); }}
          toast={toast}
        />
      )}
    </div>
  );
}

// Log a new venue issue (reuses venue_log_incident — the desktop Operations path).
// Severity is the RPC's enum: info | warning | critical.
function AddIssueSheet({ venueId, onClose, onDone, toast }) {
  const [desc, setDesc] = useState("");
  const [severity, setSeverity] = useState("warning");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const SEVS = [["info", "Info", "var(--ink3)"], ["warning", "Warning", "var(--amber)"], ["critical", "Critical", "var(--live)"]];
  const submit = async () => {
    if (savingRef.current) return;
    if (!desc.trim()) { toast?.({ icon: "alert", text: "Describe the issue first" }); return; }
    savingRef.current = true; setSaving(true);
    try {
      await venueLogIncident(venueId, desc.trim(), severity);
      toast?.({ icon: "check", text: "Issue logged" });
      onDone();
    } catch (e) {
      console.error("[ops] venue_log_incident failed", e);
      toast?.({ icon: "alert", text: "Couldn't log the issue", sub: "Try again" });
      savingRef.current = false; setSaving(false);
    }
  };
  return (
    <MobileSheet title="Log an issue" onClose={saving ? undefined : onClose} footer={
      <button onClick={submit} disabled={saving} style={{
        width: "100%", height: 48, borderRadius: 14, border: "none", cursor: saving ? "default" : "pointer",
        fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 15, background: "var(--amber)", color: "var(--amber-ink)", opacity: saving ? 0.6 : 1,
      }}>{saving ? "Logging…" : "Log issue"}</button>
    }>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink3)", margin: "4px 2px 6px" }}>What's happening?</div>
      <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3}
        placeholder="e.g. Floodlight bank C flickering on pitch 2"
        style={{ width: "100%", padding: "11px 13px", borderRadius: 12, boxSizing: "border-box", resize: "vertical",
          background: "var(--s2)", border: "1px solid var(--hair)", color: "var(--ink)", fontFamily: "var(--m-font)", fontSize: 15, outline: "none" }} />
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink3)", margin: "14px 2px 6px" }}>Severity</div>
      <div style={{ display: "flex", gap: 8 }}>
        {SEVS.map(([id, label, col]) => {
          const on = severity === id;
          return (
            <button key={id} onClick={() => setSeverity(id)} style={{
              flex: 1, padding: "10px 0", borderRadius: 12, cursor: "pointer", fontFamily: "var(--m-font)", fontSize: 13.5, fontWeight: 700,
              background: on ? "var(--amber-soft)" : "var(--s2)", color: on ? col : "var(--ink3)",
              border: "1px solid", borderColor: on ? col : "var(--hair)",
            }}>{label}</button>
          );
        })}
      </div>
    </MobileSheet>
  );
}

// Labelled one-tap triage action button (Ack / Assign / Escalate).
function TriageAction({ icon, label, on, busy, onClick }) {
  return (
    <button onClick={onClick} disabled={busy} style={{
      flex: 1, height: 36, borderRadius: "var(--r-pill)", cursor: busy ? "default" : "pointer",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      background: on ? "var(--ok-soft)" : "var(--s3)", border: "1px solid var(--hair2)",
      color: on ? "var(--ok-ink)" : "var(--ink2)", fontWeight: 700, fontSize: 12.5, fontFamily: "var(--m-font)", opacity: busy ? 0.5 : 1,
    }}>
      <MIcon name={icon} size={15} color={on ? "var(--ok-ink)" : "var(--ink2)"} />{label}
    </button>
  );
}

function TeamRow({ team, name }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
      <Crest team={team} name={name} size={24} r={7} />
      <span style={{ fontSize: 14.5, fontWeight: 600, color: "var(--ink2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
    </div>
  );
}

function StatTile({ tone, label, value, sub, live, mono, onClick }) {
  const col = tone === "live" ? "var(--live)" : tone === "amber" ? "var(--amber)" : "var(--ink)";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className="m-card" style={{
      flex: "none", width: 122, padding: "13px 13px", display: "flex", flexDirection: "column", gap: 6,
      textAlign: "left", cursor: onClick ? "pointer" : "default", fontFamily: "var(--m-font)", color: "inherit",
    }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {live && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--live)", flex: "none" }} />}
        <span className="m-eyebrow" style={{ fontSize: 10.5 }}>{label}</span>
      </span>
      <div style={{ fontSize: mono ? 22 : 28, fontWeight: 800, letterSpacing: "-0.03em", color: col, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 11.5, color: "var(--ink3)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
    </Tag>
  );
}

function SecHead({ title, meta }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "22px 2px 11px" }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em", margin: 0 }}>{title}</h2>
      {meta ? <span style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 600 }}>{meta}</span> : null}
    </div>
  );
}

function AssignChip({ ok, okText, warnText }) {
  return (
    <span style={{
      height: 21, fontSize: 11, padding: "0 8px", borderRadius: "var(--r-pill)", display: "inline-flex", alignItems: "center", fontWeight: 700,
      background: ok ? "var(--s3)" : "var(--amber-soft)",
      color: ok ? "var(--ink2)" : "var(--amber)",
    }}>{ok ? (okText || "Set") : warnText}</span>
  );
}

function IconAction({ icon, tone, busy, onClick, aria }) {
  const soft = tone === "ok" ? "var(--ok-soft)" : "var(--live-soft)";
  const ink = tone === "ok" ? "var(--ok-ink)" : "var(--live-ink)";
  return (
    <button onClick={onClick} disabled={busy} aria-label={aria} style={{
      width: 34, height: 34, borderRadius: 10, flex: "none", cursor: busy ? "default" : "pointer",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: soft, border: "none", opacity: busy ? 0.5 : 1,
    }}><MIcon name={icon} size={16} color={ink} /></button>
  );
}

function ResolveSheet({ inc, venueId, onClose, onDone, toast }) {
  const [outcome, setOutcome] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const crit = inc.severity === "critical";

  const resolve = async () => {
    if (!outcome || busy) return;
    setBusy(true);
    try {
      await venueResolveIncident(venueId, inc.id, outcome, note.trim() || null);
      toast?.({ icon: "check", text: "Issue resolved", sub: OUTCOMES.find((o) => o.id === outcome)?.label });
      await onDone();
    } catch {
      toast?.({ icon: "alert", text: "Couldn't resolve — try again" });
      setBusy(false);
    }
  };

  return (
    <MobileSheet title="Resolve issue" onClose={busy ? undefined : onClose} footer={
      <button onClick={resolve} disabled={!outcome || busy} style={{
        width: "100%", height: 48, borderRadius: 14, border: "none", cursor: outcome && !busy ? "pointer" : "default",
        fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 15,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        background: outcome ? "var(--amber)" : "var(--s3)", color: outcome ? "var(--amber-ink)" : "var(--ink3)", opacity: busy ? 0.7 : 1,
      }}>
        {outcome ? <><MIcon name="check" size={17} color="var(--amber-ink)" />{busy ? "Resolving…" : "Mark resolved"}</> : "Choose an outcome"}
      </button>
    }>
      <div className="m-card" style={{ padding: "13px 14px", display: "flex", alignItems: "flex-start", gap: 11, background: "var(--s2)" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", marginTop: 5, flex: "none", background: crit ? "var(--live)" : "var(--amber)" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.3 }}>{inc.description}</div>
          <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 2 }}>{inc.severity || "info"}{inc.reported_by_name ? ` · ${inc.reported_by_name}` : ""}</div>
        </div>
      </div>

      <div className="m-eyebrow" style={{ margin: "16px 2px 9px" }}>Outcome</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {OUTCOMES.map((o) => {
          const on = outcome === o.id;
          return (
            <button key={o.id} onClick={() => setOutcome(o.id)} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "12px 13px", borderRadius: 14, cursor: "pointer", textAlign: "left",
              background: "var(--s2)", border: "1px solid", borderColor: on ? "var(--amber)" : "var(--hair)", fontFamily: "var(--m-font)", color: "inherit",
            }}>
              <span style={{
                width: 38, height: 38, borderRadius: 11, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
                background: on ? "var(--amber)" : "var(--s3)",
              }}><MIcon name={o.icon} size={18} color={on ? "var(--amber-ink)" : "var(--ink2)"} /></span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", display: "block" }}>{o.label}</span>
                <span style={{ fontSize: 12.5, color: "var(--ink3)", display: "block", marginTop: 1 }}>{o.desc}</span>
              </span>
              {on && <MIcon name="check" size={18} color="var(--amber)" />}
            </button>
          );
        })}
      </div>

      <div className="m-eyebrow" style={{ margin: "16px 2px 9px" }}>Resolution note · optional</div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done, by whom, any follow-up…"
        style={{
          width: "100%", minHeight: 88, padding: "12px 14px", borderRadius: 14, resize: "none", lineHeight: 1.45,
          background: "var(--s2)", border: "1px solid var(--hair)", color: "var(--ink)", fontFamily: "var(--m-font)", fontSize: 14, boxSizing: "border-box",
        }} />
      <SafeguardingNotice />
    </MobileSheet>
  );
}

// Assign sheet — pick a colleague from the venue's staff (mig 465 read).
function AssignSheet({ inc, venueId, staff, onClose, onDone, toast }) {
  const [busy, setBusy] = useState(false);
  const assign = async (userId) => {
    if (busy) return;
    setBusy(true);
    try {
      await venueTriageIncident(venueId, inc.id, { assignedTo: userId });
      toast?.({ icon: "check", text: "Assigned" });
      await onDone();
    } catch {
      toast?.({ icon: "alert", text: "Couldn't assign — try again" });
      setBusy(false);
    }
  };
  const list = staff || [];
  return (
    <MobileSheet title="Assign to" onClose={busy ? undefined : onClose}>
      <div className="m-card" style={{ padding: "13px 14px", background: "var(--s2)" }}>
        <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{inc.description}</div>
      </div>
      {staff === null ? (
        <p style={{ color: "var(--ink3)", fontSize: 13.5, margin: "16px 2px" }}>Loading staff…</p>
      ) : list.length === 0 ? (
        <p style={{ color: "var(--ink3)", fontSize: 13.5, margin: "16px 2px" }}>No assignable staff on this venue yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
          {list.map((s) => {
            const on = inc.assigned_to === s.user_id;
            return (
              <button key={s.user_id} onClick={() => assign(s.user_id)} disabled={busy} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "12px 13px", borderRadius: 14, cursor: busy ? "default" : "pointer", textAlign: "left",
                background: "var(--s2)", border: "1px solid", borderColor: on ? "var(--amber)" : "var(--hair)", fontFamily: "var(--m-font)", color: "inherit", opacity: busy ? 0.6 : 1,
              }}>
                <span style={{
                  width: 36, height: 36, borderRadius: 11, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--s3)",
                }}><MIcon name="users" size={17} color="var(--ink2)" /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
                  <span style={{ fontSize: 12.5, color: "var(--ink3)", display: "block", marginTop: 1 }}>{s.role}</span>
                </span>
                {on && <MIcon name="check" size={18} color="var(--amber)" />}
              </button>
            );
          })}
        </div>
      )}
    </MobileSheet>
  );
}

// Escalate sheet — push to HQ with an optional reason.
function EscalateSheet({ inc, venueId, onClose, onDone, toast }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const escalate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await venueEscalateIncident(venueId, inc.id, reason.trim() || null);
      toast?.({ icon: "check", text: "Escalated to HQ" });
      await onDone();
    } catch {
      toast?.({ icon: "alert", text: "Couldn't escalate — try again" });
      setBusy(false);
    }
  };
  return (
    <MobileSheet title="Escalate to HQ" onClose={busy ? undefined : onClose} footer={
      <button onClick={escalate} disabled={busy} style={{
        width: "100%", height: 48, borderRadius: 14, border: "none", cursor: busy ? "default" : "pointer",
        fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 15,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        background: "var(--amber)", color: "var(--amber-ink)", opacity: busy ? 0.7 : 1,
      }}>
        <MIcon name="flag" size={17} color="var(--amber-ink)" />{busy ? "Escalating…" : "Escalate to HQ"}
      </button>
    }>
      <div className="m-card" style={{ padding: "13px 14px", background: "var(--s2)" }}>
        <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{inc.description}</div>
        <div style={{ fontSize: 12.5, color: "var(--ink3)", marginTop: 4 }}>HQ will see this in their cross-venue escalation inbox.</div>
      </div>
      <div className="m-eyebrow" style={{ margin: "16px 2px 9px" }}>Reason · optional</div>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. contractor needed — beyond what we can fix tonight"
        style={{
          width: "100%", minHeight: 80, padding: "12px 14px", borderRadius: 14, resize: "none", lineHeight: 1.45,
          background: "var(--s2)", border: "1px solid var(--hair)", color: "var(--ink)", fontFamily: "var(--m-font)", fontSize: 14, boxSizing: "border-box",
        }} />
    </MobileSheet>
  );
}

// Flag-safeguarding sheet — one-tap route of a welfare concern to the venue's
// designated leads. Reuses venueFlagSafeguarding (mig 467): ANY venue caller may
// flag; it atomically evicts the incident from the ops queue. Content-free toast
// on success (the concern's detail never appears in the confirmation). Mobile
// Lead-review view is a deferred fast-follow — this surface only flags. v1 stores
// NO free-text disclosure beyond the operator-entered description.
function FlagSafeguardingSheet({ inc, venueId, onClose, onDone, toast }) {
  const [busy, setBusy] = useState(false);
  const flag = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await venueFlagSafeguarding(venueId, inc.id);
      toast?.({ icon: "shield", text: "Routed to safeguarding" });
      await onDone();
    } catch (e) {
      const already = String(e?.message || "").includes("already_flagged");
      toast?.({ icon: already ? "shield" : "alert", text: already ? "Already flagged for safeguarding" : "Couldn't flag — try again" });
      // already_flagged means it IS flagged server-side (e.g. from another device) —
      // evict it from this view too by reloading + closing; only a genuine error
      // keeps the sheet open to retry.
      if (already) await onDone();
      else setBusy(false);
    }
  };
  return (
    <MobileSheet title="Flag as safeguarding" onClose={busy ? undefined : onClose} footer={
      <button onClick={flag} disabled={busy} style={{
        width: "100%", height: 48, borderRadius: 14, border: "none", cursor: busy ? "default" : "pointer",
        fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 15,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        background: "var(--amber)", color: "var(--amber-ink)", opacity: busy ? 0.7 : 1,
      }}>
        <MIcon name="shield" size={17} color="var(--amber-ink)" />{busy ? "Flagging…" : "Flag as safeguarding"}
      </button>
    }>
      <div className="m-card" style={{ padding: "13px 14px", background: "var(--s2)" }}>
        <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{inc.description}</div>
      </div>
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ fontSize: 14, color: "var(--ink)", lineHeight: 1.45, margin: 0 }}>
          This removes the issue from the normal queue and routes it privately to your venue's
          designated safeguarding lead(s). <strong>You won't be able to see or reopen it here.</strong>
        </p>
        <p style={{ fontSize: 13, color: "var(--ink2)", lineHeight: 1.45, margin: 0 }}>
          Use this for a child-protection or welfare concern. If it also needs an operational
          response (e.g. first aid), log that as a separate issue.
        </p>
        <p style={{ fontSize: 12.5, color: "var(--ink3)", lineHeight: 1.4, margin: 0 }}>
          Flagging does not replace your organisation's safeguarding procedure — follow that too.
        </p>
      </div>
    </MobileSheet>
  );
}
