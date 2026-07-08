import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  clubSendAnnouncement,
  clubListCohorts,
  clubListTeams,
} from "@platform/core/storage/supabase.js";
import { useToast } from "../shell/toast.jsx";

// Comms — compose + send a club announcement (whole club, a cohort, or a team).
// Venue-token write (clubSendAnnouncement; server gates on manage_memberships).
// Delivery is the existing broadcast cron (email + member push, within ~5 min);
// this screen queues the message and shows a session-local "sent" list.
//
// Deliberately OUT of scope (documented deferrals — need new backend):
//  · a persistent admin "sent history" read (no venue-token announcements reader
//    exists — only a member-scoped feed), so the list here is session-local.
//  · the inbound admin/welfare nudge channel (Decision 9) — the broadcast cron is
//    outbound-to-members only, with no admin-recipient branch.
//  · two-way chat (a separate safeguarding-heavy epic).
//  · coach team announcements — club_manager_send_announcement is coach-auth,
//    surfaced in the /hub companion, not this admin console.
const AUDIENCES = [
  { key: "club", label: "Whole club" },
  { key: "cohort", label: "Cohort" },
  { key: "team", label: "Team" },
];

export default function Comms({ venueId, clubId }) {
  const t = useToast();
  const [audience, setAudience] = useState("club");
  const [cohortId, setCohortId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);
  const [sent, setSent] = useState([]);   // session-local log of what we queued

  const [cohorts, setCohorts] = useState([]);
  const [teams, setTeams] = useState([]);

  useEffect(() => {
    if (!venueId || !clubId) return;
    let cancelled = false;
    clubListCohorts(venueId, clubId, false).then((c) => { if (!cancelled) setCohorts(Array.isArray(c) ? c : []); }).catch(() => {});
    clubListTeams(venueId, clubId, false).then((tm) => { if (!cancelled) setTeams(Array.isArray(tm) ? tm : []); }).catch(() => {});
    return () => { cancelled = true; };
  }, [venueId, clubId]);

  const send = useCallback(async () => {
    if (savingRef.current) return;
    if (!title.trim()) { t.show("Give the announcement a title.", "error"); return; }
    if (!body.trim()) { t.show("Write a message.", "error"); return; }
    if (audience === "cohort" && !cohortId) { t.show("Pick a cohort.", "error"); return; }
    if (audience === "team" && !teamId) { t.show("Pick a team.", "error"); return; }
    savingRef.current = true; setBusy(true);
    try {
      await clubSendAnnouncement(
        venueId, clubId, title.trim(), body.trim(), audience,
        audience === "cohort" ? cohortId : null,
        audience === "team" ? teamId : null,
      );
      const label = audience === "club" ? "Whole club"
        : audience === "cohort" ? (cohorts.find((c) => c.cohort_id === cohortId)?.name || "Cohort")
        : (teams.find((tm) => tm.team_id === teamId)?.name || "Team");
      setSent((s) => [{ id: `${Date.now()}-${s.length}`, title: title.trim(), audience: label }, ...s]);
      t.show("Announcement queued — emails + push within ~5 min.");
      setTitle(""); setBody("");
    } catch (err) {
      console.error("[clubmanager] send announcement failed", err);
      t.show("Couldn't send the announcement.", "error");
    } finally {
      savingRef.current = false; setBusy(false);
    }
  }, [venueId, clubId, title, body, audience, cohortId, teamId, cohorts, teams, t]);

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Comms</h2>
          <p className="sub">Send an announcement to your whole club, a cohort or a team.</p>
        </div>
      </div>

      <div className="tiles tiles--2">
        <div className="tile" style={{ minHeight: 0 }}>
          <h3>New announcement</h3>

          <div style={{ display: "flex", gap: 6, margin: "2px 0 14px", flexWrap: "wrap" }}>
            {AUDIENCES.map((a) => (
              <button key={a.key}
                className={audience === a.key ? "aud-pill on" : "aud-pill"}
                onClick={() => setAudience(a.key)}>{a.label}</button>
            ))}
          </div>

          {audience === "cohort" && (
            <label className="field"><span>Cohort</span>
              <select value={cohortId} onChange={(e) => setCohortId(e.target.value)}>
                <option value="">Pick a cohort…</option>
                {cohorts.map((c) => <option key={c.cohort_id} value={c.cohort_id}>{c.name}</option>)}
              </select>
            </label>
          )}
          {audience === "team" && (
            <label className="field"><span>Team</span>
              <select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                <option value="">Pick a team…</option>
                {teams.map((tm) => <option key={tm.team_id} value={tm.team_id}>{tm.name}</option>)}
              </select>
            </label>
          )}

          <label className="field"><span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Saturday kit reminder" />
          </label>
          <label className="field"><span>Message</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5}
              placeholder="Write your message — it goes out by email and app notification." />
          </label>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
            <button className="primary" onClick={send} disabled={busy}>{busy ? "Sending…" : "Send announcement"}</button>
          </div>
        </div>

        <div className="tile" style={{ minHeight: 0 }}>
          <h3>Sent this session</h3>
          {sent.length === 0 ? (
            <div className="state">Nothing sent yet. Your announcements will show here after you send them.</div>
          ) : (
            <table className="atable">
              <tbody>
                {sent.map((m) => (
                  <tr key={m.id}>
                    <td>{m.title}</td>
                    <td className="num" style={{ color: "var(--t2)" }}>{m.audience}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="state" style={{ marginTop: 10, fontSize: 12 }}>
            A full sent-history and read receipts arrive in a later release.
          </div>
        </div>
      </div>
    </>
  );
}
