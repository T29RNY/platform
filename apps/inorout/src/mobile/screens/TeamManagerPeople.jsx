// TeamManagerPeople.jsx — Team-manager track, "People" tab (/hub, tab "people").
//
// Club Manager epic PR #4: the coach's squad roster — who's in the team, with a
// discreet medical-notes flag so the coach knows to check before a session. Team
// list comes from the same coach-scoped fixtures reader (for team_id + name);
// the roster from club_manager_get_team_members(team_id) (mig 306), coach-gated
// server-side. Additive: new screen over existing wrappers, no edits
// to any existing screen. Renders inside [data-surface="mobile"] (amber tokens).
//
// ROW-TAP DETAIL (this pass): each roster row opens a member-detail bottom-sheet
// mirroring the coach's DESKTOP-equivalent contract 1:1 — the SAME fields the coach
// already sees on SessionsScreen's medical panel (apps/inorout/src/views/SessionsScreen.jsx),
// read via the existing clubManagerGetMemberDetail wrapper (club_manager_get_member_detail,
// mig 306): DOB, medical (conditions/allergies/medications/GP/SEND), emergency contact,
// parent/guardian. No new backend — the RPC + wrapper already exist and are coach-gated
// (two-tier scope: own-team members at minimum). Sheet uses the shared MobileSheet so its
// scrim escapes .m-scroll and clears the docked nav (reference_hub_sheet_nav_ios_stacking).

import { useState, useEffect, useCallback, useRef } from "react";
import { clubManagerListTeamFixtures, clubManagerGetTeamMembers, clubManagerGetMemberDetail } from "@platform/core";
import MIcon from "../icons.jsx";
import MobileSheet from "../MobileSheet.jsx";
import TeamManagerSquad from "./TeamManagerSquad.jsx";

function initials(name) {
  const w = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
}

// "1990-04-05" → "34" (whole years). Null-safe; returns null on unparseable input.
function ageFromDob(dob) {
  if (!dob) return null;
  const [y, m, d] = String(dob).split("-").map(Number);
  if (!y || !m || !d) return null;
  const now = new Date();
  let a = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a -= 1;
  return a >= 0 && a < 130 ? a : null;
}

// "1990-04-05" → "5 Apr 1990". Local date parts, no TZ shift.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDob(dob) {
  if (!dob) return null;
  const [y, m, d] = String(dob).split("-").map(Number);
  if (!y || !m || !d) return null;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export default function TeamManagerPeople({ toast }) {
  const [teamsState, setTeamsState] = useState({ loading: true, error: false, teams: [] });
  const [teamIdx, setTeamIdx] = useState(0);
  const [roster, setRoster] = useState({ loading: false, error: false, members: [] });
  const [openSquad, setOpenSquad] = useState(false);   // drill-in: reliability + Smart Teams
  const [detailFor, setDetailFor] = useState(null);    // row-tap: the member row whose detail sheet is open
  const [detailCache, setDetailCache] = useState({});  // profile_id → "loading" | "error" | detailObj (fetched once, kept)
  const fetchedRef = useRef(new Set());                // profile_ids already fetched — a ref so it stays current WITHOUT being an effect dep

  // Fetch the tapped member's full detail once (coach-gated RPC), cache by profile_id
  // so re-opening the same person is instant. Depends ONLY on detailFor: detailCache is
  // deliberately NOT a dep — if it were, setting "loading" would mutate a dep and tear the
  // effect down before the fetch settled, leaving the sheet stuck on "Loading…". No
  // cancelled/cleanup guard is needed: every fetch writes ONLY its own pid's slot via the
  // functional updater, so a late resolve can never stomp another member (we render
  // detailCache[detailFor.profile_id]). fetchedRef (a ref, always current, never a dep)
  // dedupes; on error it drops the id so a re-tap retries.
  useEffect(() => {
    const pid = detailFor?.profile_id;
    if (!pid || fetchedRef.current.has(pid)) return;
    fetchedRef.current.add(pid);
    setDetailCache((c) => ({ ...c, [pid]: "loading" }));
    clubManagerGetMemberDetail(pid)
      .then((d) => setDetailCache((c) => ({ ...c, [pid]: d || "error" })))
      .catch(() => {
        fetchedRef.current.delete(pid);
        setDetailCache((c) => ({ ...c, [pid]: "error" }));
      });
  }, [detailFor]);

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

  const rosterReqRef = useRef(0);
  const loadRoster = useCallback(async () => {
    if (!teamId) { setRoster({ loading: false, error: false, members: [] }); return; }
    const reqId = ++rosterReqRef.current;   // guard: a slow response for a previous team must not stomp the current one
    setRoster({ loading: true, error: false, members: [] });
    try {
      const rows = await clubManagerGetTeamMembers(teamId, null);
      if (reqId !== rosterReqRef.current) return;
      setRoster({ loading: false, error: false, members: Array.isArray(rows) ? rows : [] });
    } catch {
      if (reqId !== rosterReqRef.current) return;
      setRoster({ loading: false, error: true, members: [] });
    }
  }, [teamId]);
  useEffect(() => { loadRoster(); }, [loadRoster]);

  if (teamsState.loading) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">People</div>
        <p style={{ color: "var(--ink3)", fontSize: 14, marginTop: 8 }}>Loading your squad…</p>
      </div>
    );
  }
  if (teamsState.error) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">People</div>
        <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>Couldn't load your teams right now.</p>
        <button onClick={loadTeams} style={{
          marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
          background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 13.5,
        }}>Try again</button>
      </div>
    );
  }
  if (!team) {
    return (
      <div className="m-card" style={{ marginTop: 8 }}>
        <div className="m-eyebrow">People</div>
        <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>No teams to manage yet.</p>
      </div>
    );
  }

  // drill-in: reliability board + Smart-Teams balancer for the selected team
  if (openSquad && team) {
    return (
      <TeamManagerSquad
        teamId={team.team_id}
        teamName={team.team_name}
        toast={toast}
        onBack={() => setOpenSquad(false)}
      />
    );
  }

  const members = roster.members;

  return (
    <div>
      {teams.length > 1 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 2px 4px" }}>
          {teams.map((t, i) => {
            const on = i === teamIdx;
            return (
              <button key={t.team_id} onClick={() => setTeamIdx(i)} style={{
                height: 32, padding: "0 14px", borderRadius: "var(--r-pill)", cursor: "pointer",
                fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 700, border: "1px solid",
                background: on ? "var(--amber-soft)" : "transparent",
                color: on ? "var(--amber)" : "var(--ink3)",
                borderColor: on ? "var(--amber-glow)" : "var(--hair2)",
              }}>{t.team_name}</button>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "16px 2px 11px" }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em", margin: 0 }}>{team.team_name}</h2>
        {!roster.loading && !roster.error && <span style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 600 }}>{members.length} player{members.length === 1 ? "" : "s"}</span>}
      </div>

      <button onClick={() => setOpenSquad(true)} style={{
        width: "100%", marginBottom: 12, padding: "11px", borderRadius: "var(--r-pill)", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)",
        fontFamily: "var(--m-font)", fontSize: 13.5, fontWeight: 700,
      }}>
        Reliability &amp; Smart Teams
        <MIcon name="chevron" size={14} color="var(--amber)" />
      </button>

      {roster.loading && (
        <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5 }}>Loading squad…</div>
      )}
      {roster.error && (
        <div className="m-card" style={{ padding: "14px 15px" }}>
          <p style={{ color: "var(--ink2)", fontSize: 13.5, margin: 0 }}>Couldn't load the squad.</p>
          <button onClick={loadRoster} style={{
            marginTop: 10, padding: "8px 14px", borderRadius: "var(--r-pill)", cursor: "pointer",
            background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 13,
          }}>Try again</button>
        </div>
      )}
      {!roster.loading && !roster.error && members.length === 0 && (
        <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5 }}>No players in this squad yet.</div>
      )}
      {!roster.loading && !roster.error && members.length > 0 && (
        <div className="m-card" style={{ padding: "6px 4px" }}>
          {members.map((m) => {
            const name = `${m.first_name || ""} ${m.last_name || ""}`.trim() || "Player";
            return (
              <button key={m.profile_id} onClick={() => setDetailFor(m)} style={{
                width: "100%", textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer",
                background: "transparent", border: "none", display: "flex", alignItems: "center", gap: 11, padding: "9px 10px",
              }}>
                <span style={{
                  width: 32, height: 32, borderRadius: 10, flex: "none", display: "flex", alignItems: "center",
                  justifyContent: "center", background: "var(--s4)", color: "var(--ink3)", fontSize: 12, fontWeight: 800,
                }}>{initials(name)}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
                {m.has_medical_notes && (
                  <span title="Has medical notes" style={{
                    height: 22, padding: "0 9px", borderRadius: "var(--r-pill)", flex: "none",
                    display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700,
                    background: "var(--amber-soft)", color: "var(--amber)",
                  }}>
                    <MIcon name="alert" size={12} color="var(--amber)" />medical
                  </span>
                )}
                <MIcon name="chevron" size={16} color="var(--ink4)" />
              </button>
            );
          })}
        </div>
      )}

      {detailFor && (
        <MemberDetailSheet
          member={detailFor}
          detail={detailCache[detailFor.profile_id]}
          onClose={() => setDetailFor(null)}
        />
      )}
    </div>
  );
}

// ── Member detail sheet — mirrors the coach's SessionsScreen medical panel 1:1
// (apps/inorout/src/views/SessionsScreen.jsx): DOB/age, medical block, emergency
// contact, parent/guardian. Fields read from club_manager_get_member_detail (mig 306)
// via the existing wrapper. No writes — clinical fields are read-only for a coach
// (edits stay on the desktop console, DPIA-gated). Renders through MobileSheet so the
// scrim clears the docked nav (reference_hub_sheet_nav_ios_stacking).
function DetailRow({ icon, k, v }) {
  if (v == null || v === "") return null;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "11px 0", borderBottom: "1px solid var(--hair)" }}>
      <MIcon name={icon} size={16} color="var(--ink3)" />
      <span style={{ flex: 1, fontSize: 13, color: "var(--ink3)", fontWeight: 600 }}>{k}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", maxWidth: "62%", textAlign: "right", overflowWrap: "anywhere" }}>{v}</span>
    </div>
  );
}

function MemberDetailSheet({ member, detail, onClose }) {
  const name = `${member.first_name || ""} ${member.last_name || ""}`.trim() || "Player";
  const loading = detail === "loading" || detail == null;
  const error = detail === "error";
  const d = !loading && !error ? detail : null;
  const age = d ? ageFromDob(d.dob) : null;

  const ec1 = d ? [d.ec1_name, d.ec1_relationship, d.ec1_phone].filter(Boolean).join(" · ") : null;
  const guardian = d ? [d.guardian_first_name, d.guardian_last_name, d.guardian_phone].filter(Boolean).join(" ") : null;
  // Does the detail carry anything beyond identity? (used to show a friendly empty state)
  const hasAny = d && (d.medical_conditions || d.allergies || d.medications || d.gp_details || d.send_notes || ec1 || guardian || d.dob);

  return (
    <MobileSheet title="Player" onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 6 }}>
        <span style={{
          width: 52, height: 52, borderRadius: 16, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--s4)", color: "var(--ink3)", fontSize: 18, fontWeight: 800,
        }}>{initials(name)}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
          <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 1 }}>
            {age != null ? `Age ${age}` : "Squad member"}{member.has_medical_notes ? " · has medical notes" : ""}
          </div>
        </div>
      </div>

      {loading && <p style={{ color: "var(--ink3)", fontSize: 14, marginTop: 12 }}>Loading details…</p>}
      {error && <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 12 }}>Couldn't load this player's details.</p>}

      {d && (
        <div style={{ marginTop: 6 }}>
          <DetailRow icon="calendar" k="Date of birth" v={fmtDob(d.dob)} />
          <DetailRow icon="alert" k="Conditions" v={d.medical_conditions} />
          <DetailRow icon="alert" k="Allergies" v={d.allergies} />
          <DetailRow icon="alert" k="Medication" v={d.medications} />
          <DetailRow icon="info" k="GP" v={d.gp_details} />
          <DetailRow icon="info" k="SEND" v={d.send_notes} />
          <DetailRow icon="phone" k="Emergency contact" v={ec1} />
          <DetailRow icon="users" k="Parent / guardian" v={guardian} />
          {!hasAny && (
            <p style={{ color: "var(--ink3)", fontSize: 13.5, marginTop: 12 }}>No additional details on record for this player.</p>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0 4px", color: "var(--ink4)", fontSize: 12.5 }}>
            <MIcon name="key" size={13} color="var(--ink4)" /> Player details are edited on the desktop console.
          </div>
        </div>
      )}
    </MobileSheet>
  );
}
