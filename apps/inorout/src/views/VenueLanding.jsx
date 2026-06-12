import { useState, useEffect } from "react";
import { supabase } from "@platform/core/storage/supabase.js";
import {
  getVenueLanding, joinRegisterTeam, redeemInviteLink, memberSelfSignup,
} from "@platform/core/storage/supabase.js";
import useRequireAuth from "../hooks/useRequireAuth.js";
import AuthGateModal from "../components/AuthGateModal.jsx";

// /q/<venue_code> (action venue_landing) — public "what's on at this venue".
// Shows venue branding + registerable competitions (setup/active) with their
// approved teams, and an auth-gated "register your team" flow that submits a
// pending competition_teams row via join_register_team (the venue's existing
// approval screen reviews it). Never shows private/casual teams. Slice 3.

function Styles() {
  return (
    <style>{`
      .vl-shell {
        min-height: 100dvh; width: 100%;
        padding: max(28px, env(safe-area-inset-top)) 18px max(40px, env(safe-area-inset-bottom));
        background: var(--bg); color: var(--t1);
        font-family: "DM Sans", sans-serif;
      }
      .vl-wrap { max-width: 460px; margin: 0 auto; }
      .vl-kicker { color: var(--t3); font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase; margin: 0 0 4px; }
      .vl-venue { font-family: "Bebas Neue", sans-serif; font-size: 40px; letter-spacing: 0.5px; margin: 0 0 20px; line-height: 1; }
      .vl-comp { background: var(--s1, rgba(255,255,255,0.04)); border-radius: 14px; padding: 16px; margin-bottom: 14px; }
      .vl-comp-name { font-family: "Bebas Neue", sans-serif; font-size: 24px; letter-spacing: 0.5px; margin: 0; }
      .vl-comp-sub { color: var(--t3); font-size: 12px; margin: 2px 0 12px; }
      .vl-teams { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
      .vl-team { font-size: 13px; color: var(--t2); background: rgba(255,255,255,0.05); border-radius: 999px; padding: 4px 10px; }
      .vl-empty-teams { color: var(--t3); font-size: 13px; margin-bottom: 14px; }
      .vl-cta {
        width: 100%; padding: 12px 16px; border: none; border-radius: 10px;
        background: var(--t1); color: var(--bg); font-family: "DM Sans", sans-serif;
        font-size: 15px; font-weight: 600; cursor: pointer;
      }
      .vl-field-label { display: block; color: var(--t3); font-size: 12px; margin: 12px 0 4px; }
      .vl-input {
        width: 100%; box-sizing: border-box; padding: 11px 12px; border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04);
        color: var(--t1); font-family: "DM Sans", sans-serif; font-size: 15px;
      }
      .vl-msg { font-size: 14px; line-height: 1.5; }
      .vl-msg--ok { color: var(--t1); }
      .vl-msg--err { color: #FF6060; font-size: 13px; margin-top: 8px; }
      .vl-muted { color: var(--t3); font-size: 13px; }
      .vl-row { display: flex; gap: 8px; margin-top: 12px; }
      .vl-row .vl-cta { flex: 1; }
      .vl-ghost { background: transparent; color: var(--t2); border: 1px solid rgba(255,255,255,0.14); }
      .vl-consent { display: flex; gap: 8px; align-items: flex-start; margin: 14px 0 0; color: var(--t2); font-size: 13px; line-height: 1.4; cursor: pointer; }
      .vl-consent input { margin-top: 2px; }
    `}</style>
  );
}

function RegisterForm({ comp, onDone, onCancel, inviteCode }) {
  const [name, setName]       = useState("");
  const [shortName, setShort] = useState("");
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);

  const submit = async () => {
    if (!name.trim()) { setError("Team name is required."); return; }
    setBusy(true); setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await joinRegisterTeam(comp.league_code, comp.competition_id, {
        name: name.trim(),
        short_name: shortName.trim() || undefined,
        admin_email: session?.user?.email || undefined,
      });
      // Best-effort use count — never block a successful registration.
      if (inviteCode) {
        try { await redeemInviteLink(inviteCode); }
        catch (e) { console.error("[invite] venue-landing redeem failed", e); }
      }
      onDone();
    } catch (e) {
      const code = e?.message || String(e);
      setError(
        code === "team_already_registered" ? "That team is already registered for this competition."
        : code === "competition_closed_to_registration" ? "This competition is closed to new registrations."
        : "Couldn't submit your registration. Please try again."
      );
    } finally { setBusy(false); }
  };

  return (
    <>
      <label className="vl-field-label">Team name</label>
      <input className="vl-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Thursday Rovers" maxLength={120} />
      <label className="vl-field-label">Short name (optional)</label>
      <input className="vl-input" value={shortName} onChange={(e) => setShort(e.target.value)} placeholder="e.g. ROV" maxLength={20} />
      {error && <p className="vl-msg--err">{error}</p>}
      <div className="vl-row">
        <button className="vl-cta vl-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="vl-cta" onClick={submit} disabled={busy}>{busy ? "Submitting…" : "Submit registration"}</button>
      </div>
    </>
  );
}

function MemberSignupForm({ code, onDone }) {
  const [f, setF]         = useState({ first: "", last: "", email: "", phone: "", consent: false });
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    if (!f.first.trim()) { setError("Your first name is required."); return; }
    setBusy(true); setError(null);
    try {
      const r = await memberSelfSignup(code, {
        firstName: f.first.trim(), lastName: f.last.trim() || null,
        email: f.email.trim() || null, phone: f.phone.trim() || null,
        consentMarketing: f.consent,
      });
      if (!r?.ok) {
        setError(r?.reason === "first_name_required" ? "Your first name is required." : "Couldn't submit your request. Please try again.");
        return;
      }
      onDone(r.already_registered ? (r.status === "active" ? "member" : "pending") : "new");
    } catch (e) {
      console.error("[membership] self-signup failed", e);
      setError("Couldn't submit your request. Please try again.");
    } finally { setBusy(false); }
  };

  return (
    <>
      <label className="vl-field-label">First name</label>
      <input className="vl-input" value={f.first} onChange={set("first")} placeholder="Your first name" maxLength={80} />
      <label className="vl-field-label">Last name (optional)</label>
      <input className="vl-input" value={f.last} onChange={set("last")} placeholder="Your last name" maxLength={80} />
      <label className="vl-field-label">Email (optional)</label>
      <input className="vl-input" type="email" value={f.email} onChange={set("email")} placeholder="you@example.com" maxLength={160} />
      <label className="vl-field-label">Phone (optional)</label>
      <input className="vl-input" type="tel" value={f.phone} onChange={set("phone")} placeholder="07…" maxLength={30} />
      <label className="vl-consent">
        <input type="checkbox" checked={f.consent} onChange={(e) => setF((p) => ({ ...p, consent: e.target.checked }))} />
        <span>Keep me updated about membership offers and events.</span>
      </label>
      {error && <p className="vl-msg--err">{error}</p>}
      <button className="vl-cta" onClick={submit} disabled={busy} style={{ marginTop: 12 }}>
        {busy ? "Submitting…" : "Request membership"}
      </button>
    </>
  );
}

export default function VenueLanding({ venueId, code }) {
  const [state, setState]   = useState({ phase: "loading" });
  const [openComp, setOpenComp] = useState(null);   // competition_id with the form open
  const [doneComp, setDoneComp] = useState(null);   // competition_id just submitted
  const [memberPhase, setMemberPhase] = useState("idle"); // idle | open | new | pending | member
  const { requireAuth, gateProps } = useRequireAuth();

  useEffect(() => {
    let alive = true;
    getVenueLanding(venueId)
      .then((data) => { if (alive) setState({ phase: "done", data }); })
      .catch((e) => { console.error("[invite] venue landing threw", e); if (alive) setState({ phase: "done", data: null }); });
    return () => { alive = false; };
  }, [venueId]);

  if (state.phase === "loading") {
    return <div className="vl-shell"><Styles /><div className="vl-wrap"><p className="vl-muted">Loading…</p></div></div>;
  }

  const data = state.data;
  if (!data || data.status !== "ok") {
    return (
      <div className="vl-shell"><Styles /><div className="vl-wrap">
        <h1 className="vl-venue">Venue not found</h1>
        <p className="vl-muted">This venue link is invalid or no longer active.</p>
      </div></div>
    );
  }

  const venue = data.venue || {};
  const comps = data.competitions || [];

  return (
    <div className="vl-shell">
      <Styles />
      <div className="vl-wrap">
        <p className="vl-kicker">What's on at</p>
        <h1 className="vl-venue">{venue.name}</h1>

        {comps.length === 0 && (
          <p className="vl-muted">No competitions are open for registration right now.</p>
        )}

        {comps.map((c) => (
          <div className="vl-comp" key={c.competition_id}>
            <h2 className="vl-comp-name">{c.name}</h2>
            <p className="vl-comp-sub">{c.league_name}</p>

            {c.teams.length > 0 ? (
              <div className="vl-teams">
                {c.teams.map((t) => <span className="vl-team" key={t.team_id}>{t.name}</span>)}
              </div>
            ) : (
              <p className="vl-empty-teams">No teams yet — be the first to register.</p>
            )}

            {doneComp === c.competition_id ? (
              <p className="vl-msg vl-msg--ok">
                Registration submitted. The venue will review it and confirm your place.
              </p>
            ) : openComp === c.competition_id ? (
              <RegisterForm
                comp={c}
                inviteCode={code}
                onCancel={() => setOpenComp(null)}
                onDone={() => { setOpenComp(null); setDoneComp(c.competition_id); }}
              />
            ) : (
              <button
                className="vl-cta"
                onClick={() => requireAuth(() => setOpenComp(c.competition_id), {
                  reason: `Sign in to register a team for ${c.name}. You'll only need to do this once.`,
                })}
              >
                Register your team
              </button>
            )}
          </div>
        ))}

        {/* Become a member — self-signup → pending venue approval (mig 275) */}
        <div className="vl-comp">
          <h2 className="vl-comp-name">Become a member</h2>
          <p className="vl-comp-sub">Join {venue.name} and unlock member perks.</p>
          {memberPhase === "new" ? (
            <p className="vl-msg vl-msg--ok">Thanks! The venue will review your request and confirm your membership.</p>
          ) : memberPhase === "pending" ? (
            <p className="vl-msg vl-msg--ok">You're already on the list — the venue will confirm your place shortly.</p>
          ) : memberPhase === "member" ? (
            <p className="vl-msg vl-msg--ok">You're already a member here. See reception if you need your pass.</p>
          ) : memberPhase === "open" ? (
            <MemberSignupForm code={code} onDone={(outcome) => setMemberPhase(outcome)} />
          ) : (
            <button className="vl-cta" onClick={() => setMemberPhase("open")}>Join as a member</button>
          )}
        </div>
      </div>
      <AuthGateModal {...gateProps} />
    </div>
  );
}
