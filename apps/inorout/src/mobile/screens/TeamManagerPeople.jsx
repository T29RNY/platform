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
import { clubManagerListTeamFixtures, clubManagerGetTeamMembers, clubManagerEnsureTeamInviteLink } from "@platform/core";
import MIcon from "../icons.jsx";
import CoachMemberDetailSheet from "./CoachMemberDetailSheet.jsx";
import TeamManagerSquad from "./TeamManagerSquad.jsx";
import TeamManagerDocs from "./TeamManagerDocs.jsx";

function initials(name) {
  const w = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return (w[0][0] + w[w.length - 1][0]).toUpperCase();
}

export default function TeamManagerPeople({ toast }) {
  const [teamsState, setTeamsState] = useState({ loading: true, error: false, teams: [] });
  const [teamIdx, setTeamIdx] = useState(0);
  const [roster, setRoster] = useState({ loading: false, error: false, members: [] });
  const [openSquad, setOpenSquad] = useState(false);   // drill-in: reliability + Smart Teams
  const [openDocs, setOpenDocs] = useState(false);     // drill-in: compliance / documents
  const [detailFor, setDetailFor] = useState(null);    // row-tap: the member row whose detail sheet is open
  const [sharing, setSharing] = useState(false);
  const sharingRef = useRef(false);

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

  // drill-in: compliance / documents board for the selected team
  if (openDocs && team) {
    return (
      <TeamManagerDocs
        teamId={team.team_id}
        teamName={team.team_name}
        toast={toast}
        onBack={() => setOpenDocs(false)}
      />
    );
  }

  const members = roster.members;

  // Share the team's join link. Coach-auth get-or-create (mig 527) → the same /q/<code>
  // public join flow an admin's link uses. Native share sheet when available, else clipboard.
  const shareLink = async () => {
    if (sharingRef.current || !team) return;
    sharingRef.current = true; setSharing(true);
    try {
      const res = await clubManagerEnsureTeamInviteLink(team.team_id);
      const code = res?.code;
      if (!code) throw new Error("no code");
      const url = `${window.location.origin}/q/${code}`;
      if (navigator.share) {
        try { await navigator.share({ title: `Join ${team.team_name}`, text: `Join ${team.team_name} on In or Out`, url }); }
        catch { /* user dismissed the share sheet — not an error */ }
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        toast?.({ icon: "check", text: "Join link copied." });
      } else {
        toast?.({ icon: "info", text: url });
      }
    } catch (e) {
      console.error("[people] ensure invite link failed", e);
      toast?.({ icon: "alert", text: "Couldn't create the join link." });
    } finally { sharingRef.current = false; setSharing(false); }
  };

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
        width: "100%", marginBottom: 8, padding: "11px", borderRadius: "var(--r-pill)", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)",
        fontFamily: "var(--m-font)", fontSize: 13.5, fontWeight: 700,
      }}>
        Reliability &amp; Smart Teams
        <MIcon name="chevron" size={14} color="var(--amber)" />
      </button>

      <button onClick={() => setOpenDocs(true)} style={{
        width: "100%", marginBottom: 8, padding: "11px", borderRadius: "var(--r-pill)", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        background: "var(--s3)", border: "1px solid var(--hair2)", color: "var(--ink2)",
        fontFamily: "var(--m-font)", fontSize: 13.5, fontWeight: 700,
      }}>
        <MIcon name="shield" size={15} color="var(--ink2)" />
        Documents &amp; clearance
        <MIcon name="chevron" size={14} color="var(--ink4)" />
      </button>

      <button onClick={shareLink} disabled={sharing} style={{
        width: "100%", marginBottom: 12, padding: "11px", borderRadius: "var(--r-pill)",
        cursor: sharing ? "default" : "pointer", opacity: sharing ? 0.6 : 1,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
        background: "var(--s3)", border: "1px solid var(--hair2)", color: "var(--ink2)",
        fontFamily: "var(--m-font)", fontSize: 13.5, fontWeight: 700,
      }}>
        <MIcon name="qr" size={15} color="var(--ink2)" />
        {sharing ? "Getting link…" : "Share join link"}
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
        <CoachMemberDetailSheet
          memberProfileId={detailFor.profile_id}
          name={`${detailFor.first_name || ""} ${detailFor.last_name || ""}`.trim() || "Player"}
          hasMedical={detailFor.has_medical_notes}
          onClose={() => setDetailFor(null)}
        />
      )}
    </div>
  );
}
