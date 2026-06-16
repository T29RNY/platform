import { useState, useEffect, useRef } from "react";
import { memberListClassSessions, memberBookClassSession } from "@platform/core/storage/supabase.js";

// Public "What's on" weekly timetable for a venue (Classes Booking Phase 3, mig 340).
// Readable with no login — the session list + spots render for anyone; the Book
// action is auth-gated via the requireAuth passed down from VenueLanding. Zero
// footprint: renders nothing for a venue with no upcoming scheduled classes, so
// it's invisible to venues that don't run classes.
//
// Designed as the first piece of the public club website: a clean weekly view,
// grouped by day, that reads as a timetable rather than a logged-in dashboard.

const DAY_FMT = { weekday: "long", day: "numeric", month: "short", timeZone: "Europe/London" };
const TIME_FMT = { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" };

const CATEGORY_LABEL = {
  fitness: "Fitness", yoga: "Yoga", dance: "Dance", martial_arts: "Martial arts", other: "Class",
};

const REASON_MSG = {
  membership_required: "Members only — join the club to book classes.",
  suspended: "Booking is paused on your account due to missed classes. Speak to the venue.",
  payment_method_unavailable: "Online payment isn't set up for this class yet — please contact the venue.",
  already_booked: "You're already booked into this class.",
  session_not_bookable: "This class is no longer open for booking.",
};

function Styles() {
  return (
    <style>{`
      .ct-wrap { margin-top: 26px; }
      .ct-head { font-family: "Bebas Neue", sans-serif; font-size: 26px; letter-spacing: 0.5px; margin: 0 0 2px; }
      .ct-sub { color: var(--t3); font-size: 12px; margin: 0 0 14px; }
      .ct-day { font-family: "Bebas Neue", sans-serif; font-size: 16px; letter-spacing: 0.5px; color: var(--t2); margin: 16px 0 8px; }
      .ct-card { background: var(--s1, rgba(255,255,255,0.04)); border-radius: 12px; padding: 13px 14px; margin-bottom: 8px;
        display: flex; align-items: center; gap: 12px; }
      .ct-time { font-family: "Bebas Neue", sans-serif; font-size: 20px; letter-spacing: 0.5px; min-width: 56px; line-height: 1; }
      .ct-meta { flex: 1; min-width: 0; }
      .ct-name { font-size: 15px; font-weight: 600; color: var(--t1); }
      .ct-info { color: var(--t3); font-size: 12px; margin-top: 2px; }
      .ct-spots { color: var(--t3); font-size: 12px; margin-top: 2px; }
      .ct-spots--low { color: #FF6060; }
      .ct-act { flex-shrink: 0; }
      .ct-btn { padding: 8px 14px; border: none; border-radius: 9px; background: var(--t1); color: var(--bg);
        font-family: "DM Sans", sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
      .ct-btn--ghost { background: transparent; color: var(--t2); border: 1px solid rgba(255,255,255,0.16); }
      .ct-btn:disabled { opacity: 0.55; cursor: default; }
      .ct-badge { font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 999px;
        background: rgba(96,160,255,0.15); color: #60A0FF; white-space: nowrap; }
      .ct-err { color: #FF6060; font-size: 12px; margin: 4px 0 0; }
    `}</style>
  );
}

const priceLabel = (p) => (p > 0 ? "£" + (p % 100 ? (p / 100).toFixed(2) : p / 100) : "Free");

export default function ClassesTimetable({ venueId, requireAuth }) {
  const [sessions, setSessions] = useState(null); // null=loading, []=none, [...]=data
  const [err, setErr] = useState(null);
  const inFlight = useRef(new Set());

  useEffect(() => {
    let alive = true;
    memberListClassSessions(venueId)
      .then((rows) => { if (alive) setSessions(Array.isArray(rows) ? rows : []); })
      .catch((e) => { console.error("[classes] timetable load failed", e); if (alive) setSessions([]); });
    return () => { alive = false; };
  }, [venueId]);

  // Optimistic book with revert; double-fire guarded per session id.
  const book = (sess) => {
    if (inFlight.current.has(sess.session_id)) return;
    requireAuth(async () => {
      if (inFlight.current.has(sess.session_id)) return;
      inFlight.current.add(sess.session_id);
      setErr(null);
      const optimistic = sess.spots_left > 0 ? "confirmed" : "waitlist";
      setSessions((rows) => rows.map((r) => r.session_id === sess.session_id ? { ...r, my_status: optimistic } : r));
      try {
        const res = await memberBookClassSession(sess.session_id);
        if (res?.ok) {
          setSessions((rows) => rows.map((r) => r.session_id === sess.session_id
            ? { ...r, my_status: res.status, my_waitlist_position: res.waitlist_position,
                booked_count: res.status === "confirmed" ? r.booked_count + 1 : r.booked_count,
                spots_left: res.status === "confirmed" ? Math.max(r.spots_left - 1, 0) : r.spots_left }
            : r));
        } else {
          setSessions((rows) => rows.map((r) => r.session_id === sess.session_id ? { ...r, my_status: null } : r));
          setErr(REASON_MSG[res?.reason] || "Couldn't book that class. Please try again.");
        }
      } catch (e) {
        console.error("[classes] book failed", e);
        setSessions((rows) => rows.map((r) => r.session_id === sess.session_id ? { ...r, my_status: null } : r));
        setErr("Couldn't book that class. Please try again.");
      } finally {
        inFlight.current.delete(sess.session_id);
      }
    }, { reason: "Sign in to book a class. You'll only need to do this once." });
  };

  // Zero footprint: nothing to show.
  if (!sessions || sessions.length === 0) return null;

  // Group by UK calendar day.
  const groups = [];
  const byDay = new Map();
  for (const s of sessions) {
    const key = new Date(s.starts_at).toLocaleDateString("en-GB", DAY_FMT);
    if (!byDay.has(key)) { byDay.set(key, []); groups.push(key); }
    byDay.get(key).push(s);
  }

  return (
    <div className="ct-wrap">
      <Styles />
      <h2 className="ct-head">What's on</h2>
      <p className="ct-sub">Classes this week — members can book a spot.</p>
      {err && <p className="ct-err">{err}</p>}

      {groups.map((day) => (
        <div key={day}>
          <div className="ct-day">{day}</div>
          {byDay.get(day).map((s) => {
            const full = s.spots_left <= 0;
            const booked = s.my_status === "confirmed";
            const waitlisted = s.my_status === "waitlist";
            const offered = s.my_status === "offered";
            return (
              <div className="ct-card" key={s.session_id}>
                <div className="ct-time">{new Date(s.starts_at).toLocaleTimeString("en-GB", TIME_FMT)}</div>
                <div className="ct-meta">
                  <div className="ct-name">{s.class_name}</div>
                  <div className="ct-info">
                    {CATEGORY_LABEL[s.category] || "Class"}{s.space_name ? ` · ${s.space_name}` : ""} · {priceLabel(s.price_pence)}
                  </div>
                  <div className={"ct-spots" + (full ? " ct-spots--low" : "")}>
                    {full ? `Full · ${s.waitlist_count} on waitlist` : `${s.spots_left} spot${s.spots_left === 1 ? "" : "s"} left`}
                  </div>
                </div>
                <div className="ct-act">
                  {booked ? (
                    <span className="ct-badge">Booked</span>
                  ) : offered ? (
                    <span className="ct-badge">Spot offered — claim on your pass</span>
                  ) : waitlisted ? (
                    <span className="ct-badge">Waitlisted{s.my_waitlist_position ? ` #${s.my_waitlist_position}` : ""}</span>
                  ) : (
                    <button className={"ct-btn" + (full ? " ct-btn--ghost" : "")} onClick={() => book(s)}>
                      {full ? "Join waitlist" : "Book"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
