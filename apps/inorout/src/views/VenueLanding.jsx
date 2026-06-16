import { useState, useEffect } from "react";
import { supabase } from "@platform/core/storage/supabase.js";
import {
  getVenueLanding, joinRegisterTeam, redeemInviteLink, getVenueSignupTiers,
} from "@platform/core/storage/supabase.js";
import useRequireAuth from "../hooks/useRequireAuth.js";
import AuthGateModal from "../components/AuthGateModal.jsx";
import MembershipSignup from "./MembershipSignup.jsx";
import ClassesTimetable from "./ClassesTimetable.jsx";
import HireSpace from "./HireSpace.jsx";

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
      .vl-section { font-family: "Bebas Neue", sans-serif; font-size: 18px; letter-spacing: 0.5px; margin: 22px 0 2px; color: var(--t2); }
      .vl-hint { color: var(--t3); font-size: 12px; margin: 2px 0 0; line-height: 1.4; }
      .vl-two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .vl-tier { display: flex; justify-content: space-between; align-items: center; gap: 10px; width: 100%; text-align: left;
        padding: 12px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.04);
        color: var(--t1); font-family: "DM Sans", sans-serif; font-size: 15px; cursor: pointer; }
      .vl-tier--on { border-color: var(--t1); background: rgba(255,255,255,0.10); }
      .vl-tier strong { font-family: "Bebas Neue", sans-serif; font-size: 18px; letter-spacing: 0.5px; white-space: nowrap; }
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

const tierPrice = (t) => {
  if (t.is_free) return "Free";
  const prices = Array.isArray(t.prices) ? t.prices : [];
  const monthly = prices.find((p) => p.period === "monthly") || prices[0];
  return monthly ? `£${(monthly.price_pence / 100).toFixed(monthly.price_pence % 100 ? 2 : 0)}/${monthly.period === "monthly" ? "mo" : monthly.period}` : "";
};

// age in whole years from a YYYY-MM-DD string (empty/invalid → null)
function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a;
}


export default function VenueLanding({ venueId, code }) {
  const [state, setState]   = useState({ phase: "loading" });
  const [openComp, setOpenComp] = useState(null);   // competition_id with the form open
  const [doneComp, setDoneComp] = useState(null);   // competition_id just submitted
  const [signupData, setSignupData] = useState(null);  // { venue_id, club, documents, tiers }
  const { requireAuth, gateProps } = useRequireAuth();

  useEffect(() => {
    let alive = true;
    getVenueLanding(venueId)
      .then((data) => { if (alive) setState({ phase: "done", data }); })
      .catch((e) => { console.error("[invite] venue landing threw", e); if (alive) setState({ phase: "done", data: null }); });
    if (code) getVenueSignupTiers(code).then((r) => { if (alive && r?.ok) setSignupData(r); }).catch(() => {});
    return () => { alive = false; };
  }, [venueId, code]);


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

        {/* Public "What's on" class timetable — zero footprint when no classes (mig 340) */}
        <ClassesTimetable venueId={venueId} requireAuth={requireAuth} />

        {/* "Hire a space" — zero footprint when the venue has no hireable spaces (mig 342) */}
        <HireSpace venueId={venueId} requireAuth={requireAuth} />

        {/* Become a member — Phase 7 wizard (mig 296) */}
        <div className="vl-comp">
          <MembershipSignup
            code={code}
            club={signupData?.club ?? null}
            documents={signupData?.documents ?? []}
            tiers={signupData?.tiers ?? []}
            onStart={(proceed) => requireAuth(proceed, { reason: "Sign in to join as a member. You'll only need to do this once." })}
          />
        </div>
      </div>
      <AuthGateModal {...gateProps} />
    </div>
  );
}
