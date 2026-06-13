import { useState, useEffect } from "react";
import { supabase } from "@platform/core/storage/supabase.js";
import {
  getVenueLanding, joinRegisterTeam, redeemInviteLink, memberSelfSignup, getVenueSignupTiers,
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

const EMPTY_FORM = {
  first: "", last: "", email: "", phone: "", dob: "", gender: "",
  addr1: "", addr2: "", city: "", postcode: "",
  emName: "", emRel: "", emPhone: "",
  medConditions: "", allergies: "", medications: "", gp: "",
  gName: "", gRel: "", gPhone: "", gEmail: "",
  consentData: false, consentTerms: false, consentPhoto: false, consentMedical: false,
  consentMarketing: false,
};

function MemberSignupForm({ code, tiers, onDone }) {
  const [tierId, setTierId] = useState(tiers.length === 1 ? tiers[0].tier_id : "");
  const [f, setF]         = useState(EMPTY_FORM);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const chk = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.checked }));
  const selectedTier = tiers.find((t) => t.tier_id === tierId) || null;

  const age = ageFromDob(f.dob);
  const isMinor = age !== null && age < 18;
  const hasMedical = !!(f.medConditions.trim() || f.allergies.trim() || f.medications.trim() || f.gp.trim());

  const submit = async () => {
    if (!f.first.trim()) { setError("Your first name is required."); return; }
    if (tiers.length > 0 && !tierId) { setError("Please choose a membership."); return; }
    if (!f.consentData || !f.consentTerms) { setError("Please agree to the data-protection and membership terms."); return; }
    if (isMinor && (!f.gName.trim() || !f.gPhone.trim())) { setError("A parent/guardian name and phone are required for under-18s."); return; }
    if (hasMedical && !f.consentMedical) { setError("Please confirm consent to store the medical information you've entered."); return; }
    setBusy(true); setError(null);
    try {
      const r = await memberSelfSignup(code, {
        firstName: f.first.trim(), lastName: f.last.trim() || null,
        email: f.email.trim() || null, phone: f.phone.trim() || null,
        consentMarketing: f.consentMarketing, tierId: tierId || null,
        dob: f.dob || null, gender: f.gender.trim() || null,
        addressLine1: f.addr1.trim() || null, addressLine2: f.addr2.trim() || null,
        addressCity: f.city.trim() || null, addressPostcode: f.postcode.trim() || null,
        emergencyName: f.emName.trim() || null, emergencyRelationship: f.emRel.trim() || null,
        emergencyPhone: f.emPhone.trim() || null,
        medicalConditions: f.medConditions.trim() || null, allergies: f.allergies.trim() || null,
        medications: f.medications.trim() || null, gpDetails: f.gp.trim() || null,
        guardianName: f.gName.trim() || null, guardianRelationship: f.gRel.trim() || null,
        guardianPhone: f.gPhone.trim() || null, guardianEmail: f.gEmail.trim() || null,
        consentDataProcessing: f.consentData, consentTerms: f.consentTerms,
        consentPhoto: f.consentPhoto, consentMedical: f.consentMedical,
      });
      if (!r?.ok) {
        setError(r?.reason === "tier_unavailable" ? "That membership isn't available — pick another."
          : r?.reason === "first_name_required" ? "Your first name is required."
          : r?.reason === "consent_required" ? "Please agree to the data-protection and membership terms."
          : r?.reason === "guardian_required" ? "A parent/guardian name and phone are required for under-18s."
          : r?.reason === "medical_consent_required" ? "Please confirm consent to store the medical information you've entered."
          : "Couldn't submit your request. Please try again.");
        return;
      }
      if (r.already_registered) { onDone(r.status === "active" ? "member" : "pending"); return; }
      if (r.free) { onDone("joined", { passToken: r.pass_token }); return; }
      onDone("new");
    } catch (e) {
      console.error("[membership] self-signup failed", e);
      setError("Couldn't submit your request. Please try again.");
    } finally { setBusy(false); }
  };

  return (
    <>
      {tiers.length > 0 && (
        <>
          <label className="vl-field-label">Choose your membership</label>
          <div style={{ display: "grid", gap: 8 }}>
            {tiers.map((t) => (
              <button key={t.tier_id} type="button" onClick={() => setTierId(t.tier_id)}
                className={"vl-tier" + (tierId === t.tier_id ? " vl-tier--on" : "")}>
                <span>{t.name}{t.benefits?.discount_pct ? <span className="vl-muted"> · {t.benefits.discount_pct}% off bookings</span> : null}</span>
                <strong>{tierPrice(t)}</strong>
              </button>
            ))}
          </div>
        </>
      )}

      <p className="vl-section">Your details</p>
      <div className="vl-two">
        <div>
          <label className="vl-field-label">First name</label>
          <input className="vl-input" value={f.first} onChange={set("first")} placeholder="First name" maxLength={80} />
        </div>
        <div>
          <label className="vl-field-label">Last name</label>
          <input className="vl-input" value={f.last} onChange={set("last")} placeholder="Last name" maxLength={80} />
        </div>
      </div>
      <div className="vl-two">
        <div>
          <label className="vl-field-label">Date of birth</label>
          <input className="vl-input" type="date" value={f.dob} onChange={set("dob")} />
        </div>
        <div>
          <label className="vl-field-label">Gender (optional)</label>
          <input className="vl-input" value={f.gender} onChange={set("gender")} placeholder="e.g. Female" maxLength={40} />
        </div>
      </div>
      <label className="vl-field-label">Email (optional)</label>
      <input className="vl-input" type="email" value={f.email} onChange={set("email")} placeholder="you@example.com" maxLength={160} />
      <label className="vl-field-label">Phone (optional)</label>
      <input className="vl-input" type="tel" value={f.phone} onChange={set("phone")} placeholder="07…" maxLength={30} />

      <p className="vl-section">Address</p>
      <label className="vl-field-label">Address line 1</label>
      <input className="vl-input" value={f.addr1} onChange={set("addr1")} placeholder="House / street" maxLength={120} />
      <label className="vl-field-label">Address line 2 (optional)</label>
      <input className="vl-input" value={f.addr2} onChange={set("addr2")} maxLength={120} />
      <div className="vl-two">
        <div>
          <label className="vl-field-label">Town / city</label>
          <input className="vl-input" value={f.city} onChange={set("city")} maxLength={80} />
        </div>
        <div>
          <label className="vl-field-label">Postcode</label>
          <input className="vl-input" value={f.postcode} onChange={set("postcode")} maxLength={12} />
        </div>
      </div>

      <p className="vl-section">Emergency contact</p>
      <label className="vl-field-label">Name</label>
      <input className="vl-input" value={f.emName} onChange={set("emName")} placeholder="Contact name" maxLength={120} />
      <div className="vl-two">
        <div>
          <label className="vl-field-label">Relationship</label>
          <input className="vl-input" value={f.emRel} onChange={set("emRel")} placeholder="e.g. Partner" maxLength={60} />
        </div>
        <div>
          <label className="vl-field-label">Phone</label>
          <input className="vl-input" type="tel" value={f.emPhone} onChange={set("emPhone")} placeholder="07…" maxLength={30} />
        </div>
      </div>

      <p className="vl-section">Medical &amp; safeguarding</p>
      <p className="vl-hint">Optional — but anything you share is treated as sensitive data and only used to keep you safe.</p>
      <label className="vl-field-label">Medical conditions</label>
      <input className="vl-input" value={f.medConditions} onChange={set("medConditions")} maxLength={300} />
      <label className="vl-field-label">Allergies</label>
      <input className="vl-input" value={f.allergies} onChange={set("allergies")} maxLength={300} />
      <label className="vl-field-label">Medications</label>
      <input className="vl-input" value={f.medications} onChange={set("medications")} maxLength={300} />
      <label className="vl-field-label">GP / doctor details</label>
      <input className="vl-input" value={f.gp} onChange={set("gp")} maxLength={200} />

      {isMinor && (
        <>
          <p className="vl-section">Parent / guardian</p>
          <p className="vl-hint">Required because the member is under 18.</p>
          <label className="vl-field-label">Guardian name</label>
          <input className="vl-input" value={f.gName} onChange={set("gName")} maxLength={120} />
          <div className="vl-two">
            <div>
              <label className="vl-field-label">Relationship</label>
              <input className="vl-input" value={f.gRel} onChange={set("gRel")} placeholder="e.g. Mother" maxLength={60} />
            </div>
            <div>
              <label className="vl-field-label">Phone</label>
              <input className="vl-input" type="tel" value={f.gPhone} onChange={set("gPhone")} placeholder="07…" maxLength={30} />
            </div>
          </div>
          <label className="vl-field-label">Guardian email (optional)</label>
          <input className="vl-input" type="email" value={f.gEmail} onChange={set("gEmail")} maxLength={160} />
        </>
      )}

      <p className="vl-section">Consent</p>
      <label className="vl-consent">
        <input type="checkbox" checked={f.consentData} onChange={chk("consentData")} />
        <span>I consent to the venue storing and processing my personal data for membership administration. <strong>(required)</strong></span>
      </label>
      <label className="vl-consent">
        <input type="checkbox" checked={f.consentTerms} onChange={chk("consentTerms")} />
        <span>I agree to the membership terms and code of conduct. <strong>(required)</strong></span>
      </label>
      <label className="vl-consent">
        <input type="checkbox" checked={f.consentPhoto} onChange={chk("consentPhoto")} />
        <span>I consent to photos/video being taken at events for club use.</span>
      </label>
      {hasMedical && (
        <label className="vl-consent">
          <input type="checkbox" checked={f.consentMedical} onChange={chk("consentMedical")} />
          <span>I consent to the club storing the medical information above. <strong>(required)</strong></span>
        </label>
      )}
      <label className="vl-consent">
        <input type="checkbox" checked={f.consentMarketing} onChange={chk("consentMarketing")} />
        <span>Keep me updated about membership offers and events.</span>
      </label>

      {error && <p className="vl-msg--err">{error}</p>}
      <button className="vl-cta" onClick={submit} disabled={busy} style={{ marginTop: 16 }}>
        {busy ? "Submitting…" : selectedTier?.is_free ? "Join now" : "Request membership"}
      </button>
    </>
  );
}

export default function VenueLanding({ venueId, code }) {
  const [state, setState]   = useState({ phase: "loading" });
  const [openComp, setOpenComp] = useState(null);   // competition_id with the form open
  const [doneComp, setDoneComp] = useState(null);   // competition_id just submitted
  const [memberPhase, setMemberPhase] = useState("idle"); // idle | open | new | pending | member | joined
  const [signupTiers, setSignupTiers] = useState([]);
  const [joinedPass, setJoinedPass] = useState(null);     // pass_token for a free auto-join
  const { requireAuth, gateProps } = useRequireAuth();

  useEffect(() => {
    let alive = true;
    getVenueLanding(venueId)
      .then((data) => { if (alive) setState({ phase: "done", data }); })
      .catch((e) => { console.error("[invite] venue landing threw", e); if (alive) setState({ phase: "done", data: null }); });
    if (code) getVenueSignupTiers(code).then((r) => { if (alive && r?.ok) setSignupTiers(r.tiers || []); }).catch(() => {});
    return () => { alive = false; };
  }, [venueId, code]);

  const onSignupDone = (outcome, extra) => {
    if (outcome === "joined") setJoinedPass(extra?.passToken || null);
    setMemberPhase(outcome);
  };

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
          {memberPhase === "joined" ? (
            <div className="vl-msg vl-msg--ok">
              <p>You're in — welcome! Here's your membership pass:</p>
              {joinedPass && <p style={{ marginTop: 8 }}><a href={`/m/${joinedPass}`}>Open your pass →</a></p>}
            </div>
          ) : memberPhase === "new" ? (
            <p className="vl-msg vl-msg--ok">Thanks! The venue will review your request and confirm your membership.</p>
          ) : memberPhase === "pending" ? (
            <p className="vl-msg vl-msg--ok">You're already on the list — the venue will confirm your place shortly.</p>
          ) : memberPhase === "member" ? (
            <p className="vl-msg vl-msg--ok">You're already a member here. See reception if you need your pass.</p>
          ) : memberPhase === "open" ? (
            <MemberSignupForm code={code} tiers={signupTiers} onDone={onSignupDone} />
          ) : (
            <button className="vl-cta" onClick={() => setMemberPhase("open")}>Join as a member</button>
          )}
        </div>
      </div>
      <AuthGateModal {...gateProps} />
    </div>
  );
}
