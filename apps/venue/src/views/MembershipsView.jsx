import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  venueListMembers, venueListMembershipTiers, venueListCustomersPeople, venueApproveCustomer, venueApproveAndEnrol,
  venueCreateMembershipTier, venueUpdateMembershipTier, venueEnrolMembership, venueFreezeMembership, venueCancelMembership,
  venueCreateCustomer, venueUpdateCustomer, venueListFeePlans, venueCreateFeePlan, venueEnrolFee, venueCancelFee,
  venueListPartners, venueCreatePartner, venueCreateOffer, venueMembershipSummary,
  venueListClubs, venueUpdateClubSettings,
  venueListClubStaff, venueAssignTeamManager, venueRemoveTeamManager, venueUpsertStaffDbs,
  venueCreatePolicyDocument, venuePublishPolicyVersion, venueListPolicyDocuments,
  venueListIdSubmissions, venueVerifyIdDocument, getMemberIdDocUrl,
} from "@platform/core/storage/supabase.js";
import Modal from "./Modal.jsx";
import Icon from "./Icon.jsx";
import { SectionHead, EmptyState } from "./atoms.jsx";
import { poundsRound } from "../lib/format.js";
import { POLICY_TEMPLATES } from "../lib/policyTemplates.js";

// Memberships — venue-ops surface for the membership programme (migs 269–271).
// Three sub-tabs: Members (per-person roster + enrol/freeze/cancel), Plans
// (tier config + per-cadence pricing), Fees (team/booker recurring fees).
// All on manual billing — charges land on the venue Payments ledger.

const M_STATUS = {
  active:    { label: "Active",    cls: "pill-ok" },
  paused:    { label: "Frozen",    cls: "pill-info" },
  ending:    { label: "Ending",    cls: "pill-warn" },
  cancelled: { label: "Cancelled", cls: "pill-muted" },
};
const CADENCES = [["monthly", "Monthly"], ["quarterly", "Quarterly"], ["annual", "Annual"]];
const FEE_PERIODS = [["weekly", "Weekly"], ["monthly", "Monthly"], ["quarterly", "Quarterly"], ["annual", "Annual"]];

const toPence = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.round(n * 100) : null; };
const fullName = (c) => [c?.first_name, c?.last_name].filter(Boolean).join(" ").trim();
const isoPlusDays = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };
const errLabel = (e) => ({
  already_member: "That person already has a live membership.",
  price_not_set: "No price set for that cadence on this plan.",
  customer_not_found: "Couldn’t find that person.",
  tier_not_found: "Couldn’t find that plan.",
  customer_exists: "Someone with that email already exists at this venue.",
  consent_required: "Tick the data-protection and membership-terms consents.",
  guardian_required: "A parent/guardian name and phone are required for under-18s.",
  medical_consent_required: "Tick the medical-data consent to store medical details.",
}[e?.message] || "Something went wrong — try again.");

// age in whole years from a YYYY-MM-DD string (empty/invalid → null)
const ageFromDob = (dob) => {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a;
};

const EMPTY_REG = {
  firstName: "", lastName: "", email: "", phone: "", dob: "", gender: "",
  addressLine1: "", addressLine2: "", addressCity: "", addressPostcode: "",
  emergencyName: "", emergencyRelationship: "", emergencyPhone: "",
  medicalConditions: "", allergies: "", medications: "", gpDetails: "",
  guardianName: "", guardianRelationship: "", guardianPhone: "", guardianEmail: "",
  consentDataProcessing: false, consentTerms: false, consentPhoto: false,
  consentMedical: false, consentMarketing: false,
};

// venue_list_customers_people row (snake_case) → controlled reg state (camelCase)
const personToReg = (p = {}) => ({
  firstName: p.first_name || "", lastName: p.last_name || "", email: p.email || "",
  phone: p.phone || "", dob: p.dob || "", gender: p.gender || "",
  addressLine1: p.address_line1 || "", addressLine2: p.address_line2 || "",
  addressCity: p.address_city || "", addressPostcode: p.address_postcode || "",
  emergencyName: p.emergency_name || "", emergencyRelationship: p.emergency_relationship || "",
  emergencyPhone: p.emergency_phone || "",
  medicalConditions: p.medical_conditions || "", allergies: p.allergies || "",
  medications: p.medications || "", gpDetails: p.gp_details || "",
  guardianName: p.guardian_name || "", guardianRelationship: p.guardian_relationship || "",
  guardianPhone: p.guardian_phone || "", guardianEmail: p.guardian_email || "",
  consentDataProcessing: !!p.consent_data_processing, consentTerms: !!p.consent_terms,
  consentPhoto: !!p.consent_photo, consentMedical: !!p.consent_medical,
  consentMarketing: !!p.consent_marketing,
});

// trims a reg object → only-non-blank fields (so partial updates leave blanks alone)
const regTrimmed = (r) => {
  const out = {};
  for (const [k, v] of Object.entries(r)) out[k] = typeof v === "string" ? (v.trim() || null) : v;
  return out;
};

// client-side mirror of the server registration gates → error string or null
const regError = (r) => {
  const age = ageFromDob(r.dob);
  const isMinor = age !== null && age < 18;
  const hasMedical = !!(r.medicalConditions?.trim() || r.allergies?.trim() || r.medications?.trim() || r.gpDetails?.trim());
  if (!r.firstName?.trim()) return "Enter a first name.";
  if (!r.consentDataProcessing || !r.consentTerms) return "Tick the data-protection and membership-terms consents.";
  if (isMinor && (!r.guardianName?.trim() || !r.guardianPhone?.trim())) return "A parent/guardian name and phone are required for under-18s.";
  if (hasMedical && !r.consentMedical) return "Tick the medical-data consent to store medical details.";
  return null;
};

export default function MembershipsView({ venueToken, liveTick = 0 }) {
  const [tab, setTab] = useState("members");
  return (
    <div>
      <SectionHead label="Memberships" count="Recurring members, plans and team fees — billed to the Payments ledger">
        <span className="chips">
          {[["members", "Members"], ["plans", "Plans"], ["fees", "Team fees"], ["perks", "Perks"], ["club", "Club"], ["staff", "Staff"], ["documents", "Documents"], ["iddocs", "ID docs"]].map(([v, l]) => (
            <button key={v} className="chip" aria-pressed={tab === v} onClick={() => setTab(v)}>{l}</button>
          ))}
        </span>
      </SectionHead>
      {tab === "members" && <MembersTab venueToken={venueToken} liveTick={liveTick} />}
      {tab === "plans"   && <PlansTab venueToken={venueToken} />}
      {tab === "fees"    && <FeesTab venueToken={venueToken} />}
      {tab === "perks"   && <PerksTab venueToken={venueToken} />}
      {tab === "club"       && <ClubTab venueToken={venueToken} />}
      {tab === "staff"      && <StaffTab venueToken={venueToken} />}
      {tab === "documents"  && <DocumentsTab venueToken={venueToken} />}
      {tab === "iddocs"     && <IdDocsTab venueToken={venueToken} />}
    </div>
  );
}

// ── Members ──────────────────────────────────────────────────────────────────
function MembersTab({ venueToken, liveTick = 0 }) {
  const [members, setMembers] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [enrolOpen, setEnrolOpen] = useState(false);
  const [freezeFor, setFreezeFor] = useState(null);
  const [cancelFor, setCancelFor] = useState(null);
  const [pending, setPending] = useState([]);
  const [approving, setApproving] = useState(null); // person id being acted on
  const [copiedId, setCopiedId] = useState(null);   // membership id whose pass link was just copied
  const [enrolReq, setEnrolReq] = useState(null);   // pending person being approved-and-enrolled
  const [profileFor, setProfileFor] = useState(null); // member whose full registration is open

  // The member pass lives on the casual app (in-or-out.com), not the venue console.
  const copyPassLink = async (m) => {
    if (!m.pass_token) return;
    const url = `https://www.in-or-out.com/m/${m.pass_token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(m.membership_id);
      setTimeout(() => setCopiedId((c) => (c === m.membership_id ? null : c)), 2000);
    } catch (e) { console.error("[membership] copy pass link failed", e); }
  };

  const loadPending = () => venueListCustomersPeople(venueToken)
    .then((r) => setPending((r || []).filter((p) => p.status === "pending")))
    .catch(() => {});

  const reload = () => {
    venueListMembers(venueToken).then((rows) => setMembers(Array.isArray(rows) ? rows : [])).catch((e) => setError(e?.message || String(e)));
    venueMembershipSummary(venueToken).then(setSummary).catch(() => {});
    loadPending();
  };
  useEffect(() => {
    let a = true;
    venueListMembers(venueToken).then((r) => { if (a) setMembers(r || []); }).catch((e) => { if (a) setError(e?.message || String(e)); });
    venueMembershipSummary(venueToken).then((s) => { if (a) setSummary(s); }).catch(() => {});
    venueListCustomersPeople(venueToken).then((r) => { if (a) setPending((r || []).filter((p) => p.status === "pending")); }).catch(() => {});
    return () => { a = false; };
  }, [venueToken]);

  // Live: a member self-signup / approval broadcast bumps liveTick → re-fetch roster + requests.
  useEffect(() => { if (liveTick > 0) reload(); }, [liveTick]);

  const decide = async (person, approve) => {
    setApproving(person.id);
    try { await venueApproveCustomer(venueToken, person.id, approve); await loadPending(); }
    catch (e) { setError(e?.message || String(e)); }
    finally { setApproving(null); }
  };

  const live = (members || []).filter((m) => m.status !== "cancelled");
  const dueSoon = live.filter((m) => m.due_soon).length;

  return (
    <div>
      {pending.length > 0 && (
        <div className="panel" style={{ marginBottom: "var(--gap-2)", padding: "var(--gap-2)", border: "1px solid var(--accent)", borderRadius: "var(--radius)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span className="pill pill-warn">{pending.length}</span>
            <strong>Membership requests</strong>
            <span className="text-mute" style={{ fontSize: 12 }}>— self-signups from your QR, awaiting approval</span>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {pending.map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="cu-name">{fullName(p) || "—"}</div>
                  <div className="cu-sub">
                    {[p.email, p.phone].filter(Boolean).join(" · ") || "No contact given"}
                    {p.requested_tier_name && <span className="pill pill-info" style={{ marginLeft: 8 }}>wants {p.requested_tier_name}</span>}
                  </div>
                </div>
                <button className="btn btn-xs btn-ghost" disabled={approving === p.id} onClick={() => decide(p, false)}><Icon name="x" size={13} /> Reject</button>
                {p.requested_tier_id
                  ? <button className="btn btn-xs btn-primary" onClick={() => setEnrolReq(p)}><Icon name="check" size={13} /> Approve & enrol</button>
                  : <button className="btn btn-xs btn-primary" disabled={approving === p.id} onClick={() => decide(p, true)}><Icon name="check" size={13} /> Approve</button>}
              </div>
            ))}
          </div>
        </div>
      )}
      {summary && (
        <div className="customers-grid" style={{ marginBottom: "var(--gap-2)" }}>
          <div className="customer-card"><div className="cu-stat-label">Active members</div><div className="cu-stat-value" style={{ fontSize: 26 }}>{summary.active ?? 0}</div></div>
          <div className="customer-card"><div className="cu-stat-label">Monthly value (MRR)</div><div className="cu-stat-value" style={{ fontSize: 26 }}>{poundsRound(summary.mrr_pence || 0)}</div></div>
          <div className="customer-card"><div className="cu-stat-label">Renewing in 7 days</div><div className="cu-stat-value" style={{ fontSize: 26 }}>{summary.due_soon ?? 0}</div></div>
          <div className="customer-card"><div className="cu-stat-label">Frozen · Cancelled 30d</div><div className="cu-stat-value" style={{ fontSize: 26 }}>{summary.paused ?? 0} · {summary.cancelled_30d ?? 0}</div></div>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "var(--gap-2)" }}>
        {dueSoon > 0 && <span className="pill pill-warn">{dueSoon} renewing soon</span>}
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setEnrolOpen(true)}><Icon name="plus" size={14} /> Enrol member</button>
      </div>

      {error && <EmptyState title="Couldn’t load members" body={error} />}
      {members && live.length === 0 && !error && (
        <EmptyState title="No members yet" body="Enrol someone onto a plan to start a recurring membership." />
      )}

      {live.length > 0 && (
        <div className="customers-grid">
          {live.map((m) => {
            const st = M_STATUS[m.status] || M_STATUS.active;
            return (
              <div className="customer-card" key={m.membership_id}>
                <div className="cu-top">
                  <div className="cu-head-text">
                    <div className="cu-name">{fullName(m) || "—"}</div>
                    <div className="cu-sub">{m.tier_name} · {m.period}</div>
                  </div>
                  <span className={"pill " + st.cls}>{st.label}</span>
                </div>
                <div className="cu-stats">
                  <div className="cu-stat"><div className="cu-stat-label">Price</div><div className="cu-stat-value">{poundsRound(m.amount_pence)}</div></div>
                  <div className="cu-stat"><div className="cu-stat-label">{m.status === "ending" ? "Ends" : m.status === "paused" ? "Frozen to" : "Renews"}</div>
                    <div className="cu-stat-value" style={m.due_soon ? { color: "var(--live)" } : null}>{m.status === "paused" ? m.frozen_until : m.renews_at}</div></div>
                </div>
                <div className="cu-foot">
                  {m.pass_token && (
                    <button className="btn btn-xs" onClick={() => copyPassLink(m)} title="Copy the member's pass link to share">
                      <Icon name={copiedId === m.membership_id ? "check" : "copy"} size={13} /> {copiedId === m.membership_id ? "Copied" : "Copy link"}
                    </button>
                  )}
                  <span style={{ flex: 1 }} />
                  {m.customer_id && <button className="btn btn-xs" onClick={() => setProfileFor(m)} title="View / edit registration details"><Icon name="customers" size={13} /> Details</button>}
                  {m.status === "active" && <button className="btn btn-xs" onClick={() => setFreezeFor(m)}><Icon name="clock" size={13} /> Freeze</button>}
                  {m.status !== "cancelled" && <button className="btn btn-xs" onClick={() => setCancelFor(m)}><Icon name="x" size={13} /> Cancel</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {profileFor && <ProfileModal venueToken={venueToken} customerId={profileFor.customer_id} name={fullName(profileFor)} onClose={() => setProfileFor(null)} onDone={() => { setProfileFor(null); reload(); }} />}
      {enrolReq && <ApproveEnrolModal venueToken={venueToken} person={enrolReq} onClose={() => setEnrolReq(null)} onDone={() => { setEnrolReq(null); reload(); }} />}
      {enrolOpen && <EnrolModal venueToken={venueToken} onClose={() => setEnrolOpen(false)} onDone={() => { setEnrolOpen(false); reload(); }} />}
      {freezeFor && <FreezeModal venueToken={venueToken} member={freezeFor} onClose={() => setFreezeFor(null)} onDone={() => { setFreezeFor(null); reload(); }} />}
      {cancelFor && <CancelModal venueToken={venueToken} member={cancelFor} onClose={() => setCancelFor(null)} onDone={() => { setCancelFor(null); reload(); }} />}
    </div>
  );
}

function EnrolModal({ venueToken, onClose, onDone }) {
  const [people, setPeople] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [customerId, setCustomerId] = useState("");
  const [reg, setReg] = useState(EMPTY_REG);   // full registration for a NEW person
  const [tierId, setTierId] = useState("");
  const [period, setPeriod] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    venueListCustomersPeople(venueToken).then((r) => setPeople(r || [])).catch(() => {});
    venueListMembershipTiers(venueToken).then((r) => setTiers(r || [])).catch(() => {});
  }, [venueToken]);

  const tier = tiers.find((t) => t.tier_id === tierId);
  const cadences = (tier?.prices || []);
  const priceFor = cadences.find((p) => p.period === period);
  const addingNew = !customerId;

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      let cid = customerId;
      if (addingNew) {
        const ve = regError(reg);
        if (ve) { setError(ve); setBusy(false); return; }
        const r = await venueCreateCustomer(venueToken, regTrimmed(reg));
        cid = r?.customer_id;
      }
      if (!cid) { setError("Pick a person or fill in the new-member details."); setBusy(false); return; }
      if (!tierId || !period) { setError("Pick a plan and a cadence."); setBusy(false); return; }
      await venueEnrolMembership(venueToken, cid, tierId, period);
      onDone();
    } catch (e) { setError(errLabel(e)); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} title="Enrol member" foot={
      <><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><span className="spacer" />
      <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Enrolling…" : priceFor ? `Enrol · ${poundsRound(priceFor.price_pence)}/${period}` : "Enrol"}</button></>
    }>
      <label className="field-label">Person</label>
      <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
        <option value="">— Add a new member —</option>
        {people.filter((p) => p.status !== "erased").map((p) => <option key={p.id} value={p.id}>{fullName(p)}{p.email ? ` · ${p.email}` : ""}</option>)}
      </select>
      {addingNew && (
        <div style={{ margin: "12px 0", paddingTop: 4, borderTop: "1px solid var(--border)" }}>
          <RegistrationFields reg={reg} setReg={setReg} />
        </div>
      )}
      <label className="field-label" style={{ marginTop: 14 }}>Plan</label>
      <select className="input" value={tierId} onChange={(e) => { setTierId(e.target.value); setPeriod(""); }}>
        <option value="">— Select plan —</option>
        {tiers.map((t) => <option key={t.tier_id} value={t.tier_id}>{t.name}</option>)}
      </select>
      {tier && (
        <>
          <label className="field-label" style={{ marginTop: 14 }}>Cadence</label>
          {cadences.length === 0 ? <p className="text-mute" style={{ fontSize: 12 }}>This plan has no prices set yet — add them under Plans.</p> : (
            <div style={{ display: "grid", gap: 8 }}>
              {cadences.map((p) => (
                <button key={p.period} type="button" className="charge-opt" onClick={() => setPeriod(p.period)}
                  style={{ borderColor: period === p.period ? "var(--accent)" : "var(--border)", display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 600, fontSize: 13, textTransform: "capitalize" }}>{p.period}</span>
                  <span>{poundsRound(p.price_pence)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

// Shared 360Player-style registration field-set (mig 282). Controlled by a `reg`
// object (camelCase keys matching the venueCreateCustomer/venueUpdateCustomer
// wrappers). Guardian section appears only for under-18s; medical-consent only
// when a medical field is filled.
function RegistrationFields({ reg, setReg }) {
  const set = (k) => (e) => setReg((p) => ({ ...p, [k]: e.target.value }));
  const chk = (k) => (e) => setReg((p) => ({ ...p, [k]: e.target.checked }));
  const age = ageFromDob(reg.dob);
  const isMinor = age !== null && age < 18;
  const hasMedical = !!(reg.medicalConditions?.trim() || reg.allergies?.trim() || reg.medications?.trim() || reg.gpDetails?.trim());
  const two = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 };
  const head = { fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-mute, #888)", margin: "14px 0 6px" };

  return (
    <div>
      <div style={head}>Details</div>
      <div style={two}>
        <input className="input" placeholder="First name *" value={reg.firstName} onChange={set("firstName")} maxLength={80} />
        <input className="input" placeholder="Last name" value={reg.lastName} onChange={set("lastName")} maxLength={80} />
      </div>
      <div style={{ ...two, marginTop: 8 }}>
        <input className="input" type="date" value={reg.dob} onChange={set("dob")} title="Date of birth" />
        <input className="input" placeholder="Gender" value={reg.gender} onChange={set("gender")} maxLength={40} />
      </div>
      <div style={{ ...two, marginTop: 8 }}>
        <input className="input" type="email" placeholder="Email" value={reg.email} onChange={set("email")} maxLength={160} />
        <input className="input" type="tel" placeholder="Phone" value={reg.phone} onChange={set("phone")} maxLength={30} />
      </div>

      <div style={head}>Address</div>
      <input className="input" placeholder="Address line 1" value={reg.addressLine1} onChange={set("addressLine1")} maxLength={120} />
      <input className="input" placeholder="Address line 2" value={reg.addressLine2} onChange={set("addressLine2")} maxLength={120} style={{ marginTop: 8 }} />
      <div style={{ ...two, marginTop: 8 }}>
        <input className="input" placeholder="Town / city" value={reg.addressCity} onChange={set("addressCity")} maxLength={80} />
        <input className="input" placeholder="Postcode" value={reg.addressPostcode} onChange={set("addressPostcode")} maxLength={12} />
      </div>

      <div style={head}>Emergency contact</div>
      <input className="input" placeholder="Name" value={reg.emergencyName} onChange={set("emergencyName")} maxLength={120} />
      <div style={{ ...two, marginTop: 8 }}>
        <input className="input" placeholder="Relationship" value={reg.emergencyRelationship} onChange={set("emergencyRelationship")} maxLength={60} />
        <input className="input" type="tel" placeholder="Phone" value={reg.emergencyPhone} onChange={set("emergencyPhone")} maxLength={30} />
      </div>

      <div style={head}>Medical &amp; safeguarding (optional)</div>
      <input className="input" placeholder="Medical conditions" value={reg.medicalConditions} onChange={set("medicalConditions")} maxLength={300} />
      <input className="input" placeholder="Allergies" value={reg.allergies} onChange={set("allergies")} maxLength={300} style={{ marginTop: 8 }} />
      <input className="input" placeholder="Medications" value={reg.medications} onChange={set("medications")} maxLength={300} style={{ marginTop: 8 }} />
      <input className="input" placeholder="GP / doctor details" value={reg.gpDetails} onChange={set("gpDetails")} maxLength={200} style={{ marginTop: 8 }} />

      {isMinor && (
        <>
          <div style={head}>Parent / guardian (required — under 18)</div>
          <input className="input" placeholder="Guardian name *" value={reg.guardianName} onChange={set("guardianName")} maxLength={120} />
          <div style={{ ...two, marginTop: 8 }}>
            <input className="input" placeholder="Relationship" value={reg.guardianRelationship} onChange={set("guardianRelationship")} maxLength={60} />
            <input className="input" type="tel" placeholder="Phone *" value={reg.guardianPhone} onChange={set("guardianPhone")} maxLength={30} />
          </div>
          <input className="input" type="email" placeholder="Guardian email" value={reg.guardianEmail} onChange={set("guardianEmail")} maxLength={160} style={{ marginTop: 8 }} />
        </>
      )}

      <div style={head}>Consent</div>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, cursor: "pointer", marginBottom: 6 }}>
        <input type="checkbox" checked={reg.consentDataProcessing} onChange={chk("consentDataProcessing")} />
        <span>Consent to store &amp; process personal data for membership admin. <strong>(required)</strong></span>
      </label>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, cursor: "pointer", marginBottom: 6 }}>
        <input type="checkbox" checked={reg.consentTerms} onChange={chk("consentTerms")} />
        <span>Agrees to membership terms &amp; code of conduct. <strong>(required)</strong></span>
      </label>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, cursor: "pointer", marginBottom: 6 }}>
        <input type="checkbox" checked={reg.consentPhoto} onChange={chk("consentPhoto")} />
        <span>Consent to photos/video at events.</span>
      </label>
      {hasMedical && (
        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, cursor: "pointer", marginBottom: 6 }}>
          <input type="checkbox" checked={reg.consentMedical} onChange={chk("consentMedical")} />
          <span>Consent to store the medical information above. <strong>(required)</strong></span>
        </label>
      )}
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" checked={reg.consentMarketing} onChange={chk("consentMarketing")} />
        <span>Happy to receive membership offers &amp; event news.</span>
      </label>
    </div>
  );
}

// View / edit a member's full registration record (mig 282). Loads the person
// from venue_list_customers_people (the now-richer people directory) by id,
// edits via venue_update_customer (partial — blanks leave fields unchanged).
function ProfileModal({ venueToken, customerId, name, onClose, onDone }) {
  const [reg, setReg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let a = true;
    venueListCustomersPeople(venueToken, true)
      .then((rows) => {
        const p = (rows || []).find((x) => x.id === customerId);
        if (a) setReg(p ? personToReg(p) : EMPTY_REG);
      })
      .catch((e) => { if (a) setError(e?.message || String(e)); });
    return () => { a = false; };
  }, [venueToken, customerId]);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      await venueUpdateCustomer(venueToken, customerId, regTrimmed(reg));
      onDone();
    } catch (e) { setError(errLabel(e)); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} title={`${name || "Member"} — details`} foot={
      <><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Close</button><span className="spacer" />
      <button className="btn btn-primary" onClick={save} disabled={busy || !reg}>{busy ? "Saving…" : "Save changes"}</button></>
    }>
      {!reg && !error && <p className="text-mute" style={{ fontSize: 13 }}>Loading…</p>}
      {reg && <RegistrationFields reg={reg} setReg={setReg} />}
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

// Approve a pending self-signup AND enrol them in one go (the tier they requested
// is pre-selected). Free tiers need no cadence. Uses venue_approve_and_enrol.
function ApproveEnrolModal({ venueToken, person, onClose, onDone }) {
  const [tiers, setTiers] = useState([]);
  const [tierId, setTierId] = useState(person.requested_tier_id || "");
  const [period, setPeriod] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { venueListMembershipTiers(venueToken).then((r) => setTiers(r || [])).catch(() => {}); }, [venueToken]);

  const tier = tiers.find((t) => t.tier_id === tierId);
  const isFree = !!tier?.benefits?.is_free;
  const cadences = tier?.prices || [];

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      if (!tierId) { setError("Pick a plan."); setBusy(false); return; }
      if (!isFree && !period) { setError("Pick a cadence."); setBusy(false); return; }
      await venueApproveAndEnrol(venueToken, person.id, tierId, isFree ? "monthly" : period);
      onDone();
    } catch (e) { setError(errLabel(e)); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} title={`Approve & enrol ${fullName(person) || "member"}`} foot={
      <><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><span className="spacer" />
      <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Enrolling…" : "Approve & enrol"}</button></>
    }>
      <p className="text-mute" style={{ fontSize: 12, marginBottom: 12 }}>
        This activates the member and starts their plan. For a paid plan it raises the first charge — take payment in the Payments tab.
      </p>
      <label className="field-label">Plan</label>
      <select className="input" value={tierId} onChange={(e) => { setTierId(e.target.value); setPeriod(""); }}>
        <option value="">— Select plan —</option>
        {tiers.map((t) => <option key={t.tier_id} value={t.tier_id}>{t.name}{t.benefits?.is_free ? " (free)" : ""}</option>)}
      </select>
      {tier && !isFree && (
        <>
          <label className="field-label" style={{ marginTop: 14 }}>Cadence</label>
          {cadences.length === 0 ? <p className="text-mute" style={{ fontSize: 12 }}>This plan has no prices set yet — add them under Plans.</p> : (
            <div style={{ display: "grid", gap: 8 }}>
              {cadences.map((p) => (
                <button key={p.period} type="button" className="charge-opt" onClick={() => setPeriod(p.period)}
                  style={{ borderColor: period === p.period ? "var(--accent)" : "var(--border)", display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 600, fontSize: 13, textTransform: "capitalize" }}>{p.period}</span>
                  <span>{poundsRound(p.price_pence)}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {tier && isFree && <p className="text-mute" style={{ fontSize: 12, marginTop: 12 }}>Free plan — no payment, no cadence.</p>}
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

function FreezeModal({ venueToken, member, onClose, onDone }) {
  const [until, setUntil] = useState(isoPlusDays(30));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try { await venueFreezeMembership(venueToken, member.membership_id, until); onDone(); }
    catch (e) { setError(errLabel(e)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title={`Freeze ${fullName(member)}`} foot={
      <><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><span className="spacer" />
      <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Freezing…" : "Freeze"}</button></>
    }>
      <p className="text-mute" style={{ marginBottom: 12 }}>No charges while frozen — the renewal date is pushed out by the freeze length, so the frozen time is never billed.</p>
      <label className="field-label">Frozen until</label>
      <input className="input" type="date" value={until} min={isoPlusDays(1)} onChange={(e) => setUntil(e.target.value)} />
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

function CancelModal({ venueToken, member, onClose, onDone }) {
  const [immediate, setImmediate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try { await venueCancelMembership(venueToken, member.membership_id, immediate); onDone(); }
    catch (e) { setError(errLabel(e)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title={`Cancel ${fullName(member)}`} foot={
      <><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Keep</button><span className="spacer" />
      <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Cancelling…" : "Confirm cancel"}</button></>
    }>
      <div style={{ display: "grid", gap: 8 }}>
        <button type="button" className="charge-opt" onClick={() => setImmediate(false)} style={{ borderColor: !immediate ? "var(--accent)" : "var(--border)" }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>End of period</div>
          <div className="text-mute" style={{ fontSize: 12 }}>Access until {member.renews_at}. No further charges.</div>
        </button>
        <button type="button" className="charge-opt" onClick={() => setImmediate(true)} style={{ borderColor: immediate ? "var(--accent)" : "var(--border)" }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>Immediately</div>
          <div className="text-mute" style={{ fontSize: 12 }}>Membership ends today.</div>
        </button>
      </div>
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

// ── Plans (tiers) ────────────────────────────────────────────────────────────
const AUDIENCE_LABELS = { all: "All", adult: "Adult", junior: "Junior", child: "Child" };
const AUDIENCE_PILLS  = { all: null, adult: "pill-info", junior: "pill-warn", child: "pill-ok" };

function tierSubline(t) {
  const lines = (t.benefits?.benefit_lines || []);
  if (lines.length) return lines.map((l) => l.label + (l.value ? ` · ${l.value_type === "pct" ? l.value + "%" : poundsRound(l.value * 100)}` : "")).join(", ");
  if (t.benefits?.discount_pct) return `${t.benefits.discount_pct}% booking discount`;
  return "No benefits set";
}

function standardPrices(prices = []) {
  return prices.filter((p) => p.price_type === "standard" || !p.price_type);
}

function PlansTab({ venueToken }) {
  const [tiers, setTiers] = useState(null);
  const [error, setError] = useState(null);
  const [openNew, setOpenNew] = useState(false);
  const [editTier, setEditTier] = useState(null);

  const reload = () => venueListMembershipTiers(venueToken)
    .then((r) => setTiers(r || []))
    .catch((e) => setError(e?.message || String(e)));

  useEffect(() => {
    let a = true;
    venueListMembershipTiers(venueToken)
      .then((r) => { if (a) setTiers(r || []); })
      .catch((e) => { if (a) setError(e?.message || String(e)); });
    return () => { a = false; };
  }, [venueToken]);

  return (
    <div>
      <div style={{ display: "flex", marginBottom: "var(--gap-2)" }}>
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setOpenNew(true)}><Icon name="plus" size={14} /> New plan</button>
      </div>
      {error && <EmptyState title="Couldn’t load plans" body={error} />}
      {tiers && tiers.length === 0 && !error && (
        <EmptyState title="No plans yet" body="Create a membership plan with named benefits and monthly, quarterly or annual pricing." />
      )}
      {tiers && tiers.length > 0 && (
        <div className="customers-grid">
          {tiers.map((t) => {
            const stdPrices = standardPrices(t.prices);
            const famPrices = (t.prices || []).filter((p) => p.price_type === "family");
            const sibPrices = (t.prices || []).filter((p) => p.price_type === "sibling");
            const audPill   = AUDIENCE_PILLS[t.audience];
            return (
              <div className="customer-card" key={t.tier_id}>
                <div className="cu-top">
                  <div className="cu-head-text">
                    <div className="cu-name">{t.name}</div>
                    <div className="cu-sub">{tierSubline(t)}</div>
                  </div>
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" }}>
                    {audPill && <span className={"pill " + audPill}>{AUDIENCE_LABELS[t.audience]}</span>}
                    {t.pricing_model === "season" && <span className="pill pill-info">Season</span>}
                    {t.benefits?.is_free && <span className="pill pill-ok">Free</span>}
                    {t.benefits?.self_signup && <span className="pill pill-info">On signup</span>}
                    {!t.active && <span className="pill pill-muted">Inactive</span>}
                  </span>
                </div>

                {t.pricing_model === "season" && t.season_start && (
                  <div className="text-mute" style={{ fontSize: 12, marginBottom: 4 }}>
                    {t.season_start} → {t.season_end || "open-ended"}
                  </div>
                )}

                <div className="cu-stats">
                  {stdPrices.length === 0 && !t.benefits?.is_free
                    ? <span className="text-mute" style={{ fontSize: 12 }}>No prices set</span>
                    : stdPrices.map((p) => (
                      <div className="cu-stat" key={p.period + p.price_type}>
                        <div className="cu-stat-label" style={{ textTransform: "capitalize" }}>{p.period}</div>
                        <div className="cu-stat-value">{poundsRound(p.price_pence)}</div>
                      </div>
                    ))}
                  {famPrices.map((p) => (
                    <div className="cu-stat" key={"fam-" + p.period}>
                      <div className="cu-stat-label" style={{ textTransform: "capitalize" }}>Family {p.period !== "season" ? p.period : ""}</div>
                      <div className="cu-stat-value">{poundsRound(p.price_pence)}</div>
                    </div>
                  ))}
                  {sibPrices.map((p) => (
                    <div className="cu-stat" key={"sib-" + p.period}>
                      <div className="cu-stat-label" style={{ textTransform: "capitalize" }}>Sibling {p.period !== "season" ? p.period : ""}</div>
                      <div className="cu-stat-value">{poundsRound(p.price_pence)}</div>
                    </div>
                  ))}
                </div>

                <div className="cu-foot">
                  <span style={{ flex: 1 }} />
                  <button className="btn btn-xs" onClick={() => setEditTier(t)}><Icon name="settings" size={13} /> Edit</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {openNew && (
        <TierModal venueToken={venueToken} onClose={() => setOpenNew(false)} onDone={() => { setOpenNew(false); reload(); }} />
      )}
      {editTier && (
        <TierModal venueToken={venueToken} tier={editTier} onClose={() => setEditTier(null)} onDone={() => { setEditTier(null); reload(); }} />
      )}
    </div>
  );
}

// Shared new-benefit-line blank
const EMPTY_LINE = { label: "", value_type: "text", value: "" };

function TierModal({ venueToken, tier = null, onClose, onDone }) {
  const editing = !!tier;

  const [name,         setName]         = useState(tier?.name || "");
  const [audience,     setAudience]     = useState(tier?.audience || "all");
  const [pricingModel, setPricingModel] = useState(tier?.pricing_model || "recurring");
  const [seasonStart,  setSeasonStart]  = useState(tier?.season_start || "");
  const [seasonEnd,    setSeasonEnd]    = useState(tier?.season_end || "");
  const [isFree,       setIsFree]       = useState(!!(tier?.benefits?.is_free));
  const [selfSignup,   setSelfSignup]   = useState(tier?.benefits?.self_signup !== false);
  const [active,       setActive]       = useState(tier?.active !== false);

  // Named benefit lines
  const [lines, setLines] = useState(
    (tier?.benefits?.benefit_lines && tier.benefits.benefit_lines.length > 0)
      ? tier.benefits.benefit_lines
      : [{ ...EMPTY_LINE }]
  );

  // Prices: one object per cadence+price_type
  const initPrices = (type) => {
    const out = { monthly: "", quarterly: "", annual: "", season: "" };
    (tier?.prices || []).filter((p) => (p.price_type || "standard") === type)
      .forEach((p) => { out[p.period] = String(p.price_pence / 100); });
    return out;
  };
  const [stdPrices, setStdPrices] = useState(initPrices("standard"));
  const [famPrices, setFamPrices] = useState(initPrices("family"));
  const [sibPrices, setSibPrices] = useState(initPrices("sibling"));
  const [showFamily,  setShowFamily]  = useState(() => (tier?.prices || []).some((p) => p.price_type === "family"));
  const [showSibling, setShowSibling] = useState(() => (tier?.prices || []).some((p) => p.price_type === "sibling"));

  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState(null);

  const addLine    = () => setLines((ls) => [...ls, { ...EMPTY_LINE }]);
  const removeLine = (i) => setLines((ls) => ls.filter((_, idx) => idx !== i));
  const setLine    = (i, k, v) => setLines((ls) => ls.map((l, idx) => idx === i ? { ...l, [k]: v } : l));

  const buildPriceArr = () => {
    if (isFree) return [];
    const arr = [];
    const cadences = pricingModel === "season" ? ["season"] : ["monthly", "quarterly", "annual"];
    for (const period of cadences) {
      const std = toPence(stdPrices[period]);
      if (std != null && std >= 0) arr.push({ period, price_pence: std, price_type: "standard" });
      if (showFamily) {
        const fam = toPence(famPrices[period]);
        if (fam != null && fam >= 0) arr.push({ period, price_pence: fam, price_type: "family" });
      }
      if (showSibling) {
        const sib = toPence(sibPrices[period]);
        if (sib != null && sib >= 0) arr.push({ period, price_pence: sib, price_type: "sibling" });
      }
    }
    return arr;
  };

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      if (!name.trim()) { setError("Give the plan a name."); setBusy(false); return; }
      const priceArr = buildPriceArr();
      if (!isFree && priceArr.filter((p) => p.price_type === "standard").length === 0) {
        setError("Set at least one standard price (or mark the plan free)."); setBusy(false); return;
      }
      if (pricingModel === "season" && !seasonStart) {
        setError("Enter a season start date."); setBusy(false); return;
      }
      const validLines = lines.filter((l) => l.label.trim());
      const benefits = {
        benefit_lines: validLines,
        ...(isFree && { is_free: true }),
        ...(selfSignup && { self_signup: true }),
      };
      const opts = {
        audience,
        pricingModel,
        seasonStart: pricingModel === "season" ? (seasonStart || null) : null,
        seasonEnd:   pricingModel === "season" ? (seasonEnd || null)   : null,
      };
      if (editing) {
        await venueUpdateMembershipTier(venueToken, tier.tier_id, {
          name: name.trim(), benefits, active, prices: priceArr, ...opts,
        });
      } else {
        await venueCreateMembershipTier(venueToken, name.trim(), benefits, priceArr, opts);
      }
      onDone();
    } catch (e) { setError(errLabel(e)); } finally { setBusy(false); }
  };

  const cadences      = pricingModel === "season" ? [["season", "Season fee"]] : CADENCES;
  const head          = { fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-mute, #888)", margin: "16px 0 6px" };
  const inlineRow     = { display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13, cursor: "pointer" };
  const priceRow      = (label, prices, setPrices) => (
    <div style={{ display: "grid", gap: 8 }}>
      {cadences.map(([p, l]) => (
        <div key={p} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 90, fontSize: 13 }}>{l} {label && <span className="text-mute">({label})</span>}</span>
          <input className="input" type="number" min="0" step="0.01" placeholder="—" value={prices[p]}
            onChange={(e) => setPrices((s) => ({ ...s, [p]: e.target.value }))} />
        </div>
      ))}
    </div>
  );

  return (
    <Modal onClose={onClose} title={editing ? `Edit — ${tier.name}` : "New membership plan"} foot={
      <><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><span className="spacer" />
      <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create plan"}</button></>
    }>

      <label className="field-label">Plan name</label>
      <input className="input" placeholder="e.g. Junior Gold" value={name} onChange={(e) => setName(e.target.value)} />

      <div style={head}>Audience</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[["all","All ages"],["adult","Adult"],["junior","Junior"],["child","Child"]].map(([v, l]) => (
          <button key={v} type="button" className="charge-opt" onClick={() => setAudience(v)}
            style={{ borderColor: audience === v ? "var(--accent)" : "var(--border)", padding: "6px 14px", fontSize: 13 }}>
            {l}
          </button>
        ))}
      </div>

      <div style={head}>Pricing model</div>
      <div style={{ display: "flex", gap: 8 }}>
        {[["recurring","Recurring (monthly/quarterly/annual)"],["season","Season (one-off per season)"]].map(([v, l]) => (
          <button key={v} type="button" className="charge-opt" onClick={() => setPricingModel(v)}
            style={{ borderColor: pricingModel === v ? "var(--accent)" : "var(--border)", flex: 1, fontSize: 13 }}>
            {l}
          </button>
        ))}
      </div>
      {pricingModel === "season" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
          <div>
            <label className="field-label">Season start</label>
            <input className="input" type="date" value={seasonStart} onChange={(e) => setSeasonStart(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Season end (optional)</label>
            <input className="input" type="date" value={seasonEnd} onChange={(e) => setSeasonEnd(e.target.value)} />
          </div>
        </div>
      )}

      <div style={head}>Benefits</div>
      <p className="text-mute" style={{ fontSize: 12, marginBottom: 8 }}>Name what this plan includes — shown on the member pass and signup page.</p>
      {lines.map((l, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
          <input className="input" placeholder="e.g. Free pitch booking" value={l.label}
            onChange={(e) => setLine(i, "label", e.target.value)} style={{ flex: 2 }} />
          <select className="input" value={l.value_type} onChange={(e) => setLine(i, "value_type", e.target.value)} style={{ flex: 1 }}>
            <option value="text">Text only</option>
            <option value="pct">% discount</option>
            <option value="gbp">£ value</option>
          </select>
          {l.value_type !== "text" && (
            <input className="input" type="number" min="0" step={l.value_type === "gbp" ? "0.01" : "1"} placeholder="0"
              value={l.value} onChange={(e) => setLine(i, "value", e.target.value)} style={{ flex: 1 }} />
          )}
          {lines.length > 1 && (
            <button type="button" className="btn btn-xs btn-ghost" onClick={() => removeLine(i)} title="Remove">✕</button>
          )}
        </div>
      ))}
      <button type="button" className="btn btn-xs" onClick={addLine} style={{ marginTop: 2 }}><Icon name="plus" size={12} /> Add line</button>

      <label style={inlineRow}>
        <input type="checkbox" checked={isFree} onChange={(e) => setIsFree(e.target.checked)} />
        <span>Free membership (no payment — members join instantly)</span>
      </label>
      <label style={{ ...inlineRow, marginTop: 4 }}>
        <input type="checkbox" checked={selfSignup} onChange={(e) => setSelfSignup(e.target.checked)} />
        <span>Offer on the QR signup page</span>
      </label>

      {!isFree && (
        <>
          <div style={head}>Standard pricing (£)</div>
          {priceRow("", stdPrices, setStdPrices)}

          <label style={{ ...inlineRow, marginTop: 12 }}>
            <input type="checkbox" checked={showFamily} onChange={(e) => setShowFamily(e.target.checked)} />
            <span>Family price</span>
          </label>
          {showFamily && <div style={{ marginTop: 8 }}>{priceRow("family", famPrices, setFamPrices)}</div>}

          <label style={{ ...inlineRow, marginTop: 8 }}>
            <input type="checkbox" checked={showSibling} onChange={(e) => setShowSibling(e.target.checked)} />
            <span>Sibling price</span>
          </label>
          {showSibling && <div style={{ marginTop: 8 }}>{priceRow("sibling", sibPrices, setSibPrices)}</div>}
        </>
      )}

      {editing && (
        <label style={{ ...inlineRow, marginTop: 16, color: active ? "inherit" : "var(--live)" }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>Plan active (uncheck to deactivate)</span>
        </label>
      )}

      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

// ── Fees (team/booker) ───────────────────────────────────────────────────────
function FeesTab({ venueToken }) {
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [enrolFor, setEnrolFor] = useState(null);
  const reload = () => venueListFeePlans(venueToken).then((r) => setPlans(r || [])).catch((e) => setError(e?.message || String(e)));
  useEffect(() => { let a = true; venueListFeePlans(venueToken).then((r) => { if (a) setPlans(r || []); }).catch((e) => { if (a) setError(e?.message || String(e)); }); return () => { a = false; }; }, [venueToken]);

  return (
    <div>
      <div style={{ display: "flex", marginBottom: "var(--gap-2)" }}>
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setPlanOpen(true)}><Icon name="plus" size={14} /> New fee plan</button>
      </div>
      {error && <EmptyState title="Couldn’t load fee plans" body={error} />}
      {plans && plans.length === 0 && !error && <EmptyState title="No fee plans yet" body="Create a recurring team/booker fee (e.g. a weekly pitch slot)." />}
      {plans && plans.length > 0 && (
        <div className="customers-grid">
          {plans.map((fp) => (
            <div className="customer-card" key={fp.plan_id}>
              <div className="cu-top">
                <div className="cu-head-text">
                  <div className="cu-name">{fp.name}</div>
                  <div className="cu-sub">{poundsRound(fp.amount_pence)} · {fp.period}{fp.sport ? ` · ${fp.sport}` : ""}</div>
                </div>
                <span className="pill pill-info">{(fp.subscriptions || []).length} active</span>
              </div>
              <div className="cu-foot">
                <span className="text-mute" style={{ fontSize: 12 }}>
                  {(fp.subscriptions || []).slice(0, 3).map((s) => s.member_key).join(", ") || "No subscribers yet"}
                </span>
                <span style={{ flex: 1 }} />
                <button className="btn btn-xs" onClick={() => setEnrolFor(fp)}><Icon name="plus" size={13} /> Enrol</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {planOpen && <FeePlanModal venueToken={venueToken} onClose={() => setPlanOpen(false)} onDone={() => { setPlanOpen(false); reload(); }} />}
      {enrolFor && <FeeEnrolModal venueToken={venueToken} plan={enrolFor} onClose={() => setEnrolFor(null)} onDone={() => { setEnrolFor(null); reload(); }} />}
    </div>
  );
}

function FeePlanModal({ venueToken, onClose, onDone }) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState("weekly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const pence = toPence(amount);
      if (!name.trim()) { setError("Give the fee a name."); setBusy(false); return; }
      if (pence == null || pence < 0) { setError("Enter a valid amount."); setBusy(false); return; }
      await venueCreateFeePlan(venueToken, name.trim(), pence, period, null);
      onDone();
    } catch (e) { setError(errLabel(e)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title="New fee plan" foot={
      <><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><span className="spacer" />
      <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Create fee plan"}</button></>
    }>
      <label className="field-label">Name</label>
      <input className="input" placeholder="e.g. Weekly pitch slot" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="field-label" style={{ marginTop: 14 }}>Amount (£)</label>
      <input className="input" type="number" min="0" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <label className="field-label" style={{ marginTop: 14 }}>Cadence</label>
      <select className="input" value={period} onChange={(e) => setPeriod(e.target.value)}>
        {FEE_PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

function FeeEnrolModal({ venueToken, plan, onClose, onDone }) {
  const [memberKey, setMemberKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      if (!memberKey.trim()) { setError("Enter a team or booker name."); setBusy(false); return; }
      await venueEnrolFee(venueToken, plan.plan_id, memberKey.trim(), null);
      onDone();
    } catch (e) { setError(errLabel(e)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title={`Enrol on ${plan.name}`} foot={
      <><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><span className="spacer" />
      <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Enrolling…" : `Enrol · ${poundsRound(plan.amount_pence)}/${plan.period}`}</button></>
    }>
      <p className="text-mute" style={{ marginBottom: 12 }}>First charge is raised now; the next is auto-raised each {plan.period} onto the Payments ledger.</p>
      <label className="field-label">Team or booker name</label>
      <input className="input" placeholder="e.g. Sunday FC" value={memberKey} onChange={(e) => setMemberKey(e.target.value)} />
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

// ── Perks (partner offers) ───────────────────────────────────────────────────
function PerksTab({ venueToken }) {
  const [partners, setPartners] = useState(null);
  const [error, setError] = useState(null);
  const [partnerOpen, setPartnerOpen] = useState(false);
  const [offerFor, setOfferFor] = useState(null);
  const reload = () => venueListPartners(venueToken).then((r) => setPartners(r || [])).catch((e) => setError(e?.message || String(e)));
  useEffect(() => { let a = true; venueListPartners(venueToken).then((r) => { if (a) setPartners(r || []); }).catch((e) => { if (a) setError(e?.message || String(e)); }); return () => { a = false; }; }, [venueToken]);

  return (
    <div>
      <p className="text-mute" style={{ fontSize: 13, marginBottom: "var(--gap-2)" }}>Local partner offers that show on members’ passes (e.g. the pub). A separate revenue stream from bookings.</p>
      <div style={{ display: "flex", marginBottom: "var(--gap-2)" }}>
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setPartnerOpen(true)}><Icon name="plus" size={14} /> Add partner</button>
      </div>
      {error && <EmptyState title="Couldn’t load partners" body={error} />}
      {partners && partners.length === 0 && !error && <EmptyState title="No partners yet" body="Add a local partner and attach a member offer." />}
      {partners && partners.length > 0 && (
        <div className="customers-grid">
          {partners.map((p) => (
            <div className="customer-card" key={p.partner_id}>
              <div className="cu-top">
                <div className="cu-head-text"><div className="cu-name">{p.name}</div><div className="cu-sub">{p.contact || "Partner"}</div></div>
                <button className="btn btn-xs" onClick={() => setOfferFor(p)}><Icon name="plus" size={13} /> Offer</button>
              </div>
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {(p.offers || []).length === 0 ? <span className="text-mute" style={{ fontSize: 12 }}>No offers yet</span> :
                  (p.offers || []).map((o) => (
                    <div key={o.offer_id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, flex: 1 }}>{o.title}{o.code ? ` · ${o.code}` : ""}</span>
                      <span className="pill pill-info">{o.redemptions} used</span>
                      {!o.active && <span className="pill pill-muted">off</span>}
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {partnerOpen && <PartnerModal venueToken={venueToken} onClose={() => setPartnerOpen(false)} onDone={() => { setPartnerOpen(false); reload(); }} />}
      {offerFor && <OfferModal venueToken={venueToken} partner={offerFor} onClose={() => setOfferFor(null)} onDone={() => { setOfferFor(null); reload(); }} />}
    </div>
  );
}

function PartnerModal({ venueToken, onClose, onDone }) {
  const [name, setName] = useState(""); const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try { if (!name.trim()) { setError("Name the partner."); setBusy(false); return; }
      await venueCreatePartner(venueToken, name.trim(), contact.trim() || null); onDone();
    } catch (e) { setError(errLabel(e)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title="Add partner" foot={
      <><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><span className="spacer" />
      <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Add partner"}</button></>
    }>
      <label className="field-label">Name</label>
      <input className="input" placeholder="e.g. The Crown" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="field-label" style={{ marginTop: 14 }}>Contact — optional</label>
      <input className="input" placeholder="email or phone" value={contact} onChange={(e) => setContact(e.target.value)} />
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

function OfferModal({ venueToken, partner, onClose, onDone }) {
  const [title, setTitle] = useState(""); const [desc, setDesc] = useState(""); const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(null);
  const submit = async () => {
    setBusy(true); setError(null);
    try { if (!title.trim()) { setError("Give the offer a title."); setBusy(false); return; }
      await venueCreateOffer(venueToken, partner.partner_id, title.trim(), { description: desc.trim() || null, code: code.trim() || null, tierIds: null }); onDone();
    } catch (e) { setError(errLabel(e)); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title={`Offer at ${partner.name}`} foot={
      <><button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button><span className="spacer" />
      <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Add offer"}</button></>
    }>
      <label className="field-label">Title</label>
      <input className="input" placeholder="e.g. 10% off food" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label className="field-label" style={{ marginTop: 14 }}>Detail — optional</label>
      <input className="input" placeholder="e.g. Sun–Thu, food only" value={desc} onChange={(e) => setDesc(e.target.value)} />
      <label className="field-label" style={{ marginTop: 14 }}>Code — optional (blank = just show the pass)</label>
      <input className="input" placeholder="e.g. MEMBER10" value={code} onChange={(e) => setCode(e.target.value)} />
      <p className="text-mute" style={{ fontSize: 12, marginTop: 10 }}>Shows on every member’s pass. Redemptions are counted for you.</p>
      {error && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 10 }}>{error}</p>}
    </Modal>
  );
}

// ── Club settings ─────────────────────────────────────────────────────────────
// CPSU-standard safeguarding field toggles. Keys mirror safeguarding_config jsonb.
const SAFEGUARDING_FIELDS = [
  ["ec2",                        "Second emergency contact"],
  ["send",                       "SEND / additional needs"],
  ["dietary",                    "Dietary requirements"],
  ["emergency_tx",               "Consent to emergency medical treatment"],
  ["administer_med",             "Consent to administer medication"],
  ["leave_alone",                "May leave session unaccompanied + authorised collectors"],
];

const DBS_ROLE_FIELDS = [
  ["dbs_required_manager",             "Require DBS check for managers"],
  ["dbs_required_assistant_manager",   "Require DBS check for assistant managers"],
  ["dbs_required_coach",               "Require DBS check for coaches"],
];

function ClubTab({ venueToken }) {
  const [clubs,   setClubs]   = useState(null);
  const [error,   setError]   = useState(null);
  const [saving,  setSaving]  = useState(null);  // club id being saved
  const [saveErr, setSaveErr] = useState(null);

  useEffect(() => {
    let a = true;
    venueListClubs(venueToken)
      .then((r) => { if (a) setClubs(r || []); })
      .catch((e) => { if (a) setError(e?.message || String(e)); });
    return () => { a = false; };
  }, [venueToken]);

  const toggleIdMandate = async (club) => {
    const next = !club.id_mandate;
    setSaving(club.id); setSaveErr(null);
    setClubs((cs) => cs.map((c) => c.id === club.id ? { ...c, id_mandate: next } : c));
    try {
      await venueUpdateClubSettings(venueToken, club.id, { idMandate: next });
    } catch (e) {
      setClubs((cs) => cs.map((c) => c.id === club.id ? { ...c, id_mandate: club.id_mandate } : c));
      setSaveErr(e?.message || String(e));
    } finally { setSaving(null); }
  };

  const toggleSafeguardingField = async (club, key) => {
    const current = club.safeguarding_config || {};
    const next = { ...current, [key]: !current[key] };
    setSaving(club.id + "." + key); setSaveErr(null);
    setClubs((cs) => cs.map((c) => c.id === club.id ? { ...c, safeguarding_config: next } : c));
    try {
      await venueUpdateClubSettings(venueToken, club.id, { safeguardingConfig: next });
    } catch (e) {
      setClubs((cs) => cs.map((c) => c.id === club.id ? { ...c, safeguarding_config: current } : c));
      setSaveErr(e?.message || String(e));
    } finally { setSaving(null); }
  };

  const head = { fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-mute, #888)", margin: "14px 0 6px" };

  if (error) return <EmptyState title="Couldn’t load clubs" body={error} />;
  if (!clubs) return <p className="text-mute" style={{ fontSize: 13, padding: "var(--gap-2)" }}>Loading…</p>;
  if (clubs.length === 0) return (
    <EmptyState title="No clubs linked" body="This venue has no clubs configured. Contact support to link a club." />
  );

  return (
    <div>
      {clubs.map((club) => {
        const sc = club.safeguarding_config || {};
        return (
          <div className="customer-card" key={club.id} style={{ marginBottom: "var(--gap-2)" }}>
            <div className="cu-top">
              <div className="cu-head-text">
                <div className="cu-name">{club.name}</div>
                <div className="cu-sub">{club.contact_email || "No contact email"} · {club.cohorts_count ?? 0} cohort{club.cohorts_count !== 1 ? "s" : ""}</div>
              </div>
            </div>

            <div style={head}>ID &amp; age verification</div>
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!!club.id_mandate}
                disabled={saving === club.id}
                onChange={() => toggleIdMandate(club)}
              />
              <span>Require proof of ID / age at registration</span>
            </label>
            <p className="text-mute" style={{ fontSize: 12, marginTop: 4 }}>
              Members will be prompted to upload a document (passport, licence, PASS card or birth certificate) when joining via the QR signup page.
            </p>

            <div style={head}>Safeguarding fields (CPSU standard)</div>
            <p className="text-mute" style={{ fontSize: 12, marginBottom: 8 }}>
              Turn on the extra fields your club needs to collect on youth registration forms.
            </p>
            <div style={{ display: "grid", gap: 6 }}>
              {SAFEGUARDING_FIELDS.map(([key, label]) => (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={!!sc[key]}
                    disabled={saving === club.id + "." + key}
                    onChange={() => toggleSafeguardingField(club, key)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            <div style={head}>DBS requirements</div>
            <p className="text-mute" style={{ fontSize: 12, marginBottom: 8 }}>
              Staff with a required role must have a valid DBS record before they appear compliant in the Staff tab.
            </p>
            <div style={{ display: "grid", gap: 6 }}>
              {DBS_ROLE_FIELDS.map(([key, label]) => (
                <label key={key} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={!!sc[key]}
                    disabled={saving === club.id + "." + key}
                    onChange={() => toggleSafeguardingField(club, key)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            {saveErr && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 8 }}>{saveErr}</p>}
          </div>
        );
      })}
    </div>
  );
}

// ── Staff ─────────────────────────────────────────────────────────────────────
// Per-club team roster of managers/coaches with DBS status badges.
// Assign/remove staff; record DBS check details.

const DBS_STATUS_BADGE = {
  valid:     { label: "Valid",     bg: "rgba(76,175,80,0.15)",   color: "rgba(76,175,80,1)" },
  pending:   { label: "Pending",   bg: "rgba(255,190,60,0.15)",  color: "var(--amber)" },
  expired:   { label: "Expired",   bg: "rgba(255,96,96,0.15)",   color: "var(--live)" },
  withdrawn: { label: "Withdrawn", bg: "rgba(255,96,96,0.15)",   color: "var(--live)" },
};

const ROLE_LABEL = { manager: "Manager", assistant_manager: "Asst. Manager", coach: "Coach" };

function DbsBadge({ status }) {
  if (!status) {
    return (
      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
        background: "rgba(255,255,255,0.06)", color: "var(--text-mute, #888)",
        fontFamily: "var(--font-body, sans-serif)" }}>No DBS</span>
    );
  }
  const b = DBS_STATUS_BADGE[status] ?? DBS_STATUS_BADGE.pending;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
      background: b.bg, color: b.color,
      fontFamily: "var(--font-body, sans-serif)" }}>{b.label}</span>
  );
}

function StaffTab({ venueToken }) {
  const [clubs,   setClubs]   = useState(null);
  const [staff,   setStaff]   = useState({});   // { [clubId]: staffRow[] }
  const [members, setMembers] = useState([]);
  const [error,   setError]   = useState(null);

  // assign modal state
  const [assigning, setAssigning]   = useState(null); // club row being assigned to
  const [assignTeamId, setAssignTeamId] = useState(null);
  const [assignMemberId, setAssignMemberId] = useState(null);
  const [assignRole, setAssignRole] = useState("coach");
  const [assignSaving, setAssignSaving] = useState(false);
  const [assignErr, setAssignErr]   = useState(null);
  const isAssigningRef = useRef(false);

  // DBS modal state
  const [dbsTarget, setDbsTarget]     = useState(null); // { member_profile_id, first_name, last_name, club_id, ...existing }
  const [dbsCheckType, setDbsCheckType] = useState("enhanced");
  const [dbsStatus, setDbsStatus]     = useState("pending");
  const [dbsCertNum, setDbsCertNum]   = useState("");
  const [dbsIssued, setDbsIssued]     = useState("");
  const [dbsExpiry, setDbsExpiry]     = useState("");
  const [dbsNotes, setDbsNotes]       = useState("");
  const [dbsSaving, setDbsSaving]     = useState(false);
  const [dbsErr, setDbsErr]           = useState(null);
  const isDbsSavingRef = useRef(false);

  const loadStaff = async (clubList) => {
    const results = {};
    await Promise.all((clubList || []).map(async (c) => {
      try {
        results[c.id] = await venueListClubStaff(venueToken, c.id);
      } catch { results[c.id] = []; }
    }));
    setStaff(results);
  };

  useEffect(() => {
    let alive = true;
    Promise.all([
      venueListClubs(venueToken),
      venueListMembers(venueToken),
    ]).then(([cl, mb]) => {
      if (!alive) return;
      const clubList = cl || [];
      setClubs(clubList);
      setMembers(mb || []);
      loadStaff(clubList);
    }).catch((e) => { if (alive) setError(e?.message || String(e)); });
    return () => { alive = false; };
  }, [venueToken]);

  const openAssign = (club) => {
    const clubTeams = [...new Set((staff[club.id] || []).map(r => ({ id: r.team_id, name: r.team_name }))
      .filter(t => t.id)
      .reduce((m, t) => { if (!m.has(t.id)) m.set(t.id, t); return m; }, new Map()).values())];
    setAssigning({ club, teams: clubTeams });
    setAssignTeamId(clubTeams[0]?.id ?? null);
    setAssignMemberId(null);
    setAssignRole("coach");
    setAssignErr(null);
  };

  const handleAssign = async () => {
    if (isAssigningRef.current || !assignTeamId || !assignMemberId) return;
    isAssigningRef.current = true;
    setAssignSaving(true); setAssignErr(null);
    try {
      await venueAssignTeamManager(venueToken, assignTeamId, assignMemberId, assignRole);
      setAssigning(null);
      await loadStaff(clubs);
    } catch (e) {
      setAssignErr(e?.message || String(e));
    } finally {
      setAssignSaving(false);
      isAssigningRef.current = false;
    }
  };

  const handleRemove = async (teamId, memberProfileId, clubId) => {
    try {
      await venueRemoveTeamManager(venueToken, teamId, memberProfileId);
      setStaff(prev => ({
        ...prev,
        [clubId]: (prev[clubId] || []).map(r =>
          r.team_id === teamId && r.member_profile_id === memberProfileId
            ? { ...r, is_active: false } : r
        ),
      }));
    } catch (e) {
      console.error("[staff] remove failed", e);
    }
  };

  const openDbs = (row) => {
    setDbsTarget(row);
    setDbsCheckType(row.dbs_check_type || "enhanced");
    setDbsStatus(row.dbs_status || "pending");
    setDbsCertNum("");
    setDbsIssued("");
    setDbsExpiry(row.dbs_expiry_date ? row.dbs_expiry_date.slice(0, 10) : "");
    setDbsNotes("");
    setDbsErr(null);
  };

  const handleSaveDbs = async () => {
    if (isDbsSavingRef.current || !dbsTarget) return;
    isDbsSavingRef.current = true;
    setDbsSaving(true); setDbsErr(null);
    try {
      await venueUpsertStaffDbs(venueToken, dbsTarget.member_profile_id, dbsTarget.club_id, {
        checkType: dbsCheckType,
        status: dbsStatus,
        certificateNumber: dbsCertNum.trim() || null,
        issuedDate: dbsIssued || null,
        expiryDate: dbsExpiry || null,
        notes: dbsNotes.trim() || null,
      });
      setDbsTarget(null);
      await loadStaff(clubs);
    } catch (e) {
      setDbsErr(e?.message || String(e));
    } finally {
      setDbsSaving(false);
      isDbsSavingRef.current = false;
    }
  };

  const headStyle = { fontWeight: 600, fontSize: 11, textTransform: "uppercase",
    letterSpacing: 0.5, color: "var(--text-mute, #888)", margin: "14px 0 8px" };
  const inputSt = {
    width: "100%", boxSizing: "border-box",
    background: "var(--bg-card, #1a1a1a)", border: "1px solid var(--border, #333)",
    borderRadius: 8, color: "var(--text, #fff)",
    fontSize: 13, padding: "8px 10px", marginTop: 4,
  };

  if (error) return <EmptyState title="Couldn't load staff" body={error} />;
  if (!clubs) return <p className="text-mute" style={{ fontSize: 13, padding: "var(--gap-2)" }}>Loading…</p>;
  if (clubs.length === 0) return <EmptyState title="No clubs linked" body="Link a club via the Club tab first." />;

  return (
    <div>
      {clubs.map((club) => {
        const rows = staff[club.id] || [];
        const active = rows.filter(r => r.is_active);
        const teams = [...new Map(active.map(r => [r.team_id, { id: r.team_id, name: r.team_name }])).values()];

        return (
          <div className="customer-card" key={club.id} style={{ marginBottom: "var(--gap-2)" }}>
            <div className="cu-top">
              <div className="cu-head-text">
                <div className="cu-name">{club.name}</div>
                <div className="cu-sub">{active.length} active staff member{active.length !== 1 ? "s" : ""}</div>
              </div>
              <button
                className="chip"
                onClick={() => openAssign(club)}
                style={{ fontSize: 12 }}
              >
                + Assign staff
              </button>
            </div>

            {teams.length === 0 && (
              <p className="text-mute" style={{ fontSize: 13 }}>No staff assigned yet.</p>
            )}

            {teams.map((team) => {
              const teamRows = active.filter(r => r.team_id === team.id);
              return (
                <div key={team.id} style={{ marginBottom: 12 }}>
                  <div style={headStyle}>{team.name}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {teamRows.map((row) => (
                      <div key={row.manager_id} style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "8px 10px",
                        background: "var(--bg-row, rgba(255,255,255,0.03))",
                        borderRadius: 8, gap: 10,
                      }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>
                            {[row.first_name, row.last_name].filter(Boolean).join(" ")}
                          </span>
                          <span style={{ fontSize: 11, color: "var(--text-mute, #888)", marginLeft: 8 }}>
                            {ROLE_LABEL[row.role] ?? row.role}
                          </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                          <DbsBadge status={row.dbs_status} />
                          <button
                            className="chip"
                            style={{ fontSize: 11 }}
                            onClick={() => openDbs({ ...row, club_id: club.id })}
                          >
                            DBS
                          </button>
                          <button
                            className="chip"
                            style={{ fontSize: 11, color: "var(--live, #f55)" }}
                            onClick={() => handleRemove(row.team_id, row.member_profile_id, club.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* ── Assign staff modal ─────────────────────────────────────────── */}
      {assigning && (
        <Modal title={`Assign staff — ${assigning.club.name}`} onClose={() => setAssigning(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "4px 0 8px" }}>

            {assigning.teams.length > 0 && (
              <div>
                <div style={headStyle}>Team</div>
                <select value={assignTeamId ?? ""} onChange={e => setAssignTeamId(e.target.value)} style={inputSt}>
                  {assigning.teams.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <div style={headStyle}>Member</div>
              <select value={assignMemberId ?? ""} onChange={e => setAssignMemberId(e.target.value || null)} style={inputSt}>
                <option value="">— pick a member —</option>
                {members.map(m => (
                  <option key={m.id} value={m.id}>
                    {[m.first_name, m.last_name].filter(Boolean).join(" ")}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div style={headStyle}>Role</div>
              <select value={assignRole} onChange={e => setAssignRole(e.target.value)} style={inputSt}>
                <option value="manager">Manager</option>
                <option value="assistant_manager">Assistant manager</option>
                <option value="coach">Coach</option>
              </select>
            </div>

            {assignErr && <p style={{ color: "var(--live)", fontSize: 12 }}>{assignErr}</p>}

            <button
              onClick={handleAssign}
              disabled={assignSaving || !assignTeamId || !assignMemberId}
              style={{
                padding: "10px 0", borderRadius: 8, border: "none",
                background: "var(--accent, #60A0FF)", color: "#fff",
                fontSize: 14, fontWeight: 700, cursor: assignSaving ? "not-allowed" : "pointer",
                opacity: (assignSaving || !assignTeamId || !assignMemberId) ? 0.5 : 1,
              }}
            >
              {assignSaving ? "Saving…" : "Assign"}
            </button>
          </div>
        </Modal>
      )}

      {/* ── DBS modal ──────────────────────────────────────────────────── */}
      {dbsTarget && (
        <Modal
          title={`DBS — ${[dbsTarget.first_name, dbsTarget.last_name].filter(Boolean).join(" ")}`}
          onClose={() => setDbsTarget(null)}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 0 8px" }}>
            <div>
              <div style={headStyle}>Check type</div>
              <select value={dbsCheckType} onChange={e => setDbsCheckType(e.target.value)} style={inputSt}>
                <option value="basic">Basic</option>
                <option value="standard">Standard</option>
                <option value="enhanced">Enhanced</option>
                <option value="enhanced_barred">Enhanced + barred list</option>
              </select>
            </div>
            <div>
              <div style={headStyle}>Status</div>
              <select value={dbsStatus} onChange={e => setDbsStatus(e.target.value)} style={inputSt}>
                <option value="pending">Pending</option>
                <option value="valid">Valid</option>
                <option value="expired">Expired</option>
                <option value="withdrawn">Withdrawn</option>
              </select>
            </div>
            <div>
              <div style={headStyle}>Certificate number (optional)</div>
              <input value={dbsCertNum} onChange={e => setDbsCertNum(e.target.value)}
                placeholder="e.g. 001234567890" style={inputSt} />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={headStyle}>Issued date</div>
                <input type="date" value={dbsIssued} onChange={e => setDbsIssued(e.target.value)} style={inputSt} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={headStyle}>Expiry date</div>
                <input type="date" value={dbsExpiry} onChange={e => setDbsExpiry(e.target.value)} style={inputSt} />
              </div>
            </div>
            <div>
              <div style={headStyle}>Notes</div>
              <textarea value={dbsNotes} onChange={e => setDbsNotes(e.target.value)}
                rows={2} placeholder="Optional notes…"
                style={{ ...inputSt, resize: "none" }} />
            </div>
            {dbsErr && <p style={{ color: "var(--live)", fontSize: 12 }}>{dbsErr}</p>}
            <button
              onClick={handleSaveDbs}
              disabled={dbsSaving}
              style={{
                padding: "10px 0", borderRadius: 8, border: "none",
                background: "var(--accent, #60A0FF)", color: "#fff",
                fontSize: 14, fontWeight: 700, cursor: dbsSaving ? "not-allowed" : "pointer",
                opacity: dbsSaving ? 0.5 : 1,
              }}
            >
              {dbsSaving ? "Saving…" : "Save DBS record"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Documents ─────────────────────────────────────────────────────────────────
// Policy documents tab: versioned club-scoped consent docs.
// Venue admins create and publish new versions; members sign via MemberProfile.

function DocumentsTab({ venueToken }) {
  const [clubs,   setClubs]   = useState(null);
  const [docs,    setDocs]    = useState({});   // { [clubId]: [{document_id, title, ...}] }
  const [error,   setError]   = useState(null);
  // create modal
  const [creating, setCreating] = useState(null);  // club object
  const [newTitle, setNewTitle] = useState("");
  const [newBody,  setNewBody]  = useState("");
  const [createErr, setCreateErr] = useState(null);
  const [createSaving, setCreateSaving] = useState(false);
  // new version modal
  const [publishing, setPublishing] = useState(null);  // document object
  const [pubBody,    setPubBody]    = useState("");
  const [pubErr,     setPubErr]     = useState(null);
  const [pubSaving,  setPubSaving]  = useState(false);

  const loadDocs = async (clubList) => {
    const results = {};
    await Promise.all((clubList || []).map(async (c) => {
      try {
        const r = await venueListPolicyDocuments(venueToken, c.id);
        results[c.id] = r?.documents || [];
      } catch { results[c.id] = []; }
    }));
    setDocs(results);
  };

  useEffect(() => {
    let a = true;
    venueListClubs(venueToken)
      .then(async (r) => { if (!a) return; const cl = r || []; setClubs(cl); await loadDocs(cl); })
      .catch((e) => { if (a) setError(e?.message || String(e)); });
    return () => { a = false; };
  }, [venueToken]);

  const [showTemplates, setShowTemplates] = useState(false);

  const openCreate = (club) => { setCreating(club); setNewTitle(""); setNewBody(""); setCreateErr(null); setShowTemplates(false); };
  const closeCreate = () => { setCreating(null); setCreateSaving(false); };
  const saveCreate = async () => {
    if (!newTitle.trim()) { setCreateErr("Title is required."); return; }
    if (!newBody.trim())  { setCreateErr("Document body is required."); return; }
    setCreateSaving(true); setCreateErr(null);
    try {
      await venueCreatePolicyDocument(venueToken, creating.id, newTitle.trim(), newBody.trim());
      const r = await venueListPolicyDocuments(venueToken, creating.id);
      setDocs((d) => ({ ...d, [creating.id]: r?.documents || [] }));
      closeCreate();
    } catch (e) { setCreateErr(e?.message || String(e)); setCreateSaving(false); }
  };

  const openPublish = (doc) => { setPublishing(doc); setPubBody(doc.body ?? ""); setPubErr(null); };
  const closePublish = () => { setPublishing(null); setPubSaving(false); };
  const savePublish = async () => {
    if (!pubBody.trim()) { setPubErr("Body is required."); return; }
    setPubSaving(true); setPubErr(null);
    try {
      await venuePublishPolicyVersion(venueToken, publishing.document_id, pubBody.trim());
      // reload docs for the club that owns this document
      const clubId = clubs.find((c) => (docs[c.id] || []).some((d) => d.document_id === publishing.document_id))?.id;
      if (clubId) {
        const r = await venueListPolicyDocuments(venueToken, clubId);
        setDocs((d) => ({ ...d, [clubId]: r?.documents || [] }));
      }
      closePublish();
    } catch (e) { setPubErr(e?.message || String(e)); setPubSaving(false); }
  };

  const head = { fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-mute, #888)", margin: "14px 0 6px" };

  if (error) return <EmptyState title="Couldn't load documents" body={error} />;
  if (!clubs) return <p className="text-mute" style={{ fontSize: 13, padding: "var(--gap-2)" }}>Loading…</p>;
  if (clubs.length === 0) return <EmptyState title="No clubs linked" body="Policy documents are club-scoped. Link a club first via the Club tab." />;

  return (
    <div>
      {clubs.map((club) => {
        const clubDocs = docs[club.id] || [];
        return (
          <div key={club.id} style={{ marginBottom: "var(--gap-3)" }}>
            <div style={{ ...head, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{club.name}</span>
              <button className="btn-sm btn-outline" onClick={() => openCreate(club)}>+ Add document</button>
            </div>
            {clubDocs.length === 0 ? (
              <p className="text-mute" style={{ fontSize: 12 }}>No documents yet.</p>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {clubDocs.map((doc) => (
                  <div className="customer-card" key={doc.document_id} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{doc.title}</div>
                      <div className="text-mute" style={{ fontSize: 12, marginTop: 2 }}>
                        Version {doc.version} · {doc.acceptance_count} signed · {doc.is_current ? "Current" : "Archived"}
                      </div>
                    </div>
                    {doc.is_current && (
                      <button className="btn-sm btn-outline" onClick={() => openPublish(doc)}>New version</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Create document modal */}
      {creating && (
        <Modal title={`New document — ${creating.name}`} onClose={closeCreate}
          primaryLabel="Create" primaryDisabled={createSaving} onPrimary={saveCreate}>
          {showTemplates ? (
            <>
              <p className="text-mute" style={{ fontSize: 12, marginBottom: 10 }}>
                Choose a template — placeholders like [CLUB NAME] will be visible for you to replace before publishing.
              </p>
              <div style={{ display: "grid", gap: 6 }}>
                {POLICY_TEMPLATES.map((t) => (
                  <button key={t.id} className="btn-sm btn-outline" style={{ textAlign: "left", padding: "8px 12px", height: "auto" }}
                    onClick={() => { setNewTitle(t.title); setNewBody(t.body); setShowTemplates(false); }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{t.title}</div>
                    <div style={{ fontSize: 11, color: "var(--text-mute, #888)", marginTop: 2 }}>
                      {t.audience === "junior" ? "Youth / child" : "All ages"}
                    </div>
                  </button>
                ))}
              </div>
              <button className="btn-sm" style={{ marginTop: 10 }} onClick={() => setShowTemplates(false)}>
                ← Back to blank form
              </button>
            </>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label className="field-label" style={{ margin: 0 }}>Title</label>
                <button className="btn-sm btn-outline" onClick={() => setShowTemplates(true)}>Start from a template</button>
              </div>
              <input className="input" placeholder="e.g. Code of Conduct" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} style={{ marginTop: 6 }} />
              <label className="field-label" style={{ marginTop: 14 }}>Policy text</label>
              <textarea className="input" rows={10} placeholder="Paste or type the full policy text here…" value={newBody}
                onChange={(e) => setNewBody(e.target.value)} style={{ resize: "vertical", fontFamily: "inherit", fontSize: 13 }} />
              <p className="text-mute" style={{ fontSize: 12, marginTop: 8 }}>
                Members will read this text and provide a typed signature to accept.
              </p>
            </>
          )}
          {createErr && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 8 }}>{createErr}</p>}
        </Modal>
      )}

      {/* Publish new version modal */}
      {publishing && (
        <Modal title={`New version — ${publishing.title}`} onClose={closePublish}
          primaryLabel="Publish" primaryDisabled={pubSaving} onPrimary={savePublish}>
          <p className="text-mute" style={{ fontSize: 12, marginBottom: 10 }}>
            Publishing retires version {publishing.version}. Members who signed the old version will be prompted to re-sign.
          </p>
          <label className="field-label">Updated policy text</label>
          <textarea className="input" rows={12} value={pubBody}
            onChange={(e) => setPubBody(e.target.value)} style={{ resize: "vertical", fontFamily: "inherit", fontSize: 13 }} />
          {pubErr && <p style={{ color: "var(--live)", fontSize: 12, marginTop: 8 }}>{pubErr}</p>}
        </Modal>
      )}
    </div>
  );
}

// ── ID Docs ────────────────────────────────────────────────────────────────────
// Verification tab: pending member ID document submissions across all clubs
// linked to this venue. Venue admins view the doc and approve or reject.

const DOC_TYPE_LABELS = {
  passport: "Passport",
  driving_licence: "Driving licence",
  pass_card: "PASS card",
  birth_certificate: "Birth certificate",
};

function IdDocsTab({ venueToken }) {
  const [submissions, setSubmissions] = useState(null);
  const [error,       setError]       = useState(null);
  const [viewDoc,     setViewDoc]     = useState(null);  // submission being reviewed
  const [docUrl,      setDocUrl]      = useState(null);  // signed URL for the doc
  const [docUrlErr,   setDocUrlErr]   = useState(null);
  const [rejectText,  setRejectText]  = useState("");
  const [acting,      setActing]      = useState(false);
  const [actErr,      setActErr]      = useState(null);
  const isActingRef = useRef(false);

  const load = () => venueListIdSubmissions(venueToken)
    .then((r) => setSubmissions(r?.submissions ?? []))
    .catch((e) => setError(e?.message || String(e)));

  useEffect(() => { load(); }, [venueToken]);

  const openDoc = async (sub) => {
    setViewDoc(sub); setDocUrl(null); setDocUrlErr(null);
    setRejectText(""); setActErr(null);
    try {
      const url = await getMemberIdDocUrl(sub.storage_path);
      setDocUrl(url);
    } catch (e) {
      console.error("[id-docs] signed url failed", e);
      setDocUrlErr("Could not load document — check you are signed in.");
    }
  };

  const act = async (action) => {
    if (isActingRef.current) return;
    if (action === "reject" && !rejectText.trim()) { setActErr("Enter a rejection reason."); return; }
    isActingRef.current = true;
    setActing(true); setActErr(null);
    try {
      await venueVerifyIdDocument(venueToken, viewDoc.id, action, rejectText.trim() || null);
      setViewDoc(null);
      load();
    } catch (e) {
      console.error("[id-docs] verify failed", e);
      setActErr(e?.message || "Something went wrong.");
    } finally { setActing(false); isActingRef.current = false; }
  };

  const pending = (submissions || []).filter((s) => s.status === "pending");
  const rest    = (submissions || []).filter((s) => s.status !== "pending");

  const statusPill = (s) => {
    if (s.status === "approved") return <span className="pill-ok" style={{ fontSize: 11 }}>Approved</span>;
    if (s.status === "rejected") return <span className="pill-warn" style={{ fontSize: 11 }}>Rejected</span>;
    return <span className="pill-info" style={{ fontSize: 11 }}>Pending</span>;
  };

  const subRow = (s) => (
    <div key={s.id} className="customer-card" style={{ marginBottom: 8 }}>
      <div className="cu-top">
        <div className="cu-head-text">
          <div className="cu-name">{[s.first_name, s.last_name].filter(Boolean).join(" ")}</div>
          <div className="cu-sub">
            {s.club_name} · {DOC_TYPE_LABELS[s.document_type] ?? s.document_type}
            {" · "}Uploaded {new Date(s.uploaded_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {statusPill(s)}
          <button
            className="btn-secondary"
            style={{ fontSize: 12, padding: "6px 12px" }}
            onClick={() => openDoc(s)}
          >
            Review
          </button>
        </div>
      </div>
      {s.status === "rejected" && s.rejection_reason && (
        <div style={{ fontSize: 12, color: "var(--live)", padding: "0 14px 10px" }}>
          Reason: {s.rejection_reason}
        </div>
      )}
    </div>
  );

  if (error) return <EmptyState title="Couldn't load submissions" body={error} />;
  if (!submissions) return <p className="text-mute" style={{ fontSize: 13, padding: "var(--gap-2)" }}>Loading…</p>;

  return (
    <div>
      {pending.length === 0 && rest.length === 0 && (
        <EmptyState title="No ID submissions" body="Members will appear here once they upload a document." />
      )}

      {pending.length > 0 && (
        <div style={{ marginBottom: "var(--gap-2)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--text-mute, #888)", margin: "14px 0 8px" }}>
            Awaiting review ({pending.length})
          </div>
          {pending.map(subRow)}
        </div>
      )}

      {rest.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: "var(--text-mute, #888)", margin: "14px 0 8px" }}>
            Reviewed
          </div>
          {rest.map(subRow)}
        </div>
      )}

      {viewDoc && (
        <Modal onClose={() => setViewDoc(null)}>
          <div style={{ padding: "20px 0 8px" }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
              {[viewDoc.first_name, viewDoc.last_name].filter(Boolean).join(" ")}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-mute, #888)", marginBottom: 16 }}>
              {viewDoc.club_name} · {DOC_TYPE_LABELS[viewDoc.document_type] ?? viewDoc.document_type}
            </div>

            {docUrlErr && (
              <p style={{ fontSize: 13, color: "var(--live)", marginBottom: 16 }}>{docUrlErr}</p>
            )}
            {!docUrl && !docUrlErr && (
              <p style={{ fontSize: 13, color: "var(--text-mute, #888)", marginBottom: 16 }}>Loading document…</p>
            )}
            {docUrl && (
              <div style={{ marginBottom: 16, textAlign: "center" }}>
                {viewDoc.storage_path.endsWith(".pdf") ? (
                  <a href={docUrl} target="_blank" rel="noreferrer" style={{ fontSize: 14, color: "var(--accent, #60A0FF)" }}>
                    Open PDF document
                  </a>
                ) : (
                  <img
                    src={docUrl}
                    alt="ID document"
                    style={{ maxWidth: "100%", maxHeight: 320, borderRadius: "var(--r)", border: "1px solid var(--border)" }}
                  />
                )}
              </div>
            )}

            {viewDoc.status === "pending" && (
              <>
                <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                  <button
                    className="btn-primary"
                    style={{ flex: 1 }}
                    disabled={acting || !docUrl}
                    onClick={() => act("approve")}
                  >
                    {acting ? "Saving…" : "Approve"}
                  </button>
                </div>
                <textarea
                  placeholder="Rejection reason (required to reject)"
                  value={rejectText}
                  onChange={(e) => setRejectText(e.target.value)}
                  style={{
                    width: "100%", minHeight: 64, padding: "8px 10px",
                    borderRadius: "var(--r)", border: "1px solid var(--border)",
                    background: "var(--b1)", color: "var(--t1)",
                    fontSize: 13, fontFamily: "var(--font-body)", resize: "vertical",
                    boxSizing: "border-box",
                  }}
                />
                <button
                  className="btn-secondary"
                  style={{ width: "100%", marginTop: 8 }}
                  disabled={acting || !rejectText.trim()}
                  onClick={() => act("reject")}
                >
                  Reject
                </button>
                {actErr && <p style={{ fontSize: 12, color: "var(--live)", marginTop: 8 }}>{actErr}</p>}
              </>
            )}

            {viewDoc.status !== "pending" && (
              <div style={{ fontSize: 13, color: "var(--text-mute, #888)", textAlign: "center" }}>
                {viewDoc.status === "approved" ? "This document has been approved." : `Rejected — ${viewDoc.rejection_reason}`}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
