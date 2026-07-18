// ClubTrialScreen — public "book a free trial" flow, DF Sports epic P4.
// Route: /c/<slug>/trial (dark — nothing links here until P5 wires the CTA).
//
// The whole flow lives in ONE route with internal step state (App.jsx routing is
// a custom switch, not react-router, and there is no history.pushState — 4 routes
// would be 4 full reloads). Steps: s1 parent → s2 child → s3 pick session → confirm.
//
// REUSE, no new booking logic (all authenticated, derive caller from auth.uid()):
//   S1 → member_self_create_profile   (after email-OTP via useRequireAuth)
//   S2 → member_register_child        (+ optional member_update_child for safeguarding)
//   S3 → club_list_trial_sessions     (anon read) then guardian_book_class_session
// club_capture_lead (anon) fires once at S1 as a drop-out safety net.
//
// The app is dark; this page is light. Palette is synthesized in clubTrial.css by
// color-mix off --white/--black/--cp-primary (epic decision #4) — no :root edits.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CaretLeft, ArrowRight, EnvelopeSimple, Phone, CalendarBlank, Sparkle,
  LockSimple, MapPin, Check, SpinnerGap, HourglassMedium, UsersThree, Bell,
  CheckCircle, SneakerMove, Drop, TShirt, Smiley, CalendarPlus, WarningCircle,
  ClockCountdown, PhoneCall,
} from "@phosphor-icons/react";
import {
  getClubPublic, clubCaptureLead, clubListTrialSessions,
  memberSelfCreateProfile, memberRegisterChild, memberUpdateChild,
  guardianBookClassSession,
} from "@platform/core";
import AuthGateModal from "../components/AuthGateModal.jsx";
import useRequireAuth from "../hooks/useRequireAuth.js";
import { themeVars, crestText } from "./ClubPublic/clubPublicHelpers.js";
import {
  schoolYearForDob, isEligible, slotDate, slotTime, longDate, buildIcs, downloadIcs,
} from "./ClubTrial/clubTrialHelpers.js";
import "./ClubTrial/clubTrial.css";

// ── small presentational pieces ─────────────────────────────────────────────
function NavBar({ title, onBack }) {
  return (
    <div className="ct-nav">
      {onBack
        ? <button className="ct-nav-back" onClick={onBack} aria-label="Back"><CaretLeft size={22} weight="thin" /></button>
        : <span />}
      <div className="ct-nav-title">{title}</div>
      <span className="ct-nav-spacer" />
    </div>
  );
}

function Progress({ step }) {
  return (
    <>
      <div className="ct-progress">
        <div className={`ct-progress-seg ${step >= 1 ? "on" : ""}`} />
        <div className={`ct-progress-seg ${step >= 2 ? "on" : ""}`} />
      </div>
      <div className="ct-steplabel">STEP {step} OF 2</div>
    </>
  );
}

function Field({ label, icon, hint, hintBrand, children }) {
  return (
    <div className="ct-field">
      {label ? <label className="ct-label">{label}</label> : null}
      <div className="ct-input-wrap">
        {icon ? <span className="ct-input-ic">{icon}</span> : null}
        {children}
      </div>
      {hint ? <div className={`ct-hint ${hintBrand ? "ct-hint--brand" : ""}`}>{hint}</div> : null}
    </div>
  );
}

function ErrLine({ children }) {
  if (!children) return null;
  return <div className="ct-err"><WarningCircle size={16} weight="thin" /> {children}</div>;
}

export default function ClubTrialScreen({ slug }) {
  const [phase, setPhase]   = useState("loading"); // loading | ready | notfound
  const [club, setClub]     = useState(null);
  const [branding, setBrand] = useState({});
  const [step, setStep]     = useState("s1");      // s1 | s2 | s3 | confirm

  const [parent, setParent] = useState({ name: "", email: "", phone: "" });
  const [child, setChild]   = useState({ firstName: "", lastName: "", dob: "", medical: "", ecName: "", ecPhone: "", consent: false });
  const [childProfileId, setChildProfileId] = useState(null);
  const [registeredDob, setRegisteredDob] = useState(null); // dob the child was registered with (see submitS2)

  const [sess, setSess]         = useState({ status: "idle", list: [] }); // idle|loading|ready|error
  const [selectedId, setSelId]  = useState(null);
  const [waitSheet, setWaitSheet] = useState(null); // the full session object when the sheet is open
  const [booking, setBooking]   = useState(null);   // { session, status, waitlist_position }

  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);
  const savingRef = useRef(false); // double-fire guard (CLAUDE.md convention) for the non-idempotent writes
  const { requireAuth, gateProps } = useRequireAuth();

  // Load the club (anon get_club_public — gated on published, same as the public page).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await getClubPublic(slug);
        if (!alive) return;
        if (r?.found) { setClub(r.club || {}); setBrand(r.branding || {}); setPhase("ready"); }
        else setPhase("notfound");
      } catch (e) {
        console.error("[trial] load club failed", e);
        if (alive) setPhase("notfound");
      }
    })();
    return () => { alive = false; };
  }, [slug]);

  // Override the hardcoded dark <body> while this light flow is mounted.
  useEffect(() => {
    document.body.classList.add("ct-light-body");
    return () => document.body.classList.remove("ct-light-body");
  }, []);

  const eligible = useMemo(
    () => (sess.list || []).filter((s) => isEligible(s, child.dob)),
    [sess.list, child.dob],
  );
  const groupName = useMemo(() => {
    const names = [...new Set(eligible.map((s) => s.class_name).filter(Boolean))];
    return names.length === 1 ? names[0] : null;
  }, [eligible]);
  const selected = eligible.find((s) => s.session_id === selectedId) || null;
  const firstName = child.firstName.trim() || "your child";

  // ── handlers ──────────────────────────────────────────────────────────────
  const back = () => {
    setErr(null);
    if (step === "s2") setStep("s1");
    else if (step === "s3") setStep("s2");
    else if (step === "s1") window.location.href = `/c/${slug}`;
  };

  const createProfileThenNext = async () => {
    setBusy(true); setErr(null);
    const [first, ...rest] = parent.name.trim().split(/\s+/);
    try {
      const r = await memberSelfCreateProfile({
        firstName: first,
        lastName:  rest.join(" ") || null,
        email:     parent.email.trim() || null,
        phone:     parent.phone.trim() || null,
      });
      if (r?.ok || r?.reason === "profile_exists") { setStep("s2"); return; }
      setErr("Couldn't set up your account — please try again.");
    } catch (e) {
      console.error("[trial] create profile failed", e);
      if (String(e?.message).includes("profile_exists")) { setStep("s2"); return; }
      setErr("Couldn't set up your account — please try again.");
    } finally { setBusy(false); }
  };

  const submitS1 = () => {
    setErr(null);
    const name = parent.name.trim(), email = parent.email.trim();
    if (!name)  return setErr("Please enter your name.");
    if (!email || !email.includes("@")) return setErr("Please enter a valid email address.");
    // Drop-out safety net: capture the lead now (anon), before auth. Fire-and-forget —
    // a soft failure must not block the parent from continuing to book.
    clubCaptureLead({
      slug, parentName: name, parentEmail: email, parentPhone: parent.phone.trim() || null,
    }).catch((e) => console.error("[trial] lead capture failed", e));
    // Authenticate (email OTP, creates the user if new), then create the profile.
    requireAuth(createProfileThenNext, {
      reason: `Sign in to book a free trial${club?.name ? " at " + club.name : ""}. You'll only need to do this once.`,
    });
  };

  const loadSessions = async () => {
    setSess({ status: "loading", list: [] });
    try {
      const r = await clubListTrialSessions(slug);
      const list = (r?.found && Array.isArray(r.sessions)) ? r.sessions : [];
      setSess({ status: "ready", list });
    } catch (e) {
      console.error("[trial] list sessions failed", e);
      setSess({ status: "error", list: [] });
    }
  };

  const submitS2 = async () => {
    setErr(null);
    const first = child.firstName.trim(), last = child.lastName.trim();
    if (!first)         return setErr("Please enter your child's first name.");
    if (!child.dob)     return setErr("Please add your child's date of birth.");
    if (!child.consent) return setErr("Please confirm you're the parent or guardian.");
    if (savingRef.current) return; // double-fire guard
    savingRef.current = true;
    setBusy(true);
    // Optional safeguarding details (existing member_update_child keys).
    const details = {};
    if (child.medical.trim()) details.medical_conditions = child.medical.trim();
    if (child.ecName.trim())  details.ec1_name = child.ecName.trim();
    if (child.ecPhone.trim()) details.ec1_phone = child.ecPhone.trim();
    try {
      // The Back button (s3 → s2) makes re-entry a NORMAL path, and
      // member_register_child is non-idempotent — it INSERTs a fresh member_profiles
      // row + guardian link every call. So register a NEW child only when we don't
      // already have one for this dob; a repeat with the same dob updates in place, so
      // a back→forward round-trip can't orphan a child row each time. dob is the one
      // identity field member_update_child cannot change, so a changed dob (a genuine
      // correction) forces a fresh registration.
      if (childProfileId && registeredDob === child.dob) {
        try { await memberUpdateChild(childProfileId, { ...details, first_name: first, last_name: last || null }); }
        catch (e2) { console.error("[trial] child details update failed", e2); } // non-fatal
        setStep("s3"); loadSessions();
        return;
      }
      const r = await memberRegisterChild({
        first_name: first, last_name: last || null, dob: child.dob, relationship: "Parent/Guardian",
      });
      const cid = r?.child_profile_id;
      if (!cid) { setErr("Couldn't register your child — please try again."); return; }
      setChildProfileId(cid);
      setRegisteredDob(child.dob);
      if (Object.keys(details).length) {
        try { await memberUpdateChild(cid, details); }
        catch (e2) { console.error("[trial] child details save failed", e2); } // non-fatal
      }
      setStep("s3");
      loadSessions();
    } catch (e) {
      console.error("[trial] register child failed", e);
      setErr("Couldn't register your child — please try again.");
    } finally { setBusy(false); savingRef.current = false; }
  };

  const tapSlot = (s) => {
    setErr(null);
    if ((s.spots_left ?? 0) <= 0) { setWaitSheet(s); return; }
    setSelId(s.session_id);
  };

  const book = async (session) => {
    if (!session || !childProfileId) return;
    if (savingRef.current) return; // double-fire guard
    savingRef.current = true;
    setBusy(true); setErr(null);
    try {
      const r = await guardianBookClassSession(session.session_id, { forProfileId: childProfileId });
      if (r?.ok) {
        setBooking({ session, status: r.status, waitlist_position: r.waitlist_position });
        setWaitSheet(null); setStep("confirm"); return;
      }
      if (r?.reason === "already_booked") {
        setBooking({ session, status: r.status || "confirmed", waitlist_position: null });
        setWaitSheet(null); setStep("confirm"); return;
      }
      if (r?.reason === "suspended") { setErr("This account is temporarily suspended from booking."); return; }
      setErr("Couldn't book that session — please try again.");
    } catch (e) {
      console.error("[trial] book failed", e);
      const msg = String(e?.message || "");
      if (msg.includes("too_young_for_class") || msg.includes("too_old_for_class"))
        setErr(`That session isn't the right age group for ${firstName}.`);
      else if (msg.includes("session_not_bookable") || msg.includes("session_not_found"))
        setErr("That session is no longer available — please pick another.");
      else setErr("Couldn't book that session — please try again.");
    } finally { setBusy(false); savingRef.current = false; }
  };

  const addToCalendar = () => {
    if (!booking) return;
    const s = booking.session;
    const ics = buildIcs({
      title:       `${s.class_name || "Trial session"} — ${club?.name || ""}`.trim(),
      start:       s.starts_at,
      end:         s.ends_at,
      description: `Free trial session for ${child.firstName.trim() || "your child"}.`,
    });
    downloadIcs("trial-session.ics", ics);
  };

  // ── theming wrapper ─────────────────────────────────────────────────────────
  const wrap = (inner) => (
    <div className="club-trial" style={themeVars(branding)}>
      <div className="ct-col">{inner}</div>
      <AuthGateModal {...gateProps} />
    </div>
  );

  if (phase === "loading") {
    return wrap(<div className="ct-state"><SpinnerGap size={30} weight="thin" className="ct-spin" /></div>);
  }
  if (phase === "notfound") {
    return wrap(
      <div className="ct-state">
        <div className="ct-state-t">Not found</div>
        <div className="ct-state-s">This club page isn't available.</div>
      </div>,
    );
  }

  // ── S1 · parent ─────────────────────────────────────────────────────────────
  if (step === "s1") {
    return wrap(<>
      <NavBar title="Create your account" onBack={back} />
      <Progress step={1} />
      <div className="ct-screen">
        <div className="ct-clubchip">
          <div className="ct-crest">
            {branding?.crest_url ? <img src={branding.crest_url} alt="" /> : crestText(club)}
          </div>
          <div>
            <div className="ct-clubchip-name">{club?.name || "Free trial"}</div>
            <div className="ct-clubchip-sub">Book a free trial · no card needed</div>
          </div>
        </div>
        <h1 className="ct-title">Your details</h1>
        <p className="ct-sub">We just need a few details to get your child on the pitch.</p>

        <Field label="Your name">
          <input className="ct-input no-ic" type="text" autoComplete="name" placeholder="e.g. Emma Bennett"
            value={parent.name} onChange={(e) => setParent({ ...parent, name: e.target.value })} />
        </Field>
        <Field label="Email" icon={<EnvelopeSimple size={19} weight="thin" />}>
          <input className="ct-input" type="email" inputMode="email" autoComplete="email" placeholder="you@email.com"
            value={parent.email} onChange={(e) => setParent({ ...parent, email: e.target.value })} />
        </Field>
        <Field label="Mobile" icon={<Phone size={19} weight="thin" />}
          hint="Only used for booking reminders — never shared.">
          <input className="ct-input" type="tel" inputMode="tel" autoComplete="tel" placeholder="07…"
            value={parent.phone} onChange={(e) => setParent({ ...parent, phone: e.target.value })} />
        </Field>
        <ErrLine>{err}</ErrLine>
      </div>
      <div className="ct-footer">
        <button className="ct-btn" onClick={submitS1} disabled={busy}>
          {busy ? "One sec…" : <>Continue <ArrowRight size={19} weight="thin" /></>}
        </button>
      </div>
    </>);
  }

  // ── S2 · child ──────────────────────────────────────────────────────────────
  if (step === "s2") {
    const yr = schoolYearForDob(child.dob);
    const yrLabel = yr == null ? null
      : yr < 0 ? "pre-school" : yr === 0 ? "Reception" : `Year ${yr}`;
    return wrap(<>
      <NavBar title="Create your account" onBack={back} />
      <Progress step={2} />
      <div className="ct-screen">
        <h1 className="ct-title">About your child</h1>
        <p className="ct-sub">So we put them in the right group on the day.</p>

        <div className="ct-row2">
          <Field label="First name">
            <input className="ct-input no-ic" type="text" placeholder="First"
              value={child.firstName} onChange={(e) => setChild({ ...child, firstName: e.target.value })} />
          </Field>
          <Field label="Last name">
            <input className="ct-input no-ic" type="text" placeholder="Last"
              value={child.lastName} onChange={(e) => setChild({ ...child, lastName: e.target.value })} />
          </Field>
        </div>
        <Field label="Date of birth" icon={<CalendarBlank size={19} weight="thin" />}
          hint={yrLabel ? <><Sparkle size={14} weight="thin" /> {`School ${yrLabel} — we'll show the sessions they can join.`}</> : null}
          hintBrand={!!yrLabel}>
          <input className="ct-input" type="date"
            value={child.dob} onChange={(e) => setChild({ ...child, dob: e.target.value })} />
        </Field>
        <Field label="Medical / allergy notes (optional)">
          <textarea className="ct-input no-ic" rows={2} placeholder="Anything the coach should know"
            value={child.medical} onChange={(e) => setChild({ ...child, medical: e.target.value })} />
        </Field>
        <div className="ct-row2">
          <Field label="Emergency contact (optional)">
            <input className="ct-input no-ic" type="text" placeholder="Name"
              value={child.ecName} onChange={(e) => setChild({ ...child, ecName: e.target.value })} />
          </Field>
          <Field label="Contact number" icon={<PhoneCall size={19} weight="thin" />}>
            <input className="ct-input" type="tel" inputMode="tel" placeholder="Phone"
              value={child.ecPhone} onChange={(e) => setChild({ ...child, ecPhone: e.target.value })} />
          </Field>
        </div>

        <label className="ct-consent">
          <span className={`ct-check ${child.consent ? "on" : ""}`}>
            {child.consent ? <Check size={15} weight="thin" /> : null}
          </span>
          <input type="checkbox" style={{ display: "none" }} checked={child.consent}
            onChange={(e) => setChild({ ...child, consent: e.target.checked })} />
          <span className="ct-consent-txt">
            I'm {child.firstName.trim() || "my child"}'s parent or guardian and consent to them taking part in a trial session.
          </span>
        </label>
        <ErrLine>{err}</ErrLine>
        <div className="ct-hint"><LockSimple size={14} weight="thin" /> Your details are kept private & GDPR-safe.</div>
      </div>
      <div className="ct-footer">
        <button className="ct-btn" onClick={submitS2} disabled={busy}>
          {busy ? "One sec…" : <>Find a session <ArrowRight size={19} weight="thin" /></>}
        </button>
      </div>
    </>);
  }

  // ── S3 · pick a session ─────────────────────────────────────────────────────
  if (step === "s3") {
    const confirmLabel = selected
      ? `Confirm ${slotDate(selected.starts_at).dow} ${slotDate(selected.starts_at).dnum}, ${slotTime(selected.starts_at, selected.ends_at)}`
      : "Select a session";
    return wrap(<>
      <NavBar title="Pick a session" onBack={back} />
      <div className="ct-screen" style={{ paddingTop: 8 }}>
        <h1 className="ct-title">Free trial for {child.firstName.trim() || "your child"}</h1>

        {sess.status === "loading" ? (
          <>
            <div className="ct-skel banner" />
            <div className="ct-skel" /><div className="ct-skel" /><div className="ct-skel" />
            <div className="ct-loading-note"><SpinnerGap size={18} weight="thin" className="ct-spin" /> Finding sessions…</div>
          </>
        ) : sess.status === "error" ? (
          <div className="ct-empty">
            <WarningCircle size={30} weight="thin" className="ic" />
            <div className="ct-empty-t">We couldn't load sessions</div>
            <div className="ct-empty-s">Please try again in a moment.</div>
          </div>
        ) : eligible.length === 0 ? (
          <div className="ct-empty">
            <ClockCountdown size={30} weight="thin" className="ic" />
            <div className="ct-empty-t">No trial sessions right now</div>
            <div className="ct-empty-s">
              There's nothing on for {firstName}'s group in the next few weeks. We've saved your
              details and {club?.name || "the club"} will be in touch.
            </div>
          </div>
        ) : (
          <>
            {groupName ? (
              <div className="ct-banner">
                <Sparkle size={18} weight="thin" className="ic" />
                <div className="ct-banner-txt">Based on their age, {firstName} joins the <b>{groupName}</b> group.</div>
              </div>
            ) : null}
            {eligible.map((s) => {
              const d = slotDate(s.starts_at);
              const full = (s.spots_left ?? 0) <= 0;
              const sel = s.session_id === selectedId;
              return (
                <button key={s.session_id} className={`ct-slot ${sel ? "sel" : ""} ${full ? "full" : ""}`}
                  onClick={() => tapSlot(s)}>
                  <div className="ct-slot-date">
                    <div className="dow">{d.dow}</div>
                    <div className="dnum">{d.dnum}</div>
                  </div>
                  <div className="ct-slot-div" />
                  <div className="ct-slot-mid">
                    <div className="ct-slot-time">{slotTime(s.starts_at, s.ends_at)}</div>
                    <div className="ct-slot-meta">{s.class_name}</div>
                    {!full ? (
                      <div className="ct-slot-spaces">{s.spots_left} space{s.spots_left === 1 ? "" : "s"} left</div>
                    ) : null}
                  </div>
                  {full
                    ? <span className="ct-tag-full"><ClockCountdown size={13} weight="thin" /> FULL</span>
                    : <span className={`ct-radio ${sel ? "on" : ""}`}>{sel ? <Check size={15} weight="thin" /> : null}</span>}
                </button>
              );
            })}
          </>
        )}
        <ErrLine>{err}</ErrLine>
      </div>

      {eligible.length > 0 && sess.status === "ready" ? (
        <div className="ct-footer">
          <button className="ct-btn" onClick={() => book(selected)} disabled={!selected || busy}>
            {busy ? "Booking…" : confirmLabel}
          </button>
        </div>
      ) : null}

      {waitSheet ? (
        <div className="ct-scrim" onClick={() => setWaitSheet(null)}>
          <div className="ct-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="ct-grab" />
            <div className="ct-sheet-ic"><HourglassMedium size={26} weight="thin" /></div>
            <div className="ct-sheet-t">This session is full</div>
            <div className="ct-sheet-b">
              {slotDate(waitSheet.starts_at).dow} {slotDate(waitSheet.starts_at).dnum} · {slotTime(waitSheet.starts_at, waitSheet.ends_at)} is
              fully booked. Join the waiting list and we'll let you know the moment a space opens up.
            </div>
            <div className="ct-sheet-queue"><UsersThree size={18} weight="thin" /> We'll text you if a space frees up</div>
            <button className="ct-btn" onClick={() => book(waitSheet)} disabled={busy}>
              {busy ? "Joining…" : <><Bell size={18} weight="thin" /> Join the waiting list</>}
            </button>
            <button className="ct-textbtn" onClick={() => setWaitSheet(null)}>See other sessions</button>
          </div>
        </div>
      ) : null}
    </>);
  }

  // ── S4 · confirmation ───────────────────────────────────────────────────────
  const waitlisted = booking?.status === "waitlist";
  const bs = booking?.session || {};
  const bd = slotDate(bs.starts_at);
  return wrap(<>
    <div className="ct-conf-head">
      <div className="ct-conf-badge"><CheckCircle size={34} weight="thin" /></div>
      <div className="ct-conf-t">
        {waitlisted ? `You're on the list, ${child.firstName.trim() || "all set"}!` : `You're booked, ${child.firstName.trim() || "all set"}!`}
      </div>
      <div className="ct-conf-s">
        {waitlisted ? "We'll be in touch the moment a space opens up" : `See you on ${longDate(bs.starts_at)} 🎉`}
      </div>
      {waitlisted && booking?.waitlist_position ? (
        <div className="ct-waitchip"><UsersThree size={13} weight="thin" /> #{booking.waitlist_position} on the list</div>
      ) : null}
    </div>

    <div className="ct-conf-card">
      <div className="ct-slot-date">
        <div className="dow">{bd.dow}</div>
        <div className="dnum">{bd.dnum}</div>
      </div>
      <div className="ct-slot-div" />
      <div className="ct-conf-mid">
        <div className="t">{slotTime(bs.starts_at, bs.ends_at)}</div>
        <div className="m"><MapPin size={13} weight="thin" /> {bs.class_name || "Trial session"}</div>
      </div>
    </div>

    {!waitlisted ? (
      <div className="ct-bring">
        <div className="ct-bring-h">WHAT TO BRING</div>
        <div className="ct-bring-row"><SneakerMove size={20} weight="thin" className="ic" /><div><div className="t">Trainers or boots</div></div></div>
        <div className="ct-bring-row"><Drop size={20} weight="thin" className="ic" /><div><div className="t">A water bottle</div></div></div>
        <div className="ct-bring-row"><TShirt size={20} weight="thin" className="ic" /><div><div className="t">Comfy kit</div><div className="s">No kit? No problem.</div></div></div>
        <div className="ct-bring-row"><Smiley size={20} weight="thin" className="ic" /><div><div className="t">A smile</div></div></div>
      </div>
    ) : null}

    {parent.email.trim() ? (
      <div className="ct-emailed"><EnvelopeSimple size={18} weight="thin" className="ic" /> We've emailed the details to <b>{parent.email.trim()}</b></div>
    ) : null}

    <div className="ct-footer">
      {!waitlisted ? (
        <button className="ct-btn" onClick={addToCalendar}><CalendarPlus size={18} weight="thin" /> Add to calendar</button>
      ) : null}
      <button className="ct-textbtn" onClick={() => { window.location.href = "/hub"; }}>View my bookings</button>
    </div>
  </>);
}
