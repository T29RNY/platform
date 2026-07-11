// VenueClassRosterView.jsx — the venue-token /hub view of who's booked into camp/class sessions.
// SHARED by the club-admin AND operator /hub tracks (both hold a venue-token = role.entityId), so
// the camp register that already exists on the DESKTOP (apps/venue ClassesView) now syncs to their
// mobile /hub too — same source, same fields, no new payment/booking system.
//
//   • list   — venueListClassSessions(venueToken, {from:now})   (RPC venue_list_class_sessions):
//              upcoming camp/class sessions + booked_count / waitlist_count.
//   • roster — venueGetClassSessionDetail(venueToken, sessionId) (RPC venue_get_class_session_detail,
//              mig 362): the booked attendees[] (member_name / age / status / payment_status /
//              waitlist_position) — the SAME contract the desktop reads.
//
// READ-ONLY. Renders inside the scoped [data-surface="mobile"] tree (amber tokens); the roster
// sheet self-fetches on open and portals through MobileSheet (clears the docked nav).

import { useState, useEffect, useCallback } from "react";
import { venueListClassSessions, venueGetClassSessionDetail } from "@platform/core";
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
function payTok(ps) {
  if (ps === "paid") return { soft: "var(--ok-soft)", ink: "var(--ok-ink)", label: "Paid" };
  if (ps === "waived") return { soft: "var(--s3)", ink: "var(--ink2)", label: "Included" };
  if (ps === "pending") return { soft: "var(--amber-soft)", ink: "var(--amber)", label: "Due" };
  return { soft: "var(--s3)", ink: "var(--ink3)", label: "—" };
}

const muted = { color: "var(--ink3)", fontSize: 14, marginTop: 8 };
function Card({ children }) { return <div className="m-card" style={{ marginTop: 8 }}>{children}</div>; }

export default function VenueClassRosterView({ venueToken, title = "Camps & classes", onBack }) {
  const [state, setState] = useState({ loading: true, error: false, rows: [] });
  const [rosterFor, setRosterFor] = useState(null); // the session row tapped → roster sheet

  const load = useCallback(async () => {
    if (!venueToken) { setState({ loading: false, error: true, rows: [] }); return; }
    setState({ loading: true, error: false, rows: [] });
    try {
      const from = new Date(Date.now() - 12 * 3600 * 1000).toISOString(); // include today's earlier sessions
      const rows = await venueListClassSessions(venueToken, { from });
      const list = (Array.isArray(rows) ? rows : []).filter((s) => s.status === "scheduled");
      setState({ loading: false, error: false, rows: list });
    } catch {
      setState({ loading: false, error: true, rows: [] });
    }
  }, [venueToken]);
  useEffect(() => { load(); }, [load]);

  const { loading, error, rows } = state;

  return (
    <div className="m-view-enter">
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "2px 2px 12px" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, display: "flex", color: "var(--ink2)" }}>
          <MIcon name="chevleft" size={20} color="var(--ink2)" />
        </button>
        <h1 style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-0.01em", color: "var(--ink)", margin: 0 }}>{title}</h1>
      </div>

      {loading && <Card><p style={muted}>Loading camps &amp; classes…</p></Card>}
      {!loading && error && (
        <Card><p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>Couldn't load camps &amp; classes.</p></Card>
      )}
      {!loading && !error && rows.length === 0 && (
        <div className="m-card" style={{ padding: "16px 15px" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)" }}>Nothing scheduled</div>
          <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 4, lineHeight: 1.5 }}>
            When a camp or class is scheduled, everyone booked in will show here — the same list the desktop shows.
          </div>
        </div>
      )}

      {!loading && rows.map((s) => {
        const full = s.capacity > 0 && s.booked_count >= s.capacity;
        return (
          <button key={s.id} onClick={() => setRosterFor(s)} className="m-card"
            style={{ width: "100%", textAlign: "left", cursor: "pointer", padding: "12px 14px", marginBottom: 9, display: "flex", alignItems: "center", gap: 12, fontFamily: "var(--m-font)" }}>
            <div style={{ width: 40, height: 40, borderRadius: 11, flex: "none", background: "var(--amber-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <MIcon name="calendar" size={19} color="var(--amber)" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.class_name || "Camp / class"}</div>
              <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>{fmtDayTime(s.starts_at)}</div>
              <div style={{ fontSize: 11.5, color: "var(--ink2)", fontWeight: 700, marginTop: 3 }}>
                {s.booked_count} booked{s.capacity > 0 ? ` / ${s.capacity}` : ""}{s.waitlist_count > 0 ? ` · ${s.waitlist_count} waitlist` : ""}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
              {full && <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--r-pill)", background: "var(--s3)", color: "var(--ink3)" }}>Full</span>}
              <MIcon name="chevron" size={16} color="var(--ink4)" />
            </div>
          </button>
        );
      })}

      {rosterFor && (
        <VenueRosterSheet venueToken={venueToken} session={rosterFor} onClose={() => setRosterFor(null)} />
      )}
    </div>
  );
}

// Self-fetching register for one session — venueGetClassSessionDetail → attendees[].
function VenueRosterSheet({ venueToken, session, onClose }) {
  const [st, setSt] = useState({ loading: true, error: false, detail: null });
  useEffect(() => {
    let cancelled = false;
    setSt({ loading: true, error: false, detail: null });
    venueGetClassSessionDetail(venueToken, session.id)
      .then((d) => { if (!cancelled) setSt({ loading: false, error: !d, detail: d || null }); })
      .catch(() => { if (!cancelled) setSt({ loading: false, error: true, detail: null }); });
    return () => { cancelled = true; };
  }, [venueToken, session.id]);

  const { loading, error, detail } = st;
  const attendees = Array.isArray(detail?.attendees) ? detail.attendees : [];
  const confirmed = attendees.filter((r) => r.status === "confirmed");
  const waitlist = attendees.filter((r) => r.status === "waitlist");
  const cap = detail?.capacity ?? session.capacity;
  const price = detail?.price_pence ?? session.price_pence;

  return (
    <MobileSheet title={session.class_name || detail?.class_name || "Camp / class"} onClose={onClose}>
      <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: -2, marginBottom: 12 }}>
        {fmtDay(session.starts_at)}{price != null ? ` · ${gbp(price)}` : ""}
      </div>

      {loading && <p style={muted}>Loading who's booked…</p>}
      {error && <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 8 }}>Couldn't load the register.</p>}

      {detail && (
        <>
          <div className="m-eyebrow" style={{ margin: "2px 2px 8px" }}>
            Booked in{cap > 0 ? ` · ${confirmed.length}/${cap}` : ` · ${confirmed.length}`}
          </div>
          {confirmed.length === 0 && (
            <div style={{ fontSize: 13.5, color: "var(--ink3)", padding: "2px 2px 8px" }}>No one booked in yet.</div>
          )}
          {confirmed.map((r, i) => <RosterRow key={"c" + i} r={r} />)}

          {waitlist.length > 0 && (
            <>
              <div className="m-eyebrow" style={{ margin: "16px 2px 8px" }}>Waitlist · {waitlist.length}</div>
              {waitlist.map((r, i) => <RosterRow key={"w" + i} r={r} waitlist />)}
            </>
          )}

          <div style={{ fontSize: 11.5, color: "var(--ink4)", marginTop: 14, lineHeight: 1.5 }}>
            The same register the desktop shows. Parents book &amp; pay from their own app.
          </div>
        </>
      )}
    </MobileSheet>
  );
}

function RosterRow({ r, waitlist }) {
  const tok = payTok(r.payment_status);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 0", borderBottom: "1px solid var(--hair)" }}>
      <div style={{ width: 30, height: 30, borderRadius: 9, flex: "none", background: "var(--s4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <MIcon name="figure" size={15} color="var(--ink2)" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.member_name || "Player"}</div>
        {r.age != null && <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 1 }}>Age {r.age}</div>}
      </div>
      {waitlist
        ? <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--r-pill)", background: "var(--s3)", color: "var(--ink3)", flex: "none" }}>
            {r.waitlist_position != null ? `#${r.waitlist_position}` : "Waitlist"}
          </span>
        : <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: "var(--r-pill)", background: tok.soft, color: tok.ink, flex: "none" }}>{tok.label}</span>}
    </div>
  );
}
