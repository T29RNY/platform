// TeamManagerComms.jsx — Team-manager track, "Comms" (More sub-screen). Lets a coach
// send an announcement to a team they manage — the phone twin of the desktop coach
// composer in apps/inorout/src/views/SessionsScreen.jsx (`handleSendTeamMessage`),
// reusing the SAME coach-auth RPC so the record is identical and syncs both ways:
//   clubManagerSendAnnouncement(teamId, title, body) → club_manager_send_announcement
// (coach-gated server-side via auth.uid → club_team_managers). Members read it back via
// member_list_club_announcements. NO new backend.
//
// Contract mirrored 1:1 with the desktop composer: title + body both required (trimmed),
// double-fire guard, sent/error status. Team list + switcher via the same param-less
// reader the rest of the coach track uses (clubManagerListTeamFixtures → team_id + name),
// so the teamId passed here is byte-identical to what Tonight/League/People use.
// Renders inside [data-surface="mobile"] → shell amber tokens only.

import { useState, useEffect, useCallback, useRef } from "react";
import { clubManagerListTeamFixtures, clubManagerSendAnnouncement, memberListClubAnnouncements, memberMarkAllAnnouncementsRead } from "@platform/core";
import MIcon from "../icons.jsx";

const AUDIENCE_LABEL = { club: "Whole club", cohort: "Cohort", team: "Team" };
// Session scheduled_at style: created_at is a timestamptz → viewer-local, never a raw read.
function fmtSent(iso) {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    + " · " + dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function TeamManagerComms({ toast, onBack }) {
  const [state, setState] = useState({ loading: true, error: false, teams: [] });
  const [teamIdx, setTeamIdx] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const res = await clubManagerListTeamFixtures();
      setState({ loading: false, error: false, teams: res?.teams || [] });
    } catch {
      setState({ loading: false, error: true, teams: [] });
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const { loading, error, teams } = state;
  const team = teams[teamIdx] || teams[0] || null;
  const clubId = team?.club_id || null;

  // Sent history — the club's announcement feed the coach can see (their team's + club-wide
  // + their cohort's), read-only. One-way broadcast: there is NO reply from parents, so this
  // just shows what's gone out. Reuses memberListClubAnnouncements (member-auth; a coach is a
  // club member — same gate as the desktop composer's own history). A soft add: any failure
  // just hides the list, never blocks the composer.
  const [announce, setAnnounce] = useState({ loading: false, rows: [], unread: 0 });
  const annReqRef = useRef(0);
  const loadAnnouncements = useCallback(async () => {
    if (!clubId) { setAnnounce({ loading: false, rows: [], unread: 0 }); return; }
    const reqId = ++annReqRef.current;
    setAnnounce({ loading: true, rows: [], unread: 0 });
    try {
      const res = await memberListClubAnnouncements(clubId); // { announcements, unread_count } (mig 551)
      if (reqId !== annReqRef.current) return;
      setAnnounce({ loading: false, rows: Array.isArray(res?.announcements) ? res.announcements : [], unread: res?.unread_count ?? 0 });
    } catch {
      if (reqId !== annReqRef.current) return;
      setAnnounce({ loading: false, rows: [], unread: 0 });
    }
  }, [clubId]);
  const markAllRead = useCallback(async () => {
    if (!clubId) return;
    setAnnounce((a) => ({ ...a, unread: 0, rows: a.rows.map((r) => ({ ...r, read: true })) })); // optimistic
    try { await memberMarkAllAnnouncementsRead(clubId); } catch { /* best-effort; next reload reconciles */ }
  }, [clubId]);
  useEffect(() => { loadAnnouncements(); }, [loadAnnouncements]);

  const canSend = !!team && title.trim().length > 0 && body.trim().length > 0 && !sending;

  const send = useCallback(async () => {
    if (savingRef.current || !team) return;
    const t = title.trim(), b = body.trim();
    if (!t || !b) return;
    savingRef.current = true; setSending(true);
    try {
      await clubManagerSendAnnouncement(team.team_id, t, b);
      // A coach send lands as status='queued'; the reader only returns 'sent' rows (the
      // delivery cron flips queued→sent within ~15 min). So an immediate refetch would NOT
      // return it — instead prepend it locally with a 'Sending' marker for instant feedback.
      // It becomes a real 'sent' row on the next reload once delivered (no dup: we don't
      // refetch here, and the optimistic item is cleared on team-switch/reopen).
      setAnnounce((a) => ({ ...a, rows: [
        { id: "pending-" + Math.random().toString(36).slice(2), title: t, body: b, audience: "team", created_at: new Date().toISOString(), _pending: true },
        ...a.rows,
      ] }));
      setTitle(""); setBody("");
      toast?.({ icon: "check", text: `Sent to ${team.team_name}.` });
    } catch (e) {
      console.error("[manager-comms] send announcement failed", e);
      toast?.({ icon: "alert", text: "Couldn't send that announcement." });
    } finally { savingRef.current = false; setSending(false); }
  }, [team, title, body, toast]);

  return (
    <div>
      <button onClick={onBack} style={{
        display: "flex", alignItems: "center", gap: 5, background: "transparent", border: "none",
        cursor: "pointer", color: "var(--ink3)", fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 600, margin: "6px 0 2px",
      }}>
        <MIcon name="chevron" size={15} color="var(--ink3)" style={{ transform: "rotate(180deg)" }} /> More
      </button>

      {loading && (
        <div className="m-card" style={{ marginTop: 8 }}>
          <div className="m-eyebrow">Comms</div>
          <p style={{ color: "var(--ink3)", fontSize: 14, marginTop: 8 }}>Loading your teams…</p>
        </div>
      )}
      {error && (
        <div className="m-card" style={{ marginTop: 8 }}>
          <div className="m-eyebrow">Comms</div>
          <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>Couldn't load your teams right now.</p>
          <button onClick={load} style={retryBtn}>Try again</button>
        </div>
      )}
      {!loading && !error && !team && (
        <div className="m-card" style={{ marginTop: 8 }}>
          <div className="m-eyebrow">Comms</div>
          <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>No teams to message yet.</p>
        </div>
      )}

      {!loading && !error && team && (
        <>
          {teams.length > 1 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 2px 12px" }}>
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

          <div className="m-card" style={{ padding: "15px 15px", marginTop: 8 }}>
            <div className="m-eyebrow" style={{ marginBottom: 10 }}>Message {team.team_name}</div>

            <label style={labelStyle}>Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Training moved to 6pm"
              maxLength={120}
              style={inputStyle}
            />

            <label style={{ ...labelStyle, marginTop: 12 }}>Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What do the players and parents need to know?"
              rows={5}
              maxLength={2000}
              style={{ ...inputStyle, resize: "vertical", minHeight: 96, lineHeight: 1.45 }}
            />

            <button onClick={send} disabled={!canSend} style={{
              ...primaryBtn, opacity: canSend ? 1 : 0.5, cursor: canSend ? "pointer" : "default",
            }}>
              {sending ? "Sending…" : "Send announcement"}
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 10, color: "var(--ink4)", fontSize: 12 }}>
              <MIcon name="bell" size={13} color="var(--ink4)" /> Goes to every player and parent on {team.team_name}.
            </div>
          </div>

          {/* Recent announcements — read-only SENT history (one-way broadcast: no reply from
              parents). Shows the club feed the coach can see (their team's + club-wide + cohort). */}
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "22px 2px 11px" }}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em", margin: 0 }}>Recent announcements</h2>
            {!announce.loading && announce.unread > 0
              ? <button onClick={markAllRead} style={{
                  fontSize: 11.5, fontWeight: 700, padding: "4px 11px", borderRadius: "var(--r-pill)", cursor: "pointer",
                  background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontFamily: "var(--m-font)",
                }}>{announce.unread} unread · mark read</button>
              : (!announce.loading && announce.rows.length > 0 && <span style={{ fontSize: 12, color: "var(--ink3)", fontWeight: 600 }}>{announce.rows.length}</span>)}
          </div>

          {announce.loading && (
            <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5 }}>Loading…</div>
          )}
          {!announce.loading && announce.rows.length === 0 && (
            <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5 }}>Nothing sent yet.</div>
          )}
          {!announce.loading && announce.rows.slice(0, 20).map((a) => (
            <div key={a.id} className="m-card" style={{ padding: "12px 14px", marginBottom: 9 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                {!a.read && !a._pending && <span style={{ width: 7, height: 7, borderRadius: "50%", flex: "none", background: "var(--amber)" }} aria-label="Unread" />}
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.title}</span>
                <span style={{
                  height: 20, padding: "0 8px", borderRadius: "var(--r-pill)", flex: "none",
                  display: "inline-flex", alignItems: "center", fontSize: 10.5, fontWeight: 700,
                  background: a._pending ? "var(--amber-soft)" : "var(--s3)", color: a._pending ? "var(--amber)" : "var(--ink3)",
                }}>{a._pending ? "Sending" : (AUDIENCE_LABEL[a.audience] || a.audience)}</span>
              </div>
              {a.body && <div style={{ fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.45, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{a.body}</div>}
              <div style={{ fontSize: 11, color: "var(--ink4)", marginTop: 6 }}>{a._pending ? "Just now · delivering" : fmtSent(a.created_at)}</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

const labelStyle = {
  display: "block", fontSize: 12, fontWeight: 700, color: "var(--ink3)",
  letterSpacing: "0.02em", marginBottom: 5, fontFamily: "var(--m-font)",
};
const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: "var(--r-md)",
  background: "var(--s2)", border: "1px solid var(--hair2)", color: "var(--ink)",
  fontFamily: "var(--m-font)", fontSize: 15, outline: "none",
};
const primaryBtn = {
  width: "100%", marginTop: 16, padding: "13px", borderRadius: "var(--r-pill)",
  background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)",
  fontFamily: "var(--m-font)", fontSize: 14.5, fontWeight: 800,
};
const retryBtn = {
  marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
  background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)", fontWeight: 700, fontSize: 13.5,
};
