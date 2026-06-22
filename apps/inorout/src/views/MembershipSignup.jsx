import { useState, useRef, useEffect } from "react";
import {
  memberGetSelf, memberGetVenueMembershipPass, memberSelfCreateProfile,
  memberListChildren, memberRegisterChild, memberUpdateChild,
  memberAcceptConsent,
  uploadMemberIdDoc, memberSubmitIdDocument,
  memberEnrolMembership, stripeInitMemberCheckout, gcInitMemberMandate,
  supabase,
} from "@platform/core/storage/supabase.js";

// Phase 7 — /q membership signup wizard.
// Replaces the old v1 MemberSignupForm.
// Props: code (invite code string), club (from getVenueSignupTiers),
//        documents (policy_documents[]), tiers (tier[]), onDone (cb).

const PERIOD_LABEL = { monthly: "month", quarterly: "quarter", annual: "year", season: "season" };
const AUDIENCE_FOR_PATH = { adult: ["adult", "all", "family"], child: ["junior", "child", "all", "family"] };
const ID_DOC_TYPES = [
  { value: "passport",         label: "Passport" },
  { value: "driving_licence",  label: "Driving licence" },
  { value: "pass_card",        label: "PASS card (proof of age)" },
  { value: "birth_certificate", label: "Birth certificate (juniors)" },
];

function fmt(pence) {
  return pence === 0 ? "Free" : `£${(pence / 100).toFixed(pence % 100 ? 2 : 0)}`;
}

function tierPrice(tier, period) {
  const prices = Array.isArray(tier.prices) ? tier.prices : [];
  const p = prices.find((x) => x.period === period && x.price_type === "standard") || prices.find((x) => x.period === period);
  return p ? fmt(p.price_pence) : null;
}

function defaultPeriod(tier) {
  const prices = Array.isArray(tier.prices) ? tier.prices : [];
  const monthly = prices.find((p) => p.period === "monthly" && p.price_type === "standard");
  return monthly ? "monthly" : prices[0]?.period ?? "monthly";
}

function Styles() {
  return (
    <style>{`
      .ms-section { font-family: "Bebas Neue", sans-serif; font-size: 18px; letter-spacing: 0.5px; margin: 20px 0 2px; color: var(--t2); }
      .ms-hint { color: var(--t3); font-size: 12px; margin: 2px 0 10px; line-height: 1.4; }
      .ms-field-label { display: block; color: var(--t3); font-size: 12px; margin: 10px 0 3px; }
      .ms-input {
        width: 100%; box-sizing: border-box; padding: 11px 12px; border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04);
        color: var(--t1); font-family: "DM Sans", sans-serif; font-size: 15px;
      }
      .ms-input:focus { outline: none; border-color: rgba(255,255,255,0.3); }
      .ms-two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .ms-btn {
        width: 100%; padding: 12px 16px; border: none; border-radius: 10px;
        background: var(--t1); color: var(--bg); font-family: "DM Sans", sans-serif;
        font-size: 15px; font-weight: 600; cursor: pointer; margin-top: 12px;
      }
      .ms-btn:disabled { opacity: 0.45; cursor: default; }
      .ms-ghost { background: transparent; color: var(--t2); border: 1px solid rgba(255,255,255,0.14); }
      .ms-row { display: flex; gap: 8px; }
      .ms-row .ms-btn { flex: 1; margin-top: 12px; }
      .ms-tier {
        display: flex; justify-content: space-between; align-items: center; gap: 10px;
        width: 100%; text-align: left; padding: 12px 14px; border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.14); background: rgba(255,255,255,0.04);
        color: var(--t1); font-family: "DM Sans", sans-serif; font-size: 15px;
        cursor: pointer; margin-top: 8px;
      }
      .ms-tier--on { border-color: var(--t1); background: rgba(255,255,255,0.10); }
      .ms-tier strong { font-family: "Bebas Neue", sans-serif; font-size: 18px; letter-spacing: 0.5px; white-space: nowrap; }
      .ms-period-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
      .ms-period-btn {
        padding: 7px 14px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.04); color: var(--t2);
        font-family: "DM Sans", sans-serif; font-size: 13px; cursor: pointer;
      }
      .ms-period-btn--on { border-color: var(--t1); color: var(--t1); background: rgba(255,255,255,0.10); }
      .ms-subtotal { font-family: "Bebas Neue", sans-serif; font-size: 28px; letter-spacing: 0.5px; margin: 14px 0 0; }
      .ms-subtotal-label { color: var(--t3); font-size: 12px; margin: 0; }
      .ms-child-card {
        display: flex; align-items: center; justify-content: space-between;
        padding: 12px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.04); cursor: pointer; width: 100%;
        text-align: left; color: var(--t1); font-family: "DM Sans", sans-serif;
        font-size: 15px; margin-top: 8px;
      }
      .ms-child-card--on { border-color: var(--t1); background: rgba(255,255,255,0.10); }
      .ms-child-name { font-weight: 600; }
      .ms-child-age { color: var(--t3); font-size: 13px; }
      .ms-doc-body {
        background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.10);
        border-radius: 10px; padding: 14px; max-height: 260px; overflow-y: auto;
        font-size: 13px; line-height: 1.6; color: var(--t2); white-space: pre-wrap;
        margin: 8px 0 14px; font-family: "DM Sans", sans-serif;
      }
      .ms-check { display: flex; gap: 8px; align-items: flex-start; margin: 10px 0 0; color: var(--t2); font-size: 13px; line-height: 1.4; cursor: pointer; }
      .ms-check input { margin-top: 2px; flex-shrink: 0; }
      .ms-err { color: #FF6060; font-size: 13px; margin-top: 8px; }
      .ms-ok { color: var(--t1); font-size: 14px; line-height: 1.5; }
      .ms-progress { color: var(--t3); font-size: 12px; margin: 0 0 14px; }
      .ms-file-label {
        display: flex; align-items: center; gap: 8px; padding: 11px 14px;
        border-radius: 10px; border: 1px solid rgba(255,255,255,0.14);
        background: rgba(255,255,255,0.04); color: var(--t2);
        font-family: "DM Sans", sans-serif; font-size: 14px; cursor: pointer; margin-top: 8px;
      }
      .ms-select {
        width: 100%; box-sizing: border-box; padding: 11px 12px; border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04);
        color: var(--t1); font-family: "DM Sans", sans-serif; font-size: 15px;
        -webkit-appearance: none;
      }
    `}</style>
  );
}

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

// ── Step: path selection ─────────────────────────────────────────────────────

function StepPath({ onSelect }) {
  return (
    <>
      <p className="ms-hint">Who are you registering?</p>
      <div className="ms-row">
        <button className="ms-btn ms-ghost" style={{ marginTop: 0 }} onClick={() => onSelect("adult")}>
          Myself
        </button>
        <button className="ms-btn ms-ghost" style={{ marginTop: 0 }} onClick={() => onSelect("child")}>
          My child
        </button>
      </div>
    </>
  );
}

// ── Step: create adult profile (if none exists) ──────────────────────────────

function StepCreateProfile({ onDone, onError }) {
  const [f, setF] = useState({ first: "", last: "", email: "", dob: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.email) setF((p) => ({ ...p, email: p.email || session.user.email }));
    }).catch(() => {});
  }, []);

  const submit = async () => {
    if (!f.first.trim()) { setErr("First name is required."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await memberSelfCreateProfile({
        firstName: f.first.trim(),
        lastName:  f.last.trim() || null,
        email:     f.email.trim() || null,
        dob:       f.dob || null,
        phone:     f.phone.trim() || null,
      });
      if (r?.ok) { onDone({ first: f.first.trim(), last: f.last.trim() }); return; }
      if (r?.reason === "profile_exists") { onDone(null); return; }
      setErr("Couldn't create your profile — please try again.");
    } catch (e) {
      console.error("[membership-signup] self create profile failed", e);
      if (String(e?.message).includes("profile_exists")) { onDone(null); return; }
      setErr("Couldn't create your profile — please try again.");
    } finally { setBusy(false); }
  };

  return (
    <>
      <p className="ms-section">Your details</p>
      <p className="ms-hint">We need a few details to create your member account.</p>
      <div className="ms-two">
        <div>
          <label className="ms-field-label">First name *</label>
          <input className="ms-input" value={f.first} onChange={set("first")} maxLength={80} placeholder="First name" />
        </div>
        <div>
          <label className="ms-field-label">Last name</label>
          <input className="ms-input" value={f.last} onChange={set("last")} maxLength={80} placeholder="Last name" />
        </div>
      </div>
      <label className="ms-field-label">Email</label>
      <input className="ms-input" type="email" value={f.email} onChange={set("email")} maxLength={160} placeholder="you@example.com" />
      <div className="ms-two">
        <div>
          <label className="ms-field-label">Date of birth</label>
          <input className="ms-input" type="date" value={f.dob} onChange={set("dob")} />
        </div>
        <div>
          <label className="ms-field-label">Phone</label>
          <input className="ms-input" type="tel" value={f.phone} onChange={set("phone")} maxLength={30} placeholder="07…" />
        </div>
      </div>
      {err && <p className="ms-err">{err}</p>}
      <button className="ms-btn" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Continue"}</button>
    </>
  );
}

// ── Step: pick existing child or add new ─────────────────────────────────────

function StepPickChild({ children, onSelect, onAddNew }) {
  return (
    <>
      <p className="ms-section">Who are you registering?</p>
      {children.length > 0 && (
        <>
          <p className="ms-hint">Select an existing child or add a new one.</p>
          {children.map((c) => {
            const age = ageFromDob(c.dob);
            return (
              <button key={c.id} className="ms-child-card" onClick={() => onSelect(c)}>
                <div>
                  <div className="ms-child-name">{c.first_name} {c.last_name}</div>
                  {age !== null && <div className="ms-child-age">Age {age}</div>}
                </div>
                <span style={{ color: "var(--t3)", fontSize: 20 }}>›</span>
              </button>
            );
          })}
        </>
      )}
      <button className="ms-btn ms-ghost" onClick={onAddNew} style={{ marginTop: children.length ? 10 : 0 }}>
        + Add a new child
      </button>
    </>
  );
}

// ── Step: register new child (name + DOB) ────────────────────────────────────

function StepAddChild({ onDone, onBack }) {
  const [f, setF] = useState({ first: "", last: "", dob: "", rel: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    if (!f.first.trim()) { setErr("Child's first name is required."); return; }
    if (!f.dob) { setErr("Date of birth is required."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await memberRegisterChild({
        first_name:   f.first.trim(),
        last_name:    f.last.trim() || null,
        dob:          f.dob,
        relationship: f.rel.trim() || null,
      });
      if (r?.child_profile_id) {
        onDone({ id: r.child_profile_id, first_name: f.first.trim(), last_name: f.last.trim(), dob: f.dob });
      } else {
        setErr("Couldn't register child — please try again.");
      }
    } catch (e) {
      console.error("[membership-signup] register child failed", e);
      setErr("Couldn't register child — please try again.");
    } finally { setBusy(false); }
  };

  return (
    <>
      <p className="ms-section">Child's details</p>
      <div className="ms-two">
        <div>
          <label className="ms-field-label">First name *</label>
          <input className="ms-input" value={f.first} onChange={set("first")} maxLength={80} placeholder="First name" />
        </div>
        <div>
          <label className="ms-field-label">Last name</label>
          <input className="ms-input" value={f.last} onChange={set("last")} maxLength={80} placeholder="Last name" />
        </div>
      </div>
      <label className="ms-field-label">Date of birth *</label>
      <input className="ms-input" type="date" value={f.dob} onChange={set("dob")} />
      <label className="ms-field-label">Your relationship to this child</label>
      <input className="ms-input" value={f.rel} onChange={set("rel")} maxLength={60} placeholder="e.g. Mother, Father, Guardian" />
      {err && <p className="ms-err">{err}</p>}
      <div className="ms-row">
        <button className="ms-btn ms-ghost" onClick={onBack} disabled={busy}>Back</button>
        <button className="ms-btn" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Continue"}</button>
      </div>
    </>
  );
}

// ── Step: CPSU child details (required at signup) ────────────────────────────

function StepChildDetails({ child, onDone, onBack }) {
  const [f, setF] = useState({
    ec1_name: "", ec1_relationship: "", ec1_phone: "",
    ec2_name: "", ec2_relationship: "", ec2_phone: "",
    send_notes: "", dietary_notes: "",
    consent_emergency_treatment: false,
    consent_administer_medication: false,
    may_leave_unaccompanied: false,
    authorised_collectors: "",
    medical_conditions: "", allergies: "", medications: "", gp_details: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const chk = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.checked }));

  const submit = async () => {
    if (!f.ec1_name.trim()) { setErr("Emergency contact name is required."); return; }
    if (!f.ec1_phone.trim()) { setErr("Emergency contact phone is required."); return; }
    if (!f.consent_emergency_treatment) { setErr("Please confirm consent for emergency medical treatment."); return; }
    setBusy(true); setErr(null);
    try {
      const updates = {};
      const fields = [
        "ec1_name","ec1_relationship","ec1_phone",
        "ec2_name","ec2_relationship","ec2_phone",
        "send_notes","dietary_notes",
        "consent_emergency_treatment","consent_administer_medication",
        "may_leave_unaccompanied","authorised_collectors",
        "medical_conditions","allergies","medications","gp_details",
      ];
      fields.forEach((k) => {
        const v = f[k];
        if (typeof v === "boolean") updates[k] = v;
        else if (v.trim()) updates[k] = v.trim();
      });
      await memberUpdateChild(child.id, updates);
      onDone();
    } catch (e) {
      console.error("[membership-signup] update child details failed", e);
      setErr("Couldn't save details — please try again.");
    } finally { setBusy(false); }
  };

  return (
    <>
      <p className="ms-section">Emergency contacts</p>
      <p className="ms-hint">Required for {child.first_name}'s safety at sessions.</p>

      <p className="ms-field-label" style={{ color: "var(--t2)", fontWeight: 600, marginTop: 12 }}>Contact 1 (required)</p>
      <label className="ms-field-label">Name *</label>
      <input className="ms-input" value={f.ec1_name} onChange={set("ec1_name")} maxLength={120} placeholder="Full name" />
      <div className="ms-two">
        <div>
          <label className="ms-field-label">Relationship *</label>
          <input className="ms-input" value={f.ec1_relationship} onChange={set("ec1_relationship")} maxLength={60} placeholder="e.g. Mother" />
        </div>
        <div>
          <label className="ms-field-label">Phone *</label>
          <input className="ms-input" type="tel" value={f.ec1_phone} onChange={set("ec1_phone")} maxLength={30} placeholder="07…" />
        </div>
      </div>

      <p className="ms-field-label" style={{ color: "var(--t2)", fontWeight: 600, marginTop: 12 }}>Contact 2 (recommended)</p>
      <label className="ms-field-label">Name</label>
      <input className="ms-input" value={f.ec2_name} onChange={set("ec2_name")} maxLength={120} placeholder="Full name" />
      <div className="ms-two">
        <div>
          <label className="ms-field-label">Relationship</label>
          <input className="ms-input" value={f.ec2_relationship} onChange={set("ec2_relationship")} maxLength={60} placeholder="e.g. Father" />
        </div>
        <div>
          <label className="ms-field-label">Phone</label>
          <input className="ms-input" type="tel" value={f.ec2_phone} onChange={set("ec2_phone")} maxLength={30} placeholder="07…" />
        </div>
      </div>

      <p className="ms-section">Additional needs</p>
      <label className="ms-field-label">SEND / additional needs or adjustments needed</label>
      <input className="ms-input" value={f.send_notes} onChange={set("send_notes")} maxLength={300} placeholder="e.g. ADHD, autism, hearing impairment (or leave blank)" />
      <label className="ms-field-label">Dietary requirements</label>
      <input className="ms-input" value={f.dietary_notes} onChange={set("dietary_notes")} maxLength={200} placeholder="e.g. Nut allergy, vegetarian (or leave blank)" />

      <p className="ms-section">Medical</p>
      <p className="ms-hint">Optional — but anything shared is protected and only used to keep {child.first_name} safe.</p>
      <label className="ms-field-label">Medical conditions</label>
      <input className="ms-input" value={f.medical_conditions} onChange={set("medical_conditions")} maxLength={300} />
      <label className="ms-field-label">Allergies</label>
      <input className="ms-input" value={f.allergies} onChange={set("allergies")} maxLength={300} />
      <label className="ms-field-label">Medications</label>
      <input className="ms-input" value={f.medications} onChange={set("medications")} maxLength={300} />
      <label className="ms-field-label">GP / doctor details</label>
      <input className="ms-input" value={f.gp_details} onChange={set("gp_details")} maxLength={200} />

      <p className="ms-section">Consents</p>
      <label className="ms-check">
        <input type="checkbox" checked={f.consent_emergency_treatment} onChange={chk("consent_emergency_treatment")} />
        <span>I authorise {"{club name}"} staff to consent to emergency medical treatment for {child.first_name} if I cannot be reached. <strong>(required)</strong></span>
      </label>
      <label className="ms-check">
        <input type="checkbox" checked={f.consent_administer_medication} onChange={chk("consent_administer_medication")} />
        <span>I consent to staff administering prescribed medication to {child.first_name} as directed.</span>
      </label>
      <label className="ms-check">
        <input type="checkbox" checked={f.may_leave_unaccompanied} onChange={chk("may_leave_unaccompanied")} />
        <span>{child.first_name} may leave the session unaccompanied.</span>
      </label>
      {!f.may_leave_unaccompanied && (
        <>
          <label className="ms-field-label">Authorised collectors (names of people who may collect {child.first_name})</label>
          <input className="ms-input" value={f.authorised_collectors} onChange={set("authorised_collectors")} maxLength={300} placeholder="e.g. Sarah Jones, Mike Bennett" />
        </>
      )}

      {err && <p className="ms-err">{err}</p>}
      <div className="ms-row">
        <button className="ms-btn ms-ghost" onClick={onBack} disabled={busy}>Back</button>
        <button className="ms-btn" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Continue"}</button>
      </div>
    </>
  );
}

// ── Step: choose tier + period ────────────────────────────────────────────────

function StepTierSelect({ tiers, path, onDone, onBack }) {
  const allowed = AUDIENCE_FOR_PATH[path] ?? [];
  const filtered = tiers.filter((t) => allowed.includes(t.audience));
  const [tierId, setTierId] = useState(filtered.length === 1 ? filtered[0].tier_id : "");
  const [period, setPeriod] = useState("");
  const [err, setErr] = useState(null);

  const selectedTier = filtered.find((t) => t.tier_id === tierId) ?? null;

  useEffect(() => {
    if (selectedTier) setPeriod(defaultPeriod(selectedTier));
  }, [tierId]);

  const prices = selectedTier ? (Array.isArray(selectedTier.prices) ? selectedTier.prices : []) : [];
  const standardPrices = prices.filter((p) => p.price_type === "standard" || !p.price_type);
  const price = selectedTier ? tierPrice(selectedTier, period) : null;

  // Late-joiner breakdown: season plans that pro-rate and/or carry a joining fee
  // return first_charge_pence on the season price row (computed server-side, so
  // the displayed total always matches what's charged).
  const seasonRow = prices.find((p) => p.period === "season" && (p.price_type === "standard" || !p.price_type))
                 || prices.find((p) => p.period === "season");
  const showBreakdown = !!selectedTier && selectedTier.pricing_model === "season"
                     && period === "season" && seasonRow && seasonRow.first_charge_pence != null;
  const joiningFeePence = selectedTier?.joining_fee_pence || 0;
  const prorationDeduction = showBreakdown
    ? seasonRow.price_pence - (seasonRow.first_charge_pence - joiningFeePence)
    : 0;

  const submit = () => {
    if (!tierId) { setErr("Please select a membership."); return; }
    if (!period) { setErr("Please select a billing period."); return; }
    setErr(null);
    onDone({ tier: selectedTier, period });
  };

  if (filtered.length === 0) {
    return (
      <>
        <p className="ms-section">Membership</p>
        <p className="ms-hint">No memberships are currently available for this registration type. Please contact the club.</p>
        <button className="ms-btn ms-ghost" onClick={onBack}>Back</button>
      </>
    );
  }

  return (
    <>
      <p className="ms-section">Choose membership</p>
      {filtered.map((t) => {
        const ps = Array.isArray(t.prices) ? t.prices : [];
        const std = ps.find((p) => p.price_type === "standard") || ps[0];
        return (
          <button key={t.tier_id} type="button"
            className={"ms-tier" + (tierId === t.tier_id ? " ms-tier--on" : "")}
            onClick={() => setTierId(t.tier_id)}>
            <span>{t.name}</span>
            <strong>{std ? (t.is_free ? "Free" : `${fmt(std.price_pence)}/${PERIOD_LABEL[std.period] ?? std.period}`) : ""}</strong>
          </button>
        );
      })}

      {selectedTier && standardPrices.length > 1 && (
        <>
          <p className="ms-field-label" style={{ marginTop: 14 }}>Billing period</p>
          <div className="ms-period-row">
            {standardPrices.map((p) => (
              <button key={p.period} type="button"
                className={"ms-period-btn" + (period === p.period ? " ms-period-btn--on" : "")}
                onClick={() => setPeriod(p.period)}>
                {PERIOD_LABEL[p.period] ?? p.period}
              </button>
            ))}
          </div>
        </>
      )}

      {showBreakdown ? (
        <div style={{ marginTop: 14, borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--t3)", marginBottom: 4 }}>
            <span>Full season</span><span>{fmt(seasonRow.price_pence)}</span>
          </div>
          {prorationDeduction > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--t3)", marginBottom: 4 }}>
              <span>Joining mid-season</span><span>−{fmt(prorationDeduction)}</span>
            </div>
          )}
          {joiningFeePence > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--t3)", marginBottom: 4 }}>
              <span>Joining fee</span><span>+{fmt(joiningFeePence)}</span>
            </div>
          )}
          <p className="ms-subtotal-label" style={{ marginTop: 6 }}>You pay today</p>
          <p className="ms-subtotal">{fmt(seasonRow.first_charge_pence)}</p>
        </div>
      ) : selectedTier && price && (
        <>
          <p className="ms-subtotal-label">Total</p>
          <p className="ms-subtotal">{price}{period && period !== "season" ? <span style={{ fontSize: 16, color: "var(--t3)" }}> / {PERIOD_LABEL[period]}</span> : null}</p>
        </>
      )}

      {err && <p className="ms-err">{err}</p>}
      <div className="ms-row">
        <button className="ms-btn ms-ghost" onClick={onBack}>Back</button>
        <button className="ms-btn" onClick={submit} disabled={!tierId || !period}>Continue</button>
      </div>
    </>
  );
}

// ── Step: sign consent documents ─────────────────────────────────────────────

function StepConsent({ documents, forProfileId, onDone, onBack }) {
  const [idx, setIdx] = useState(0);
  const [sig, setSig] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const bodyRef = useRef(null);

  const doc = documents[idx] ?? null;
  const total = documents.length;

  useEffect(() => { setSig(""); setScrolled(false); setErr(null); }, [idx]);

  const handleScroll = (e) => {
    const el = e.target;
    if (el.scrollHeight - el.scrollTop <= el.clientHeight + 40) setScrolled(true);
  };

  const sign = async () => {
    if (!sig.trim()) { setErr("Please type your full name to sign."); return; }
    setBusy(true); setErr(null);
    try {
      await memberAcceptConsent(doc.document_id, sig.trim(), {
        onBehalfOfProfileId: forProfileId ?? null,
        userAgent: navigator.userAgent,
      });
      if (idx + 1 < total) {
        setIdx(idx + 1);
      } else {
        onDone();
      }
    } catch (e) {
      console.error("[membership-signup] accept consent failed", e);
      const msg = String(e?.message ?? "");
      if (msg.includes("already_accepted")) {
        if (idx + 1 < total) { setIdx(idx + 1); } else { onDone(); }
        return;
      }
      setErr("Couldn't save your signature — please try again.");
    } finally { setBusy(false); }
  };

  if (!doc) { onDone(); return null; }

  return (
    <>
      <p className="ms-section">Documents to sign</p>
      <p className="ms-progress">{idx + 1} of {total}</p>
      <p style={{ fontWeight: 600, fontSize: 15, margin: "0 0 6px" }}>{doc.title}</p>
      <div className="ms-doc-body" ref={bodyRef} onScroll={handleScroll}>{doc.body}</div>
      {!scrolled && <p className="ms-hint">Scroll to the bottom to continue.</p>}
      {scrolled && (
        <>
          <label className="ms-field-label">Type your full name to sign</label>
          <input className="ms-input" value={sig} onChange={(e) => setSig(e.target.value)}
            maxLength={120} placeholder="Your full name" />
          {forProfileId && (
            <p className="ms-hint">You are signing on behalf of the child you registered.</p>
          )}
          {err && <p className="ms-err">{err}</p>}
          <button className="ms-btn" onClick={sign} disabled={busy || !sig.trim()}>
            {busy ? "Signing…" : idx + 1 < total ? "Sign & continue" : "Sign & finish"}
          </button>
        </>
      )}
      <button className="ms-btn ms-ghost" onClick={onBack} disabled={busy} style={{ marginTop: 8 }}>Back</button>
    </>
  );
}

// ── Step: ID upload ──────────────────────────────────────────────────────────

function StepIdUpload({ club, memberProfileId, onDone, onSkip }) {
  const [docType, setDocType] = useState("passport");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const isUploadingRef = useRef(false);

  const upload = async () => {
    if (!file) { setErr("Please choose a file to upload."); return; }
    if (isUploadingRef.current) return;
    isUploadingRef.current = true;
    setBusy(true); setErr(null);
    try {
      const path = await uploadMemberIdDoc(memberProfileId, file);
      await memberSubmitIdDocument(club.id, docType, path);
      onDone();
    } catch (e) {
      console.error("[membership-signup] id upload failed", e);
      setErr("Upload failed — please try again or skip and upload later from your profile.");
    } finally { setBusy(false); isUploadingRef.current = false; }
  };

  return (
    <>
      <p className="ms-section">Proof of ID</p>
      <p className="ms-hint">{club.name} requires proof of age or identity. Please upload one of the following:</p>
      <label className="ms-field-label">Document type</label>
      <select className="ms-select" value={docType} onChange={(e) => setDocType(e.target.value)}>
        {ID_DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      <label className="ms-file-label">
        <span style={{ fontSize: 18 }}>📎</span>
        <span>{file ? file.name : "Choose file (JPG, PNG, PDF — max 10 MB)"}</span>
        <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
          style={{ display: "none" }}
          onChange={(e) => { setFile(e.target.files[0] ?? null); setErr(null); }} />
      </label>
      {err && <p className="ms-err">{err}</p>}
      <button className="ms-btn" onClick={upload} disabled={busy || !file}>
        {busy ? "Uploading…" : "Submit document"}
      </button>
      <button className="ms-btn ms-ghost" onClick={onSkip} disabled={busy}>
        Skip — I'll upload later from my profile
      </button>
    </>
  );
}

// ── Step: payment method choice (Phase 8) ────────────────────────────────────
// Shown only when venue has BOTH Stripe and GoCardless connected and the tier is paid.

function StepPaymentChoice({ onStripe, onGc }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 360 }}>
      <p style={{ margin: "0 0 4px", fontSize: 14, color: "var(--t3)" }}>How would you like to pay?</p>
      <button className="ms-btn" onClick={onStripe} style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 20 }}>💳</span>
        <span>Card / Apple Pay</span>
      </button>
      <button className="ms-btn ms-btn--secondary" onClick={onGc} style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 20 }}>🏦</span>
        <span>Direct Debit</span>
      </button>
    </div>
  );
}

// ── Step: GoCardless redirect enrol ──────────────────────────────────────────
// Creates a GC redirect flow and redirects the browser to the GC hosted page.
// On return, the mandate callback creates the membership row server-side.

function StepGcEnrol({ code, tier, period, forProfileId }) {
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState(null);
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;
    gcInitMemberMandate({ inviteCode: code, tierId: tier.tier_id, period, forProfileId: forProfileId ?? null })
      .then((r) => {
        if (r?.redirect_url) { window.location.href = r.redirect_url; }
        else { setErr("Couldn't start Direct Debit setup — please try again."); setBusy(false); }
      })
      .catch((e) => {
        console.error("[membership-signup] gc mandate failed", e);
        setErr("Couldn't start Direct Debit setup — please try again.");
        setBusy(false);
      });
  }, []);

  if (busy) return <p style={{ color: "var(--t3)", fontSize: 14 }}>Redirecting to Direct Debit setup…</p>;
  return (
    <>
      {err && <p className="ms-err">{err}</p>}
      {err && <button className="ms-btn" onClick={() => { hasRun.current = false; setErr(null); setBusy(true); }}>Try again</button>}
    </>
  );
}

// ── Step: enrol + done ────────────────────────────────────────────────────────
// Forks at runtime: paid tier + stripe_connected venue → Stripe Checkout redirect;
// free tier or no Stripe → direct memberEnrolMembership call.

function StepEnrol({ code, tier, period, forProfileId, club, onDone, returnCode = null }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const hasRun = useRef(false);

  const useStripe = !tier?.is_free && !!club?.stripe_connected;

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;
    setBusy(true);
    if (useStripe) {
      // returnCode (club-team join) brings the payer back to the join screen so it
      // can land them on the team after the webhook confirms the membership.
      stripeInitMemberCheckout({ inviteCode: code, tierId: tier.tier_id, period, forProfileId: forProfileId ?? null, returnCode: returnCode ?? null })
        .then((r) => {
          if (r?.checkout_url) { window.location.href = r.checkout_url; }
          else { setErr("Couldn't start payment — please try again."); setBusy(false); }
        })
        .catch((e) => {
          console.error("[membership-signup] stripe checkout failed", e);
          setErr("Couldn't start payment — please try again.");
          setBusy(false);
        });
    } else {
      memberEnrolMembership(code, tier.tier_id, period, forProfileId ?? null)
        .then((r) => {
          if (r?.ok) { onDone(r.pass_token); }
          else { setErr("Enrolment failed — please try again."); setBusy(false); }
        })
        .catch((e) => {
          console.error("[membership-signup] enrol failed", e);
          setErr("Enrolment failed — please try again.");
          setBusy(false);
        });
    }
  }, []);

  if (busy) return <p style={{ color: "var(--t3)", fontSize: 14 }}>{useStripe ? "Redirecting to payment…" : "Setting up your membership…"}</p>;
  return (
    <>
      {err && <p className="ms-err">{err}</p>}
      {err && <button className="ms-btn" onClick={() => { hasRun.current = false; setErr(null); setBusy(true); }}>Try again</button>}
    </>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export default function MembershipSignup({ code, club, documents, tiers, onStart, clubTeamCode = null, onEnrolled = null }) {
  const [step, setStep] = useState("idle");
  const [path, setPath] = useState(null);         // "adult" | "child"

  // On mount: check if already enrolled (surfaces pass link for returning members),
  // or detect Stripe Checkout return (?checkout=done) / GC mandate return (?gc=done).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const isCheckoutReturn = params.get("checkout") === "done";
    const isGcDone  = params.get("gc") === "done";
    const isGcError = params.get("gc") === "error";
    if (isCheckoutReturn || isGcDone) setStep("done");
    if (isGcError) setStep("gcError");
    memberGetVenueMembershipPass(code).then((r) => {
      if (r?.found && r?.pass_token) {
        setPassToken(r.pass_token);
        setStep("done");
      }
    }).catch(() => {});
  }, []);
  const [self, setSelf] = useState(null);         // memberGetSelf result
  const [children, setChildren] = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [selectedTier, setSelectedTier] = useState(null);
  const [selectedPeriod, setSelectedPeriod] = useState(null);
  const [passToken, setPassToken] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const loadedRef = useRef(false);

  const docs = Array.isArray(documents) ? documents : [];

  // When both Stripe and GoCardless are connected and tier is paid, show choice.
  const nextPaymentStep = (tier) => {
    if (tier?.is_free) return "enrol";
    if (club?.stripe_connected && club?.gc_connected) return "paymentChoice";
    return "enrol";
  };

  const loadMemberData = async () => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    try {
      const [selfData, kidsData] = await Promise.all([memberGetSelf(), memberListChildren()]);
      setSelf(selfData);
      setChildren(kidsData?.children ?? []);
    } catch (e) {
      console.error("[membership-signup] load member data failed", e);
      setLoadErr("Couldn't load your account — please try again.");
    }
  };

  const handlePathSelect = async (p) => {
    setPath(p);
    setStep("loading");
    await loadMemberData();
    if (loadErr) { setStep("idle"); return; }
    if (p === "adult") {
      setStep(self ? "tierSelect" : "createProfile");
    } else {
      setStep(self ? "pickChild" : "createProfile");
    }
  };

  if (step === "idle") {
    return (
      <>
        <Styles />
        <h2 className="vl-comp-name">Become a member</h2>
        <p className="vl-comp-sub">{club?.name ? `Join ${club.name}` : "Join and unlock member benefits"}.</p>
        <button className="vl-cta" onClick={() => onStart ? onStart(() => setStep("path")) : setStep("path")}>
          Join as a member
        </button>
      </>
    );
  }

  if (step === "done") {
    return (
      <>
        <Styles />
        <p className="ms-ok">
          {passToken
            ? <>You're in! <a href={`/m/${passToken}`} style={{ color: "var(--t1)" }}>Open your membership pass →</a></>
            : "You're in — welcome! The club will be in touch with next steps."}
        </p>
      </>
    );
  }

  return (
    <>
      <Styles />
      {step === "path" && (
        <StepPath onSelect={handlePathSelect} />
      )}
      {step === "loading" && (
        <p style={{ color: "var(--t3)", fontSize: 14 }}>Loading your account…</p>
      )}
      {loadErr && <p className="ms-err">{loadErr}</p>}
      {step === "createProfile" && (
        <StepCreateProfile
          onDone={() => {
            loadedRef.current = false;
            loadMemberData().then(() => {
              if (path === "adult") setStep("tierSelect");
              else setStep("pickChild");
            });
          }}
          onError={setLoadErr}
        />
      )}
      {step === "pickChild" && (
        <StepPickChild
          children={children}
          onSelect={(c) => { setSelectedChild(c); setStep("tierSelect"); }}
          onAddNew={() => setStep("addChild")}
        />
      )}
      {step === "addChild" && (
        <StepAddChild
          onDone={(c) => { setSelectedChild(c); setStep("childDetails"); }}
          onBack={() => setStep("pickChild")}
        />
      )}
      {step === "childDetails" && selectedChild && (
        <StepChildDetails
          child={selectedChild}
          onDone={() => setStep("tierSelect")}
          onBack={() => setStep("addChild")}
        />
      )}
      {step === "tierSelect" && (
        <StepTierSelect
          tiers={tiers}
          path={path}
          onDone={({ tier, period }) => {
            setSelectedTier(tier);
            setSelectedPeriod(period);
            setStep(docs.length > 0 ? "consent" : club?.id_mandate ? "idUpload" : nextPaymentStep(tier));
          }}
          onBack={() => {
            if (path === "child") setStep(selectedChild ? "childDetails" : "pickChild");
            else setStep("path");
          }}
        />
      )}
      {step === "consent" && (
        <StepConsent
          documents={docs}
          forProfileId={path === "child" ? selectedChild?.id : null}
          onDone={() => setStep(club?.id_mandate ? "idUpload" : nextPaymentStep(selectedTier))}
          onBack={() => setStep("tierSelect")}
        />
      )}
      {step === "idUpload" && (
        <StepIdUpload
          club={club}
          memberProfileId={self?.id}
          onDone={() => setStep(nextPaymentStep(selectedTier))}
          onSkip={() => setStep(nextPaymentStep(selectedTier))}
        />
      )}
      {step === "paymentChoice" && (
        <StepPaymentChoice
          onStripe={() => setStep("enrol")}
          onGc={() => setStep("gcEnrol")}
        />
      )}
      {step === "gcEnrol" && (
        <StepGcEnrol
          code={code}
          tier={selectedTier}
          period={selectedPeriod}
          forProfileId={path === "child" ? selectedChild?.id : null}
        />
      )}
      {step === "gcError" && (
        <div>
          <p className="ms-err">Direct Debit setup was not completed. Please try again.</p>
          <button className="ms-btn" onClick={() => setStep("gcEnrol")}>Try again</button>
        </div>
      )}
      {step === "enrol" && (
        <StepEnrol
          code={code}
          tier={selectedTier}
          period={selectedPeriod}
          forProfileId={path === "child" ? selectedChild?.id : null}
          club={club}
          returnCode={clubTeamCode}
          onDone={(token) => {
            // Free / no-Stripe path completes synchronously here. For a club-team
            // join, hand the enrolment back so the parent can land the member on
            // the team before showing "done".
            if (onEnrolled) {
              onEnrolled(token, path === "child" ? selectedChild?.id : null);
            }
            setPassToken(token); setStep("done");
          }}
        />
      )}
    </>
  );
}
