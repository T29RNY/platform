import { useState, useEffect, useRef } from "react";
import { memberListHireableSpaces, memberRequestRoomHire, publicEnquireRoomHire } from "@platform/core/storage/supabase.js";
import { supabase } from "@platform/core/storage/supabase.js";

// "Hire a space" — Room Hire Phase 5 (mig 342) member/public surface on VenueLanding.
// Self-serve spaces get a request flow (login-gated → member_request_room_hire);
// enquiry-only spaces render a contact form instead (anon → public_enquire_room_hire).
// Zero footprint: renders nothing for a venue with no active hireable spaces.

const SPACE_TYPE_LABEL = { studio: "Studio", room: "Room", hall: "Hall", outdoor: "Outdoor" };

const REASON_MSG = {
  space_unavailable: "That space is already booked for that time — try another slot.",
  too_many_requests: "You've already got requests pending for this space. Give the venue a chance to respond first.",
  not_enquiry_only: "This space is self-serve — please sign in to request it.",
};

function Styles() {
  return (
    <style>{`
      .hs-wrap { margin-top: 26px; }
      .hs-head { font-family: "Bebas Neue", sans-serif; font-size: 26px; letter-spacing: 0.5px; margin: 0 0 2px; }
      .hs-sub { color: var(--t3); font-size: 12px; margin: 0 0 14px; }
      .hs-card { background: var(--s1, rgba(255,255,255,0.04)); border-radius: 12px; padding: 14px; margin-bottom: 8px; }
      .hs-name { font-size: 15px; font-weight: 600; color: var(--t1); }
      .hs-info { color: var(--t3); font-size: 12px; margin-top: 2px; }
      .hs-badge { font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 999px; margin-left: 8px;
        background: rgba(96,160,255,0.15); color: #60A0FF; }
      .hs-btn { margin-top: 10px; padding: 8px 14px; border: none; border-radius: 9px; background: var(--t1); color: var(--bg);
        font-family: "DM Sans", sans-serif; font-size: 13px; font-weight: 600; cursor: pointer; }
      .hs-btn--ghost { background: transparent; color: var(--t2); border: 1px solid rgba(255,255,255,0.16); }
      .hs-btn:disabled { opacity: 0.55; cursor: default; }
      .hs-label { display: block; color: var(--t3); font-size: 12px; margin: 10px 0 4px; }
      .hs-input { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 9px;
        border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); color: var(--t1);
        font-family: "DM Sans", sans-serif; font-size: 14px; }
      .hs-row { display: flex; gap: 8px; }
      .hs-row > div { flex: 1; }
      .hs-err { color: #FF6060; font-size: 12px; margin: 6px 0 0; }
      .hs-ok { color: var(--t1); font-size: 13px; margin-top: 8px; }
    `}</style>
  );
}

export default function HireSpace({ venueId, requireAuth }) {
  const [spaces, setSpaces] = useState(null);
  const [openId, setOpenId] = useState(null);   // space_id with form open
  const [doneId, setDoneId] = useState(null);   // space_id just submitted

  useEffect(() => {
    let alive = true;
    memberListHireableSpaces(venueId)
      .then((rows) => { if (alive) setSpaces(Array.isArray(rows) ? rows : []); })
      .catch((e) => { console.error("[roomhire] spaces load failed", e); if (alive) setSpaces([]); });
    return () => { alive = false; };
  }, [venueId]);

  if (!spaces || spaces.length === 0) return null;

  return (
    <div className="hs-wrap">
      <Styles />
      <h2 className="hs-head">Hire a space</h2>
      <p className="hs-sub">Rooms, studios and halls available for private hire.</p>
      {spaces.map((s) => (
        <div className="hs-card" key={s.space_id}>
          <div className="hs-name">
            {s.name}
            {s.is_enquiry_only && <span className="hs-badge">Enquiry</span>}
          </div>
          <div className="hs-info">
            {SPACE_TYPE_LABEL[s.space_type] || s.space_type} · up to {s.capacity}
            {s.description ? ` · ${s.description}` : ""}
          </div>

          {doneId === s.space_id ? (
            <p className="hs-ok">{s.is_enquiry_only ? "Enquiry sent — the venue will be in touch." : "Request sent — the venue will confirm availability and price."}</p>
          ) : openId === s.space_id ? (
            <HireForm
              space={s}
              requireAuth={requireAuth}
              onCancel={() => setOpenId(null)}
              onDone={() => { setOpenId(null); setDoneId(s.space_id); }}
            />
          ) : (
            <button className="hs-btn" onClick={() => setOpenId(s.space_id)}>
              {s.is_enquiry_only ? "Enquire" : "Request to hire"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function HireForm({ space, requireAuth, onCancel, onDone }) {
  const enquiry = space.is_enquiry_only;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [purpose, setPurpose] = useState("");
  const [attendees, setAttendees] = useState("");
  const [err, setErr] = useState(null);
  const savingRef = useRef(false);
  const [busy, setBusy] = useState(false);

  const valid = start && end && purpose.trim() && (!enquiry || (name.trim() && email.trim()));

  const submit = async () => {
    if (savingRef.current || !valid) return;
    const startsAt = new Date(start).toISOString();
    const endsAt = new Date(end).toISOString();
    const attendeeCount = attendees.trim() === "" ? null : parseInt(attendees, 10);

    const run = async () => {
      if (savingRef.current) return;
      savingRef.current = true; setBusy(true); setErr(null);
      try {
        let res;
        if (enquiry) {
          res = await publicEnquireRoomHire(space.space_id, {
            name: name.trim(), email: email.trim(), phone: phone.trim() || null,
            startsAt, endsAt, purpose: purpose.trim(), attendeeCount });
        } else {
          res = await memberRequestRoomHire(space.space_id, {
            startsAt, endsAt, purpose: purpose.trim(), attendeeCount });
        }
        if (res?.ok) onDone();
        else setErr(REASON_MSG[res?.reason] || "Couldn't send that — please try again.");
      } catch (e) {
        console.error("[roomhire] submit failed", e);
        setErr("Couldn't send that — please try again.");
      } finally {
        savingRef.current = false; setBusy(false);
      }
    };

    // Self-serve hire needs a member login; enquiry is anon.
    if (enquiry) run();
    else requireAuth(run, { reason: "Sign in to request a space. You'll only need to do this once." });
  };

  // Prefill enquiry email from any existing session (best effort).
  useEffect(() => {
    if (!enquiry) return;
    supabase.auth.getSession().then(({ data }) => {
      const e = data?.session?.user?.email;
      if (e) setEmail((cur) => cur || e);
    }).catch(() => {});
  }, [enquiry]);

  return (
    <div>
      {enquiry && (
        <>
          <div className="hs-row">
            <div>
              <label className="hs-label">Your name</label>
              <input className="hs-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </div>
            <div>
              <label className="hs-label">Phone (optional)</label>
              <input className="hs-input" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} />
            </div>
          </div>
          <label className="hs-label">Email</label>
          <input className="hs-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160} />
        </>
      )}
      <div className="hs-row">
        <div>
          <label className="hs-label">From</label>
          <input className="hs-input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label className="hs-label">To</label>
          <input className="hs-input" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <label className="hs-label">What's it for?</label>
      <input className="hs-input" value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={500} placeholder="e.g. birthday party, rehearsal" />
      <label className="hs-label">Expected attendees (optional)</label>
      <input className="hs-input" type="number" min="0" value={attendees} onChange={(e) => setAttendees(e.target.value)} />
      {err && <p className="hs-err">{err}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="hs-btn hs-btn--ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="hs-btn" onClick={submit} disabled={busy || !valid}>{busy ? "Sending…" : (enquiry ? "Send enquiry" : "Send request")}</button>
      </div>
    </div>
  );
}
