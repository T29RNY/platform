// ClubAdminComms.jsx — Club-admin track, "Comms" tab, mounted at /hub for a
// club_admin role (Club Console PR #6b). The phone twin of the desktop club lens's
// Comms composer (apps/clubmanager/src/views/Comms.jsx +
// apps/venue/src/views/MembershipsView.jsx), scoped to the ONE club whose shell
// venue the caller owns. THIS SCREEN HAS A WRITE (clubSendAnnouncement).
//
// Compose a club announcement from the phone and queue it to the whole club, a
// single cohort, or a single team. Delivery is the existing outbound broadcast cron
// (email + member push, within ~5 min) — this screen queues the row and shows a
// session-local "sent" list. The inbound / two-way channel stays on the desktop
// console (documented deferral, mirrored from the desktop composer).
//
// AUTH: a club admin passes their shell venue_id as the credential
// (role.entityId → venueToken). Both RPCs authenticate via resolve_venue_caller
// against venue_admins (auth.uid()); the server gates the write on
// manage_memberships and audits it into audit_events (mig 307). No token, no new
// backend — reuses existing venue-token wrappers only.
//
// VERIFIED SIGNATURES (packages/core/storage/supabase.js):
//   clubSendAnnouncement(venueToken, clubId, title, body, audience,
//                        cohortId = null, teamId = null)
//     → rpc club_send_announcement { p_token, p_club_id, p_title, p_body,
//        p_audience, p_cohort_id, p_team_id } → { ok:true, announcement_id }
//     audience ∈ 'club' | 'cohort' | 'team'  (mig 307 CHECK + RPC validation;
//     desktop AUDIENCES const agrees). This screen sends 'club' | 'cohort' | 'team'
//     (teamId passed only for 'team', cohortId only for 'cohort', both null for 'club').
//   clubListCohorts(venueToken, clubId, includeInactive = false)
//     → rpc club_list_cohorts → [{ cohort_id, name, description, min_age,
//        max_age, active, created_at }]  (mig 298); [] when none.
//   clubListTeams(venueToken, clubId, includeArchived = false)
//     → rpc club_list_teams → [{ team_id, name, cohort_name, gender, ... }] (mig 389);
//        [] when none. Picker uses team_id (value) + name (label), 1:1 with the desktop
//        Comms composer (apps/clubmanager/src/views/Comms.jsx).
//
// TOAST: the /hub shell's toast takes the OBJECT form toast({ icon, text })
// (MobileShell.jsx) — matched from ClubAdminToday, not OperatorSetup's string form.

import { useState, useEffect, useCallback, useRef } from "react";
import { clubSendAnnouncement, clubListCohorts, clubListTeams } from "@platform/core";
import MIcon from "../icons.jsx";

const inputStyle = {
  width: "100%", padding: "10px 12px", borderRadius: "var(--r-sm)",
  border: "1px solid var(--hair)", background: "var(--s3)", color: "var(--ink)",
  fontFamily: "var(--m-font)", fontSize: 14, marginTop: 4,
};
const btnPrimary = {
  padding: "13px 16px", borderRadius: "var(--r-sm)", background: "var(--amber)",
  color: "var(--amber-ink)", border: "none", fontFamily: "var(--m-font)", fontWeight: 700, cursor: "pointer",
};

const AUDIENCES = [
  { key: "club", label: "Whole club" },
  { key: "cohort", label: "A cohort" },
  { key: "team", label: "A team" },
];

export default function ClubAdminComms({ venueToken, clubId, clubName, toast }) {
  const [cohortState, setCohortState] = useState({ loading: true, error: false, cohorts: [] });
  const [teamState, setTeamState] = useState({ loading: true, error: false, teams: [] });
  const [audience, setAudience] = useState("club");
  const [cohortId, setCohortId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);
  const [sent, setSent] = useState([]); // session-local log of what we queued

  // Cohorts load in the background — the whole-club send works without them, so we
  // never gate the whole screen on this read (only the cohort branch reacts to it).
  const loadCohorts = useCallback(async () => {
    if (!venueToken || !clubId) { setCohortState({ loading: false, error: false, cohorts: [] }); return; }
    setCohortState((s) => ({ ...s, loading: true, error: false }));
    try {
      const c = await clubListCohorts(venueToken, clubId, false);
      setCohortState({ loading: false, error: false, cohorts: Array.isArray(c) ? c : [] });
    } catch {
      setCohortState({ loading: false, error: true, cohorts: [] });
    }
  }, [venueToken, clubId]);

  // Teams load in the background too — mirrors the desktop composer's clubListTeams
  // (active teams only). The whole-club send never gates on this.
  const loadTeams = useCallback(async () => {
    if (!venueToken || !clubId) { setTeamState({ loading: false, error: false, teams: [] }); return; }
    setTeamState((s) => ({ ...s, loading: true, error: false }));
    try {
      const tm = await clubListTeams(venueToken, clubId, false);
      setTeamState({ loading: false, error: false, teams: Array.isArray(tm) ? tm : [] });
    } catch {
      setTeamState({ loading: false, error: true, teams: [] });
    }
  }, [venueToken, clubId]);

  useEffect(() => { loadCohorts(); loadTeams(); }, [loadCohorts, loadTeams]);

  const { loading, error, cohorts } = cohortState;
  const { loading: teamsLoading, error: teamsError, teams } = teamState;
  const selectedCohort = cohorts.find((c) => c.cohort_id === cohortId) || null;
  const selectedTeam = teams.find((tm) => tm.team_id === teamId) || null;

  // "Who will get this" helper line.
  const audienceHelper =
    audience === "club"
      ? `Everyone at ${clubName || "your club"} — all members, by email and app notification.`
      : audience === "cohort"
        ? selectedCohort
          ? `Members of ${selectedCohort.name} — by email and app notification.`
          : "Pick a cohort above to choose who receives this."
        : selectedTeam
          ? `Members of ${selectedTeam.name} — by email and app notification.`
          : "Pick a team above to choose who receives this.";

  // ── Send the announcement (saving-guard + non-empty validation; keep the form on error) ──
  const send = useCallback(async () => {
    if (savingRef.current) return;
    if (!title.trim()) { toast?.({ icon: "alert", text: "Give the announcement a title" }); return; }
    if (!body.trim()) { toast?.({ icon: "alert", text: "Write a message" }); return; }
    if (audience === "cohort" && !cohortId) { toast?.({ icon: "alert", text: "Pick a cohort" }); return; }
    if (audience === "team" && !teamId) { toast?.({ icon: "alert", text: "Pick a team" }); return; }
    savingRef.current = true; setBusy(true);
    const label = audience === "club" ? "Whole club"
      : audience === "cohort" ? (selectedCohort?.name || "Cohort")
      : (selectedTeam?.name || "Team");
    try {
      await clubSendAnnouncement(
        venueToken, clubId, title.trim(), body.trim(), audience,
        audience === "cohort" ? cohortId : null,
        audience === "team" ? teamId : null,
      );
      setSent((s) => [{ id: `${Date.now()}-${s.length}`, title: title.trim(), audience: label }, ...s]);
      toast?.({ icon: "check", text: "Announcement queued — emails + push within ~5 min" });
      setTitle(""); setBody(""); // clear the message; keep the audience for a quick follow-up
    } catch {
      toast?.({ icon: "alert", text: "Couldn't send — try again" });
    } finally {
      savingRef.current = false; setBusy(false);
    }
  }, [venueToken, clubId, title, body, audience, cohortId, teamId, selectedCohort, selectedTeam, toast]);

  return (
    <div className="m-view-enter">
      {/* ── header ── */}
      <div className="m-card" style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <div style={{ width: 36, height: 36, borderRadius: 11, flex: "none", background: "var(--amber-soft)",
            display: "flex", alignItems: "center", justifyContent: "center" }}>
            <MIcon name="bell" size={18} color="var(--amber)" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="m-eyebrow">{clubName || "Your club"}</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "var(--ink)" }}>Send an announcement</div>
          </div>
        </div>
        <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 10, lineHeight: 1.4 }}>
          Reaches your members by email and app notification. Team messages and deeper comms stay on the desktop console.
        </div>
      </div>

      {/* ── audience ── */}
      <div className="m-eyebrow" style={{ margin: "0 2px 9px" }}>Who's it for?</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        {AUDIENCES.map((a) => {
          const on = audience === a.key;
          return (
            <button key={a.key} onClick={() => setAudience(a.key)} style={{
              flex: 1, padding: "11px 12px", borderRadius: "var(--r-pill)", cursor: "pointer",
              fontFamily: "var(--m-font)", fontSize: 13.5, fontWeight: 700,
              border: on ? "1px solid var(--amber)" : "1px solid var(--hair)",
              background: on ? "var(--amber-soft)" : "var(--s2)", color: on ? "var(--ink)" : "var(--ink3)",
            }}>{a.label}</button>
          );
        })}
      </div>

      {/* ── cohort picker (empty / loading / error handled) ── */}
      {audience === "cohort" && (
        <div style={{ marginBottom: 8 }}>
          {loading ? (
            <div style={{ ...inputStyle, color: "var(--ink3)" }}>Loading cohorts…</div>
          ) : error ? (
            <div className="m-card" style={{ padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontSize: 13, color: "var(--ink2)" }}>Couldn't load cohorts.</span>
              <button onClick={loadCohorts} style={{
                padding: "7px 13px", borderRadius: "var(--r-pill)", cursor: "pointer",
                background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 12.5, fontFamily: "var(--m-font)",
              }}>Try again</button>
            </div>
          ) : cohorts.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--ink3)", padding: "2px 2px 4px", lineHeight: 1.4 }}>
              No cohorts yet — create one on the desktop console, or send to the whole club instead.
            </div>
          ) : (
            <label style={{ display: "block", fontSize: 12, color: "var(--ink3)" }}>
              Cohort
              <select value={cohortId} onChange={(e) => setCohortId(e.target.value)} style={inputStyle}>
                <option value="">Pick a cohort…</option>
                {cohorts.map((c) => <option key={c.cohort_id} value={c.cohort_id}>{c.name}</option>)}
              </select>
            </label>
          )}
        </div>
      )}

      {/* ── team picker (empty / loading / error handled — mirrors the cohort picker) ── */}
      {audience === "team" && (
        <div style={{ marginBottom: 8 }}>
          {teamsLoading ? (
            <div style={{ ...inputStyle, color: "var(--ink3)" }}>Loading teams…</div>
          ) : teamsError ? (
            <div className="m-card" style={{ padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ fontSize: 13, color: "var(--ink2)" }}>Couldn't load teams.</span>
              <button onClick={loadTeams} style={{
                padding: "7px 13px", borderRadius: "var(--r-pill)", cursor: "pointer",
                background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 12.5, fontFamily: "var(--m-font)",
              }}>Try again</button>
            </div>
          ) : teams.length === 0 ? (
            <div style={{ fontSize: 12.5, color: "var(--ink3)", padding: "2px 2px 4px", lineHeight: 1.4 }}>
              No teams yet — create one on the desktop console, or send to the whole club instead.
            </div>
          ) : (
            <label style={{ display: "block", fontSize: 12, color: "var(--ink3)" }}>
              Team
              <select value={teamId} onChange={(e) => setTeamId(e.target.value)} style={inputStyle}>
                <option value="">Pick a team…</option>
                {teams.map((tm) => <option key={tm.team_id} value={tm.team_id}>{tm.name}</option>)}
              </select>
            </label>
          )}
        </div>
      )}

      {/* ── who-will-get-this helper ── */}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "4px 2px 16px", fontSize: 12.5, color: "var(--ink3)", lineHeight: 1.4 }}>
        <MIcon name="users" size={14} color="var(--ink4)" />
        <span>{audienceHelper}</span>
      </div>

      {/* ── compose ── */}
      <label style={{ display: "block", marginBottom: 12, fontSize: 12, color: "var(--ink3)" }}>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Saturday kit reminder" style={inputStyle} />
      </label>
      <label style={{ display: "block", marginBottom: 14, fontSize: 12, color: "var(--ink3)" }}>
        Message
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5}
          placeholder="Write your message — it goes out by email and app notification."
          style={{ ...inputStyle, resize: "vertical", minHeight: 96, lineHeight: 1.4 }} />
      </label>

      <button onClick={send} disabled={busy} style={{
        ...btnPrimary, width: "100%", opacity: busy ? 0.6 : 1,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 15,
      }}>
        <MIcon name="check" size={16} color="var(--amber-ink)" />
        {busy ? "Sending…" : "Send announcement"}
      </button>

      {/* ── sent this session ── */}
      {sent.length > 0 && (
        <>
          <div className="m-eyebrow" style={{ margin: "22px 2px 9px" }}>Sent this session</div>
          {sent.map((m) => (
            <div key={m.id} className="m-card" style={{ padding: "12px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 11 }}>
              <div style={{ width: 32, height: 32, borderRadius: 9, flex: "none", background: "var(--ok-soft)",
                display: "flex", alignItems: "center", justifyContent: "center" }}>
                <MIcon name="check" size={15} color="var(--ok-ink)" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.title}</div>
                <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>{m.audience} · queued</div>
              </div>
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: "var(--ink4)", margin: "6px 2px 0", lineHeight: 1.4 }}>
            A full sent-history and read receipts arrive in a later release.
          </div>
        </>
      )}
    </div>
  );
}
