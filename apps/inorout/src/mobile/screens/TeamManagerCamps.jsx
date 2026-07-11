// TeamManagerCamps.jsx — Team-manager track, "Camps" (More sub-screen). The coach's read-only
// view of who is BOOKED into their team's camp/class sessions — the same booking data the desktop
// operator/club-admin already see (venue_class_bookings), now synced to the coach /hub.
//
//   • teams   — clubManagerListTeamFixtures() (same team source as Training)
//   • camps   — clubManagerGetTeamCamps(teamId)  (RPC club_manager_get_team_camps, mig 544):
//               the team's upcoming camp/class sessions, each with its booked roster embedded
//               (member_name / age / status / payment_status / waitlist_position).
//
// READ-ONLY — the coach sees the register + paid status; guardians/operator own the writes.
// Renders inside the scoped [data-surface="mobile"] tree (amber tokens); the roster sheet portals
// through MobileSheet (clears the docked nav).

import { useState, useEffect, useCallback } from "react";
import { clubManagerListTeamFixtures, clubManagerGetTeamCamps, clubManagerMarkCampAttended } from "@platform/core";
import MIcon from "../icons.jsx";
import MobileSheet from "../MobileSheet.jsx";

const gbp = (pence) => `£${((pence || 0) / 100).toFixed(2)}`;

function fmtDay(iso) {
  if (!iso) return "Date TBC";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "Date TBC";
  return dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
function fmtDayTime(iso) {
  if (!iso) return "Date TBC";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "Date TBC";
  return dt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    + " · " + dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}

// payment_status → a compact pill token pair + label
function payTok(ps) {
  if (ps === "paid") return { soft: "var(--ok-soft)", ink: "var(--ok-ink)", label: "Paid" };
  if (ps === "waived") return { soft: "var(--s3)", ink: "var(--ink2)", label: "Included" };
  if (ps === "pending") return { soft: "var(--amber-soft)", ink: "var(--amber)", label: "Due" };
  return { soft: "var(--s3)", ink: "var(--ink3)", label: "—" };
}

const muted = { color: "var(--ink3)", fontSize: 14, marginTop: 8 };
function Card({ children }) {
  return <div className="m-card" style={{ marginTop: 8 }}>{children}</div>;
}

export default function TeamManagerCamps({ toast, onBack }) {
  const [teamsState, setTeamsState] = useState({ loading: true, error: false, teams: [] });
  const [teamIdx, setTeamIdx] = useState(0);
  const [camps, setCamps] = useState({ loading: false, error: false, rows: [] });
  const [rosterFor, setRosterFor] = useState(null); // the camp row tapped → roster sheet

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

  const loadCamps = useCallback(async () => {
    if (!teamId) { setCamps({ loading: false, error: false, rows: [] }); return; }
    setCamps({ loading: true, error: false, rows: [] });
    try {
      const res = await clubManagerGetTeamCamps(teamId);
      setCamps({ loading: false, error: false, rows: Array.isArray(res?.camps) ? res.camps : [] });
    } catch {
      setCamps({ loading: false, error: true, rows: [] });
    }
  }, [teamId]);
  useEffect(() => { loadCamps(); }, [loadCamps]);

  return (
    <div className="m-view-enter">
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 2px 12px" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", color: "var(--ink2)" }}>
          <MIcon name="chevleft" size={20} color="var(--ink2)" />
        </button>
        <h1 style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-0.01em", color: "var(--ink)", margin: 0 }}>Camps</h1>
      </div>

      {teamsState.loading && <Card><p style={muted}>Loading your teams…</p></Card>}
      {!teamsState.loading && teamsState.error && (
        <Card><p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>Couldn't load your teams.</p></Card>
      )}
      {!teamsState.loading && !teamsState.error && teams.length === 0 && (
        <Card><p style={muted}>No teams to manage yet.</p></Card>
      )}

      {teams.length > 0 && (
        <>
          {/* team switcher (only when the coach runs more than one team) */}
          {teams.length > 1 && (
            <div style={{ display: "flex", gap: 7, overflowX: "auto", paddingBottom: 4, marginBottom: 6 }}>
              {teams.map((t, i) => {
                const on = i === teamIdx;
                return (
                  <button key={t.team_id} onClick={() => setTeamIdx(i)} style={{
                    flex: "none", padding: "7px 13px", borderRadius: "var(--r-pill)", cursor: "pointer", fontFamily: "var(--m-font)",
                    fontSize: 13, fontWeight: 700, whiteSpace: "nowrap",
                    background: on ? "var(--amber)" : "var(--s2)", color: on ? "var(--amber-ink)" : "var(--ink2)",
                    border: on ? "none" : "1px solid var(--hair)",
                  }}>{t.team_name || t.name || "Team"}</button>
                );
              })}
            </div>
          )}

          {camps.loading && <Card><p style={muted}>Loading camps…</p></Card>}
          {!camps.loading && camps.error && (
            <Card><p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>Couldn't load camps.</p></Card>
          )}
          {!camps.loading && !camps.error && camps.rows.length === 0 && (
            <div className="m-card" style={{ padding: "16px 15px" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>No camps yet</div>
              <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 4, lineHeight: 1.5 }}>
                When a holiday camp or extra class is scheduled for this team, the players booked in will show here.
              </div>
            </div>
          )}

          {!camps.loading && camps.rows.map((c) => {
            const full = c.capacity > 0 && c.booked_count >= c.capacity;
            return (
              <button key={c.session_id} onClick={() => setRosterFor(c)} className="m-card"
                style={{ width: "100%", textAlign: "left", cursor: "pointer", padding: "12px 14px", marginBottom: 9, display: "flex", alignItems: "center", gap: 12, fontFamily: "var(--m-font)" }}>
                <div style={{ width: 40, height: 40, borderRadius: 11, flex: "none", background: "var(--amber-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <MIcon name="calendar" size={19} color="var(--amber)" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.class_name || "Camp / class"}</div>
                  <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>{fmtDayTime(c.starts_at)}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink2)", fontWeight: 700, marginTop: 3 }}>
                    {c.booked_count} booked{c.capacity > 0 ? ` / ${c.capacity}` : ""}{c.waitlist_count > 0 ? ` · ${c.waitlist_count} waitlist` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
                  {full && <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--r-pill)", background: "var(--s3)", color: "var(--ink3)" }}>Full</span>}
                  <MIcon name="chevron" size={16} color="var(--ink4)" />
                </div>
              </button>
            );
          })}
        </>
      )}

      {rosterFor && (
        <CampRosterSheet camp={rosterFor} teamId={teamId} toast={toast} onClose={() => setRosterFor(null)} />
      )}
    </div>
  );
}

// The booked register for one camp session — who's in (name, age, paid status) + waitlist.
// Coach can mark each confirmed player as attended (check-in), synced with the operator.
function CampRosterSheet({ camp, teamId, toast, onClose }) {
  const roster = Array.isArray(camp.roster) ? camp.roster : [];
  const confirmed = roster.filter((r) => r.status === "confirmed");
  const waitlist = roster.filter((r) => r.status === "waitlist");

  // Optimistic check-in state keyed by booking_id (the sheet reads a parent snapshot,
  // so we own the attended flags locally and revert on error).
  const [checked, setChecked] = useState(() =>
    Object.fromEntries(roster.filter((r) => r.booking_id).map((r) => [r.booking_id, !!r.checked_in_at]))
  );
  const [busy, setBusy] = useState(null);

  const markAttended = async (bookingId) => {
    if (!bookingId || busy) return;
    const next = !checked[bookingId];
    setBusy(bookingId);
    setChecked((c) => ({ ...c, [bookingId]: next }));
    try {
      await clubManagerMarkCampAttended(teamId, bookingId, next);
    } catch (e) {
      console.error("[camps] mark attended failed", e);
      setChecked((c) => ({ ...c, [bookingId]: !next })); // revert
      toast?.("Couldn't update — try again");
    } finally {
      setBusy(null);
    }
  };

  return (
    <MobileSheet title={camp.class_name || "Camp"} onClose={onClose}>
      <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: -2, marginBottom: 12 }}>
        {fmtDay(camp.starts_at)}{camp.price_pence != null ? ` · ${gbp(camp.price_pence)}` : ""}
      </div>

      <div className="m-eyebrow" style={{ margin: "2px 2px 8px" }}>
        Booked in{camp.capacity > 0 ? ` · ${confirmed.length}/${camp.capacity}` : ` · ${confirmed.length}`}
      </div>
      {confirmed.length === 0 && (
        <div style={{ fontSize: 13.5, color: "var(--ink3)", padding: "2px 2px 8px" }}>No one booked in yet.</div>
      )}
      {confirmed.map((r, i) => (
        <RosterRow
          key={"c" + i}
          r={r}
          attended={r.booking_id ? !!checked[r.booking_id] : false}
          busy={busy === r.booking_id}
          onToggle={r.booking_id ? () => markAttended(r.booking_id) : null}
        />
      ))}

      {waitlist.length > 0 && (
        <>
          <div className="m-eyebrow" style={{ margin: "16px 2px 8px" }}>Waitlist · {waitlist.length}</div>
          {waitlist.map((r, i) => <RosterRow key={"w" + i} r={r} waitlist />)}
        </>
      )}

      <div style={{ fontSize: 11.5, color: "var(--ink4)", marginTop: 14, lineHeight: 1.5 }}>
        Tap a player to mark them attended — the club office sees the same register in real time.
      </div>
    </MobileSheet>
  );
}

function RosterRow({ r, waitlist, attended, busy, onToggle }) {
  const tok = payTok(r.payment_status);
  const clickable = !waitlist && typeof onToggle === "function";
  return (
    <div
      onClick={clickable ? onToggle : undefined}
      role={clickable ? "button" : undefined}
      style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 0", borderBottom: "1px solid var(--hair)", cursor: clickable ? "pointer" : "default", opacity: busy ? 0.55 : 1 }}
    >
      <div style={{ width: 30, height: 30, borderRadius: 9, flex: "none", background: attended ? "var(--good-soft, var(--s4))" : "var(--s4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <MIcon name={attended ? "check" : "figure"} size={15} color={attended ? "var(--good, var(--ink2))" : "var(--ink2)"} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.member_name || "Player"}</div>
        {r.age != null && <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 1 }}>Age {r.age}</div>}
      </div>
      {waitlist
        ? <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--r-pill)", background: "var(--s3)", color: "var(--ink3)", flex: "none" }}>
            {r.waitlist_position != null ? `#${r.waitlist_position}` : "Waitlist"}
          </span>
        : clickable
          ? <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--r-pill)", background: attended ? "var(--good-soft, var(--s3))" : "var(--s3)", color: attended ? "var(--good, var(--ink3))" : "var(--ink3)", flex: "none" }}>
              {attended ? "Attended ✓" : "Mark in"}
            </span>
          : <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--r-pill)", background: tok.soft, color: tok.ink, flex: "none" }}>{tok.label}</span>}
    </div>
  );
}
