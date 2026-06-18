import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  venueListMembers, venueListMembershipTiers, venueListCustomersPeople, venueApproveCustomer, venueApproveAndEnrol,
  venueCreateMembershipTier, venueUpdateMembershipTier, venueEnrolMembership, venueFreezeMembership, venueCancelMembership,
  venueCreateCustomer, venueUpdateCustomer, venueListFeePlans, venueCreateFeePlan, venueEnrolFee, venueCancelFee,
  venueListPartners, venueCreatePartner, venueCreateOffer, venueMembershipSummary,
  venueListClubs, venueUpdateClubSettings,
  venueCreateGradingScheme, venueAddGrade, venueAwardGrade, venueListGradingSchemes,
  venueRecordBout, venueUpdateBout, venueDeleteBout, venueListMemberBouts,
  venueListClubVenues, venueAddClubVenue, venueRemoveClubVenue, venueSearch,
  venueListClubStaff, venueAssignTeamManager, venueRemoveTeamManager, venueUpsertStaffDbs,
  clubSendAnnouncement,
  venueCreatePolicyDocument, venuePublishPolicyVersion, venueListPolicyDocuments,
  venueListIdSubmissions, venueVerifyIdDocument, getMemberIdDocUrl,
  venueUpsertMerchandise, venueListMerchandise, venueListPurchases,
  venueFulfilPurchase, venueCancelPurchase,
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
// Disciplines that use belt/grade progression (mirrors disciplineLabels.hasGrading
// in the member app — martial_arts only today). The Grading tab + per-member
// "Award grade" action only surface for clubs of these disciplines.
const GRADING_DISCIPLINES = ["martial_arts"];
// Disciplines that track a fight record (mirrors disciplineLabels.hasFightRecord
// in the member app — boxing only today). The per-member "Fight record" action
// only surfaces for clubs of these disciplines.
const FIGHT_RECORD_DISCIPLINES = ["boxing"];
const BOUT_RESULTS = [["win", "Win"], ["loss", "Loss"], ["draw", "Draw"], ["no_contest", "No contest"]];
const AGE_BANDS = [["all", "All ages"], ["juniors", "Juniors"], ["adults", "Adults"]];
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
          {[["members", "Members"], ["plans", "Plans"], ["fees", "Team fees"], ["perks", "Perks"], ["club", "Club"], ["grading", "Grading"], ["staff", "Staff"], ["announcements", "Announcements"], ["documents", "Documents"], ["iddocs", "ID docs"], ["merchandise", "Shop"]].map(([v, l]) => (
            <button key={v} className="chip" aria-pressed={tab === v} onClick={() => setTab(v)}>{l}</button>
          ))}
        </span>
      </SectionHead>
      {tab === "members" && <MembersTab venueToken={venueToken} liveTick={liveTick} />}
      {tab === "plans"   && <PlansTab venueToken={venueToken} />}
      {tab === "fees"    && <FeesTab venueToken={venueToken} />}
      {tab === "perks"   && <PerksTab venueToken={venueToken} />}
      {tab === "club"       && <ClubTab venueToken={venueToken} />}
      {tab === "grading"    && <GradingTab venueToken={venueToken} />}
      {tab === "staff"          && <StaffTab venueToken={venueToken} />}
      {tab === "announcements"  && <AnnouncementsTab venueToken={venueToken} />}
      {tab === "documents"      && <DocumentsTab venueToken={venueToken} />}
      {tab === "iddocs"     && <IdDocsTab venueToken={venueToken} />}
      {tab === "merchandise" && <MerchandiseTab venueToken={venueToken} />}
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
  const [gradeFor, setGradeFor] = useState(null);     // member being awarded a grade/belt
  const [boutsFor, setBoutsFor] = useState(null);     // member whose fight record is open

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
                  {m.club_id && GRADING_DISCIPLINES.includes(m.discipline) && <button className="btn btn-xs" onClick={() => setGradeFor(m)} title="Award a belt / grade"><Icon name="cups" size={13} /> Award grade</button>}
                  {m.club_id && FIGHT_RECORD_DISCIPLINES.includes(m.discipline) && <button className="btn btn-xs" onClick={() => setBoutsFor(m)} title="View / record bouts"><Icon name="cups" size={13} /> Fight record</button>}
                  {m.status === "active" && <button className="btn btn-xs" onClick={() => setFreezeFor(m)}><Icon name="clock" size={13} /> Freeze</button>}
                  {m.status !== "cancelled" && <button className="btn btn-xs" onClick={() => setCancelFor(m)}><Icon name="x" size={13} /> Cancel</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {profileFor && <ProfileModal venueToken={venueToken} customerId={profileFor.customer_id} name={fullName(profileFor)} onClose={() => setProfileFor(null)} onDone={() => { setProfileFor(null); reload(); }} />}
      {gradeFor && <GradeModal venueToken={venueToken} member={gradeFor} onClose={() => setGradeFor(null)} onDone={() => setGradeFor(null)} />}
      {boutsFor && <BoutsModal venueToken={venueToken} member={boutsFor} onClose={() => setBoutsFor(null)} />}
      {enrolReq && <ApproveEnrolModal venueToken={venueToken} person={enrolReq} onClose={() => setEnrolReq(null)} onDone={() => { setEnrolReq(null); reload(); }} />}
      {enrolOpen && <EnrolModal venueToken={venueToken} onClose={() => setEnrolOpen(false)} onDone={() => { setEnrolOpen(false); reload(); }} />}
      {freezeFor && <FreezeModal venueToken={venueToken} member={freezeFor} onClose={() => setFreezeFor(null)} onDone={() => { setFreezeFor(null); reload(); }} />}
      {cancelFor && <CancelModal venueToken={venueToken} member={cancelFor} onClose={() => setCancelFor(null)} onDone={() => { setCancelFor(null); reload(); }} />}
    </div>
  );
}

// ── Award grade (per-member, from the Members roster) ────────────────────────
function GradeModal({ venueToken, member, onClose, onDone }) {
  const [schemes, setSchemes] = useState(null);
  const [schemeId, setSchemeId] = useState("");
  const [gradeId, setGradeId] = useState("");
  const [stripes, setStripes] = useState(0);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null); // result jsonb after a successful award
  const isSavingRef = useRef(false);

  useEffect(() => {
    let a = true;
    venueListGradingSchemes(venueToken, member.club_id)
      .then((r) => { if (a) setSchemes((r?.schemes) || []); })
      .catch((e) => { if (a) setError(e?.message || String(e)); });
    return () => { a = false; };
  }, [venueToken, member.club_id]);

  const scheme = (schemes || []).find((s) => s.scheme_id === schemeId);
  const grade = scheme?.grades?.find((g) => g.grade_id === gradeId);
  const maxStripes = grade?.max_stripes || 0;

  const submit = async () => {
    if (isSavingRef.current || !gradeId) return;
    isSavingRef.current = true; setSaving(true); setError(null);
    try {
      const r = await venueAwardGrade(venueToken, member.membership_id, gradeId, Number(stripes) || 0, note.trim() || null);
      setDone(r);
    } catch (e) {
      setError(e?.message === "grade_club_mismatch" ? "That grade belongs to a different club." : "Couldn’t award the grade — try again.");
    } finally { isSavingRef.current = false; setSaving(false); }
  };

  return (
    <Modal title={`Award grade — ${fullName(member) || "member"}`} onClose={onClose} foot={
      done
        ? <button className="btn btn-primary" onClick={onDone}>Done</button>
        : <>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={saving || !gradeId} onClick={submit}>{saving ? "Awarding…" : "Award grade"}</button>
          </>
    }>
      {done ? (
        <div style={{ display: "grid", gap: 10 }}>
          <div className="pill pill-ok" style={{ width: "fit-content" }}>Awarded {grade?.name}{Number(stripes) > 0 ? ` · ${stripes} stripe${Number(stripes) === 1 ? "" : "s"}` : ""}</div>
          {done.at_max && <p className="text-mute" style={{ fontSize: 13 }}>This grade is at its maximum stripes — the member is ready to be promoted to the next grade.</p>}
        </div>
      ) : schemes === null ? (
        <p className="text-mute">Loading grading schemes…</p>
      ) : schemes.length === 0 ? (
        <EmptyState title="No grading schemes yet" body="Set up a scheme and grades in the Grading tab first." />
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <label className="field-label">Scheme</label>
            <select className="input" value={schemeId} onChange={(e) => { setSchemeId(e.target.value); setGradeId(""); setStripes(0); }}>
              <option value="">Choose a scheme…</option>
              {schemes.map((s) => <option key={s.scheme_id} value={s.scheme_id}>{s.name}{s.age_band !== "all" ? ` (${s.age_band})` : ""}</option>)}
            </select>
          </div>
          {scheme && (
            <div>
              <label className="field-label">Grade</label>
              <select className="input" value={gradeId} onChange={(e) => { setGradeId(e.target.value); setStripes(0); }}>
                <option value="">Choose a grade…</option>
                {(scheme.grades || []).map((g) => <option key={g.grade_id} value={g.grade_id}>{g.name}</option>)}
              </select>
            </div>
          )}
          {grade && maxStripes > 0 && (
            <div>
              <label className="field-label">Stripes (0–{maxStripes})</label>
              <input className="input" type="number" min={0} max={maxStripes} value={stripes}
                onChange={(e) => setStripes(Math.max(0, Math.min(maxStripes, Number(e.target.value) || 0)))} />
            </div>
          )}
          <div>
            <label className="field-label">Note (optional)</label>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. graded at summer camp" />
          </div>
          {error && <p style={{ color: "var(--live)", fontSize: 13 }}>{error}</p>}
        </div>
      )}
    </Modal>
  );
}

// ── Fight record (per-member, from the Members roster; boxing clubs) ─────────
function BoutsModal({ venueToken, member, onClose }) {
  const [data, setData] = useState(null);      // { record, bouts } or null while loading
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ boutDate: isoPlusDays(0), result: "win", opponentName: "", eventName: "", method: "", rounds: "", isSparring: false, note: "" });
  const isSavingRef = useRef(false);

  const load = () => {
    venueListMemberBouts(venueToken, member.membership_id)
      .then((r) => setData({ record: r?.record || {}, bouts: r?.bouts || [] }))
      .catch((e) => setError(e?.message || String(e)));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [venueToken, member.membership_id]);

  const submit = async () => {
    if (isSavingRef.current || !form.boutDate || !form.result) return;
    isSavingRef.current = true; setError(null);
    try {
      await venueRecordBout(venueToken, member.membership_id, {
        boutDate: form.boutDate, result: form.result,
        opponentName: form.opponentName.trim() || null, eventName: form.eventName.trim() || null,
        method: form.method.trim() || null, rounds: form.rounds === "" ? null : Number(form.rounds),
        isSparring: form.isSparring, note: form.note.trim() || null,
      });
      setForm({ boutDate: isoPlusDays(0), result: "win", opponentName: "", eventName: "", method: "", rounds: "", isSparring: false, note: "" });
      setAdding(false);
      setData(null); load();
    } catch (e) { setError("Couldn’t record the bout — try again."); }
    finally { isSavingRef.current = false; }
  };

  const toggleVoid = async (b) => {
    if (isSavingRef.current) return;
    isSavingRef.current = true; setError(null);
    try { await venueDeleteBout(venueToken, b.bout_id, !b.voided); setData(null); load(); }
    catch (e) { setError("Couldn’t update the bout — try again."); }
    finally { isSavingRef.current = false; }
  };

  const rec = data?.record || {};
  const recLabel = `${rec.wins || 0}-${rec.losses || 0}-${rec.draws || 0}${rec.no_contests ? ` (${rec.no_contests} NC)` : ""}`;

  return (
    <Modal title={`Fight record — ${fullName(member) || "member"}`} onClose={onClose} foot={
      <button className="btn btn-primary" onClick={onClose}>Done</button>
    }>
      {data === null ? <p className="text-mute">Loading…</p> : (
        <div style={{ display: "grid", gap: 14 }}>
          <div className="pill pill-info" style={{ width: "fit-content" }}>Record (bouts): {recLabel}</div>

          {!adding && <button className="btn btn-sm" onClick={() => setAdding(true)}><Icon name="plus" size={13} /> Record a bout</button>}

          {adding && (
            <div style={{ display: "grid", gap: 10, padding: 12, border: "1px solid var(--border)", borderRadius: 8 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 130 }}>
                  <label className="field-label">Date</label>
                  <input className="input" type="date" value={form.boutDate} onChange={(e) => setForm((f) => ({ ...f, boutDate: e.target.value }))} />
                </div>
                <div style={{ flex: 1, minWidth: 110 }}>
                  <label className="field-label">Result</label>
                  <select className="input" value={form.result} onChange={(e) => setForm((f) => ({ ...f, result: e.target.value }))}>
                    {BOUT_RESULTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="field-label">Opponent (optional)</label>
                <input className="input" value={form.opponentName} onChange={(e) => setForm((f) => ({ ...f, opponentName: e.target.value }))} placeholder="e.g. J. Smith" />
              </div>
              <div>
                <label className="field-label">Event (optional)</label>
                <input className="input" value={form.eventName} onChange={(e) => setForm((f) => ({ ...f, eventName: e.target.value }))} placeholder="e.g. Regional ABA semi-final" />
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 130 }}>
                  <label className="field-label">Method (optional)</label>
                  <input className="input" value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))} placeholder="KO / TKO / decision" />
                </div>
                <div style={{ width: 90 }}>
                  <label className="field-label">Rounds</label>
                  <input className="input" type="number" min={0} value={form.rounds} onChange={(e) => setForm((f) => ({ ...f, rounds: e.target.value }))} />
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                <input type="checkbox" checked={form.isSparring} onChange={(e) => setForm((f) => ({ ...f, isSparring: e.target.checked }))} />
                Sparring (excluded from the headline record)
              </label>
              <div>
                <label className="field-label">Note (optional)</label>
                <input className="input" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-sm btn-primary" disabled={!form.boutDate} onClick={submit}>Save bout</button>
                <button className="btn btn-sm btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
              </div>
            </div>
          )}

          {data.bouts.length === 0 ? (
            <EmptyState title="No bouts yet" body="Record a bout to start this member’s fight record." />
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {data.bouts.map((b) => (
                <div key={b.bout_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 8, opacity: b.voided ? 0.5 : 1 }}>
                  <span className={"pill " + (b.result === "win" ? "pill-ok" : b.result === "loss" ? "pill-warn" : "pill-muted")}>{(BOUT_RESULTS.find((r) => r[0] === b.result) || [, b.result])[1]}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14 }}>{b.opponent_name || "Opponent —"}{b.is_sparring ? " · sparring" : ""}</div>
                    <div className="text-mute" style={{ fontSize: 12 }}>{b.bout_date}{b.event_name ? ` · ${b.event_name}` : ""}{b.method ? ` · ${b.method}` : ""}{b.rounds != null ? ` · ${b.rounds}r` : ""}{b.voided ? " · voided" : ""}</div>
                  </div>
                  <button className="btn btn-xs btn-ghost" onClick={() => toggleVoid(b)}>{b.voided ? "Restore" : "Void"}</button>
                </div>
              ))}
            </div>
          )}
          {error && <p style={{ color: "var(--live)", fontSize: 13 }}>{error}</p>}
        </div>
      )}
    </Modal>
  );
}

// ── Grading schemes setup (operator: per-club belt/grade ladders) ────────────
function GradingTab({ venueToken }) {
  const [clubs, setClubs] = useState(null);
  const [clubId, setClubId] = useState(null);
  const [schemes, setSchemes] = useState(null);
  const [error, setError] = useState(null);
  const [newScheme, setNewScheme] = useState({ name: "", ageBand: "all" });
  const [addGradeFor, setAddGradeFor] = useState(null); // scheme_id
  const [gradeForm, setGradeForm] = useState({ name: "", colour: "#3030FF", maxStripes: 0 });
  const isSavingRef = useRef(false);

  useEffect(() => {
    let a = true;
    venueListClubs(venueToken)
      .then((cs) => {
        if (!a) return;
        const grad = (cs || []).filter((c) => GRADING_DISCIPLINES.includes(c.discipline));
        setClubs(grad);
        if (grad.length) setClubId(grad[0].id);
      })
      .catch(() => { if (a) setClubs([]); });
    return () => { a = false; };
  }, [venueToken]);

  const loadSchemes = (cid) => {
    if (!cid) return;
    setSchemes(null);
    venueListGradingSchemes(venueToken, cid)
      .then((r) => setSchemes((r?.schemes) || []))
      .catch((e) => setError(e?.message || String(e)));
  };
  useEffect(() => { if (clubId) loadSchemes(clubId); }, [clubId]);

  const createScheme = async () => {
    if (isSavingRef.current || !newScheme.name.trim()) return;
    isSavingRef.current = true; setError(null);
    try {
      await venueCreateGradingScheme(venueToken, clubId, newScheme.name.trim(), newScheme.ageBand);
      setNewScheme({ name: "", ageBand: "all" });
      loadSchemes(clubId);
    } catch (e) { setError("Couldn’t create the scheme — try again."); }
    finally { isSavingRef.current = false; }
  };

  const addGrade = async (schemeId, nextRank) => {
    if (isSavingRef.current || !gradeForm.name.trim()) return;
    isSavingRef.current = true; setError(null);
    try {
      await venueAddGrade(venueToken, schemeId, gradeForm.name.trim(), nextRank, gradeForm.colour, Number(gradeForm.maxStripes) || 0);
      setGradeForm({ name: "", colour: "#3030FF", maxStripes: 0 });
      setAddGradeFor(null);
      loadSchemes(clubId);
    } catch (e) { setError(e?.message === "rank_order_taken" ? "That position is taken — try again." : "Couldn’t add the grade — try again."); }
    finally { isSavingRef.current = false; }
  };

  if (!clubs) return <p className="text-mute" style={{ padding: 24 }}>Loading…</p>;
  if (!clubs.length) return <EmptyState title="No grading clubs" body="Grading applies to martial-arts clubs. Set a club’s discipline to Martial arts in the Club tab first." />;

  return (
    <div>
      {clubs.length > 1 && (
        <div style={{ marginBottom: 16 }}>
          <label className="field-label" style={{ marginRight: 8 }}>Club</label>
          <select className="input" style={{ width: "auto" }} value={clubId || ""} onChange={(e) => setClubId(e.target.value)}>
            {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      <div className="panel" style={{ padding: "var(--gap-2)", marginBottom: "var(--gap-2)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
        <strong style={{ display: "block", marginBottom: 8 }}>New grading scheme</strong>
        <p className="text-mute" style={{ fontSize: 12, marginTop: 0 }}>One scheme per ladder — e.g. a Juniors ladder and an Adults ladder are two schemes.</p>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input className="input" placeholder="Scheme name (e.g. Adult belts)" value={newScheme.name} onChange={(e) => setNewScheme((s) => ({ ...s, name: e.target.value }))} style={{ flex: 1, minWidth: 180 }} />
          <select className="input" style={{ width: "auto" }} value={newScheme.ageBand} onChange={(e) => setNewScheme((s) => ({ ...s, ageBand: e.target.value }))}>
            {AGE_BANDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button className="btn btn-primary" onClick={createScheme}><Icon name="plus" size={14} /> Create</button>
        </div>
      </div>

      {error && <p style={{ color: "var(--live)", fontSize: 13 }}>{error}</p>}
      {schemes === null && <p className="text-mute">Loading schemes…</p>}
      {schemes && schemes.length === 0 && <EmptyState title="No schemes yet" body="Create a grading scheme above, then add its grades in order (lowest first)." />}

      {schemes && schemes.map((s) => {
        const nextRank = (s.grades || []).reduce((mx, g) => Math.max(mx, g.rank_order), 0) + 1;
        return (
          <div className="customer-card" key={s.scheme_id} style={{ marginBottom: "var(--gap-2)" }}>
            <div className="cu-top">
              <div className="cu-head-text">
                <div className="cu-name">{s.name}</div>
                <div className="cu-sub">{AGE_BANDS.find(([v]) => v === s.age_band)?.[1] || s.age_band} · {(s.grades || []).length} grade{(s.grades || []).length === 1 ? "" : "s"}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" }}>
              {(s.grades || []).map((g) => (
                <span key={g.grade_id} className="pill" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: g.colour_hex || "#888", border: "1px solid var(--border)" }} />
                  {g.name}{g.max_stripes > 0 ? ` · ${g.max_stripes}★` : ""}
                </span>
              ))}
              {(s.grades || []).length === 0 && <span className="text-mute" style={{ fontSize: 13 }}>No grades yet — add the lowest grade first.</span>}
            </div>
            {addGradeFor === s.scheme_id ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input className="input" placeholder={`Grade name (position ${nextRank})`} value={gradeForm.name} onChange={(e) => setGradeForm((f) => ({ ...f, name: e.target.value }))} style={{ flex: 1, minWidth: 140 }} />
                <input type="color" value={gradeForm.colour} onChange={(e) => setGradeForm((f) => ({ ...f, colour: e.target.value }))} title="Belt / grade colour" style={{ width: 40, height: 34, padding: 2, border: "1px solid var(--border)", borderRadius: 6 }} />
                <label className="field-label" style={{ margin: 0 }}>Max stripes</label>
                <input className="input" type="number" min={0} max={10} value={gradeForm.maxStripes} onChange={(e) => setGradeForm((f) => ({ ...f, maxStripes: Math.max(0, Number(e.target.value) || 0) }))} style={{ width: 70 }} />
                <button className="btn btn-xs btn-primary" onClick={() => addGrade(s.scheme_id, nextRank)}>Add</button>
                <button className="btn btn-xs btn-ghost" onClick={() => { setAddGradeFor(null); setGradeForm({ name: "", colour: "#3030FF", maxStripes: 0 }); }}>Cancel</button>
              </div>
            ) : (
              <button className="btn btn-xs" onClick={() => setAddGradeFor(s.scheme_id)}><Icon name="plus" size={13} /> Add grade</button>
            )}
          </div>
        );
      })}
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

// AddVenueModal — debounced search → select → confirm add
function AddVenueModal({ venueToken, clubId, onAdded, onClose }) {
  const [query,    setQuery]    = useState("");
  const [results,  setResults]  = useState([]);
  const [searching, setSearching] = useState(false);
  const [adding,   setAdding]   = useState(null);  // venue_id being added
  const [err,      setErr]      = useState(null);
  const timerRef = useRef(null);

  const search = (q) => {
    setQuery(q);
    clearTimeout(timerRef.current);
    if (q.trim().length < 2) { setResults([]); return; }
    timerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await venueSearch(venueToken, q, clubId);
        setResults(r?.venues || []);
      } catch (e) {
        console.error(e);
      } finally { setSearching(false); }
    }, 300);
  };

  const add = async (v) => {
    setAdding(v.venue_id); setErr(null);
    try {
      await venueAddClubVenue(venueToken, clubId, v.venue_id);
      onAdded(v);
    } catch (e) {
      setErr(e?.message || String(e));
      setAdding(null);
    }
  };

  return (
    <Modal onClose={onClose} title="Add venue to club">
      <div style={{ display: "grid", gap: "var(--gap-2)" }}>
        <p style={{ fontSize: 13, color: "var(--text-mute)" }}>
          Search by venue name or city. Only venues not already in the club’s network are shown.
        </p>
        <input
          className="form-input"
          placeholder="Search venues…"
          value={query}
          onChange={(e) => search(e.target.value)}
          autoFocus
        />
        {searching && <p style={{ fontSize: 13, color: "var(--text-mute)" }}>Searching…</p>}
        {!searching && query.trim().length >= 2 && results.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--text-mute)" }}>No venues found matching "{query}".</p>
        )}
        {results.length > 0 && (
          <div style={{ display: "grid", gap: 6 }}>
            {results.map((v) => (
              <div key={v.venue_id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", background: "var(--surface-2)", borderRadius: 6 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{v.venue_name}</div>
                  {v.city && <div style={{ fontSize: 12, color: "var(--text-mute)" }}>{v.city}</div>}
                </div>
                <button
                  className="btn-primary"
                  style={{ fontSize: 12, padding: "4px 12px" }}
                  disabled={!!adding}
                  onClick={() => add(v)}
                >
                  {adding === v.venue_id ? "Adding…" : "Add"}
                </button>
              </div>
            ))}
          </div>
        )}
        {err && <p style={{ color: "var(--live)", fontSize: 12 }}>{err}</p>}
      </div>
    </Modal>
  );
}

// VenuesSection — lazy-loaded list of club venues with add/remove controls
function VenuesSection({ venueToken, clubId }) {
  const [venues,   setVenues]   = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [open,     setOpen]     = useState(false);
  const [removing, setRemoving] = useState(null);
  const [removeErr, setRemoveErr] = useState(null);
  const [showAdd,  setShowAdd]  = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await venueListClubVenues(venueToken, clubId);
      setVenues(r?.venues || []);
    } catch (e) {
      console.error(e);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (open && venues === null) load();
  }, [open]);

  const remove = async (v) => {
    if (!window.confirm(`Remove ${v.venue_name} from this club’s network?`)) return;
    setRemoving(v.venue_id); setRemoveErr(null);
    try {
      await venueRemoveClubVenue(venueToken, clubId, v.venue_id);
      setVenues((vs) => vs.filter((x) => x.venue_id !== v.venue_id));
    } catch (e) {
      const msg = e?.message || String(e);
      setRemoveErr(msg.includes("last_venue") ? "Can’t remove the last venue from a club." :
                  msg.includes("active_members") ? "This venue has active members — reassign them first." : msg);
    } finally { setRemoving(null); }
  };

  const head = { fontWeight: 600, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-mute, #888)", margin: "14px 0 6px" };

  return (
    <div>
      <div style={{ ...head, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>
        <span>Venues ({venues !== null ? venues.length : "…"})</span>
        <span style={{ fontSize: 10 }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
          {loading && <p style={{ fontSize: 13, color: "var(--text-mute)" }}>Loading…</p>}
          {!loading && venues !== null && venues.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--text-mute)" }}>No venues in this club’s network yet.</p>
          )}
          {(venues || []).map((v) => (
            <div key={v.venue_id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", background: "var(--surface-2)", borderRadius: 6 }}>
              <div>
                <span style={{ fontWeight: v.is_self ? 600 : 400, fontSize: 13 }}>{v.venue_name}{v.is_self ? " (you)" : ""}</span>
                {v.city && <span style={{ fontSize: 12, color: "var(--text-mute)", marginLeft: 6 }}>{v.city}</span>}
                <span style={{ fontSize: 11, color: "var(--text-mute)", marginLeft: 8 }}>{v.recent_checkins} check-in{v.recent_checkins !== 1 ? "s" : ""} (30d)</span>
              </div>
              {!v.is_self && (
                <button
                  className="btn-ghost"
                  style={{ fontSize: 12, color: "var(--live)", padding: "2px 8px" }}
                  disabled={removing === v.venue_id}
                  onClick={() => remove(v)}
                >
                  {removing === v.venue_id ? "…" : "Remove"}
                </button>
              )}
            </div>
          ))}
          {removeErr && <p style={{ color: "var(--live)", fontSize: 12 }}>{removeErr}</p>}
          <button className="btn-ghost" style={{ fontSize: 13, alignSelf: "flex-start", marginTop: 2 }} onClick={() => setShowAdd(true)}>
            + Add venue
          </button>
        </div>
      )}
      {showAdd && (
        <AddVenueModal
          venueToken={venueToken}
          clubId={clubId}
          onAdded={(v) => {
            setVenues((vs) => [...(vs || []), { ...v, is_self: false, recent_checkins: 0 }]);
            setShowAdd(false);
          }}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

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

            <VenuesSection venueToken={venueToken} clubId={club.id} />

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

// ── Announcements ─────────────────────────────────────────────────────────────
function AnnouncementsTab({ venueToken }) {
  const [clubs,      setClubs]      = useState(null);
  const [clubId,     setClubId]     = useState(null);
  const [cohorts,    setCohorts]    = useState([]);
  const [teams,      setTeams]      = useState([]);
  const [audience,   setAudience]   = useState("club");
  const [cohortId,   setCohortId]   = useState(null);
  const [teamId,     setTeamId]     = useState(null);
  const [title,      setTitle]      = useState("");
  const [body,       setBody]       = useState("");
  const [saving,     setSaving]     = useState(false);
  const [sent,       setSent]       = useState(false);
  const [error,      setError]      = useState(null);
  const isSavingRef = useRef(false);

  useEffect(() => {
    venueListClubs(venueToken)
      .then((cs) => {
        setClubs(cs || []);
        if (cs?.length) {
          const first = cs[0];
          setClubId(first.id);
          setCohorts(first.cohorts || []);
          setTeams(first.teams || []);
        }
      })
      .catch(() => setClubs([]));
  }, [venueToken]);

  const handleClubChange = (id) => {
    setClubId(id);
    setCohortId(null);
    setTeamId(null);
    setAudience("club");
    const c = (clubs || []).find((c) => c.id === id);
    setCohorts(c?.cohorts || []);
    setTeams(c?.teams || []);
  };

  const handleSend = async () => {
    if (isSavingRef.current) return;
    setError(null);
    if (!title.trim()) { setError("Title is required."); return; }
    if (!body.trim())  { setError("Message body is required."); return; }
    if (audience === "cohort" && !cohortId) { setError("Pick a cohort."); return; }
    if (audience === "team"   && !teamId)   { setError("Pick a team."); return; }
    isSavingRef.current = true;
    setSaving(true);
    try {
      await clubSendAnnouncement(venueToken, clubId, title, body, audience,
        audience === "cohort" ? cohortId : null,
        audience === "team"   ? teamId   : null);
      setSent(true);
      setTitle("");
      setBody("");
      setAudience("club");
      setCohortId(null);
      setTeamId(null);
    } catch (e) {
      console.error("[announcements] club_send_announcement failed", e);
      setError(e.message || "Failed to queue announcement.");
    } finally {
      isSavingRef.current = false;
      setSaving(false);
    }
  };

  if (!clubs) return <p style={{ padding: 24, color: "var(--text-mute, #888)" }}>Loading…</p>;
  if (!clubs.length) return <EmptyState message="No clubs linked to this venue yet." />;

  return (
    <div style={{ padding: "20px 0", maxWidth: 560 }}>
      <p style={{ fontSize: 13, color: "var(--text-mute, #888)", marginBottom: 20 }}>
        Send a one-way announcement by email to club members. Delivered within 5 minutes.
      </p>

      {clubs.length > 1 && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Club</label>
          <select value={clubId || ""} onChange={(e) => handleClubChange(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border, #ddd)", fontSize: 14 }}>
            {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Audience</label>
        <div style={{ display: "flex", gap: 8 }}>
          {[["club", "Whole club"], ["cohort", "Cohort"], ["team", "Team"]].map(([v, l]) => (
            <button key={v} onClick={() => { setAudience(v); setCohortId(null); setTeamId(null); }}
              style={{
                padding: "6px 14px", borderRadius: 20, fontSize: 13, cursor: "pointer",
                background: audience === v ? "var(--accent, #111)" : "transparent",
                color: audience === v ? "#fff" : "var(--text, #111)",
                border: "1px solid var(--border, #ddd)",
              }}>{l}</button>
          ))}
        </div>
      </div>

      {audience === "cohort" && cohorts.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Cohort</label>
          <select value={cohortId || ""} onChange={(e) => setCohortId(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border, #ddd)", fontSize: 14 }}>
            <option value="">— pick a cohort —</option>
            {cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {audience === "team" && teams.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Team</label>
          <select value={teamId || ""} onChange={(e) => setTeamId(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border, #ddd)", fontSize: 14 }}>
            <option value="">— pick a team —</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Subject / title</label>
        <input type="text" value={title} onChange={(e) => { setTitle(e.target.value); setSent(false); }}
          placeholder="e.g. Training update — this Saturday"
          style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border, #ddd)", fontSize: 14, boxSizing: "border-box" }} />
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Message</label>
        <textarea value={body} onChange={(e) => { setBody(e.target.value); setSent(false); }}
          rows={5} placeholder="Write your message here…"
          style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border, #ddd)", fontSize: 14, resize: "vertical", boxSizing: "border-box" }} />
      </div>

      {error && <p style={{ color: "#c00", fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {sent  && <p style={{ color: "#2a7a2a", fontSize: 13, marginBottom: 12 }}>Announcement queued — will be emailed within 5 minutes.</p>}

      <button onClick={handleSend} disabled={saving}
        style={{
          padding: "10px 24px", borderRadius: 8, background: "var(--accent, #111)", color: "#fff",
          border: "none", fontSize: 14, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer",
          opacity: saving ? 0.6 : 1,
        }}>
        {saving ? "Sending…" : "Send announcement"}
      </button>
    </div>
  );
}

// ── Merchandise ───────────────────────────────────────────────────────────────
const MERCH_CATEGORIES = ["kit", "accessories", "equipment", "other"];
const CAT_LABELS = { kit: "Kit / uniform", accessories: "Accessories", equipment: "Equipment", other: "Other" };

function MerchandiseTab({ venueToken }) {
  const [subTab,    setSubTab]    = useState("catalogue");
  const [clubs,     setClubs]     = useState(null);
  const [clubId,    setClubId]    = useState(null);

  useEffect(() => {
    venueListClubs(venueToken)
      .then((cs) => {
        setClubs(cs || []);
        if (cs?.length) setClubId(cs[0].id);
      })
      .catch(() => setClubs([]));
  }, [venueToken]);

  if (!clubs) return <p style={{ padding: 24, color: "var(--muted, #888)" }}>Loading…</p>;
  if (!clubs.length) return <EmptyState message="No clubs found at this venue." />;

  return (
    <div>
      {clubs.length > 1 && (
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 600, marginRight: 8 }}>Club</label>
          <select value={clubId || ""} onChange={(e) => setClubId(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border, #ddd)", fontSize: 14 }}>
            {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {[["catalogue", "Catalogue"], ["orders", "Orders"]].map(([v, l]) => (
          <button key={v} onClick={() => setSubTab(v)}
            style={{
              padding: "6px 16px", borderRadius: 20, fontSize: 13, fontWeight: 600,
              border: "1px solid var(--border, #ddd)", cursor: "pointer",
              background: subTab === v ? "var(--accent, #111)" : "transparent",
              color: subTab === v ? "#fff" : "var(--text, #111)",
            }}>
            {l}
          </button>
        ))}
      </div>

      {clubId && subTab === "catalogue" && <CataloguePanel venueToken={venueToken} clubId={clubId} />}
      {clubId && subTab === "orders"    && <OrdersPanel    venueToken={venueToken} clubId={clubId} />}
    </div>
  );
}

function CataloguePanel({ venueToken, clubId }) {
  const [items,      setItems]      = useState(null);
  const [showForm,   setShowForm]   = useState(false);
  const [editing,    setEditing]    = useState(null);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState(null);
  const isSavingRef = useRef(false);

  const blank = { name: "", category: "kit", pricePence: "", description: "", stockQty: "", active: true };
  const [form, setForm] = useState(blank);

  const load = () => {
    venueListMerchandise(venueToken, clubId)
      .then((rows) => setItems(rows || []))
      .catch(() => setItems([]));
  };

  useEffect(() => { load(); }, [venueToken, clubId]);

  const openNew = () => { setEditing(null); setForm(blank); setError(null); setShowForm(true); };
  const openEdit = (item) => {
    setEditing(item.id);
    setForm({
      name: item.name || "",
      category: item.category || "kit",
      pricePence: item.price_pence != null ? (item.price_pence / 100).toFixed(2) : "",
      description: item.description || "",
      stockQty: item.stock_qty != null ? String(item.stock_qty) : "",
      active: item.active !== false,
    });
    setError(null);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (isSavingRef.current) return;
    setError(null);
    if (!form.name.trim())  { setError("Name is required."); return; }
    if (!form.category)     { setError("Category is required."); return; }
    const price = toPence(form.pricePence);
    if (price == null || price < 0) { setError("Enter a valid price (e.g. 25.00)."); return; }
    isSavingRef.current = true;
    setSaving(true);
    try {
      await venueUpsertMerchandise(venueToken, clubId, {
        id: editing || null,
        name: form.name.trim(),
        category: form.category,
        pricePence: price,
        description: form.description.trim() || null,
        stockQty: form.stockQty !== "" ? parseInt(form.stockQty, 10) : null,
        active: form.active,
      });
      setShowForm(false);
      load();
    } catch (e) {
      console.error("[merch] upsert failed", e);
      setError("Failed to save — try again.");
    } finally {
      isSavingRef.current = false;
      setSaving(false);
    }
  };

  const field = (label, content) => (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 5 }}>{label}</label>
      {content}
    </div>
  );

  const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border, #ddd)", fontSize: 14, boxSizing: "border-box" };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <SectionHead>Items ({items?.length ?? "…"})</SectionHead>
        <button onClick={openNew}
          style={{ padding: "7px 16px", borderRadius: 8, background: "var(--accent, #111)", color: "#fff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          + Add item
        </button>
      </div>

      {items === null && <p style={{ color: "var(--muted, #888)" }}>Loading…</p>}
      {items?.length === 0 && <EmptyState message="No items yet — add your first product above." />}
      {items?.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border, #eee)" }}>
              {["Name", "Category", "Price", "Stock", "Status", ""].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "6px 8px", fontWeight: 600, fontSize: 12, color: "var(--muted, #888)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} style={{ borderBottom: "1px solid var(--border, #f0f0f0)" }}>
                <td style={{ padding: "10px 8px", fontWeight: 500 }}>{item.name}</td>
                <td style={{ padding: "10px 8px", color: "var(--muted, #666)" }}>{CAT_LABELS[item.category] || item.category}</td>
                <td style={{ padding: "10px 8px" }}>£{(item.price_pence / 100).toFixed(2)}</td>
                <td style={{ padding: "10px 8px", color: "var(--muted, #666)" }}>{item.stock_qty != null ? item.stock_qty : "—"}</td>
                <td style={{ padding: "10px 8px" }}>
                  <span className={item.active ? "pill-ok" : "pill-muted"} style={{ fontSize: 11 }}>
                    {item.active ? "Active" : "Hidden"}
                  </span>
                </td>
                <td style={{ padding: "10px 8px", textAlign: "right" }}>
                  <button onClick={() => openEdit(item)}
                    style={{ background: "none", border: "1px solid var(--border, #ddd)", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showForm && (
        <Modal onClose={() => setShowForm(false)} title={editing ? "Edit item" : "New item"}>
          {field("Name", <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} style={inputStyle} placeholder="e.g. Home kit — adult" />)}
          {field("Category",
            <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} style={{ ...inputStyle, width: "auto" }}>
              {MERCH_CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
            </select>
          )}
          {field("Price (£)", <input type="number" min="0" step="0.01" value={form.pricePence} onChange={(e) => setForm((f) => ({ ...f, pricePence: e.target.value }))} style={inputStyle} placeholder="25.00" />)}
          {field("Description (optional)", <input type="text" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} style={inputStyle} placeholder="Sizes S–XXL available" />)}
          {field("Stock quantity (optional — leave blank for unlimited)", <input type="number" min="0" step="1" value={form.stockQty} onChange={(e) => setForm((f) => ({ ...f, stockQty: e.target.value }))} style={inputStyle} placeholder="Unlimited" />)}
          {field("Visibility",
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
              Visible to members
            </label>
          )}
          {error && <p style={{ color: "#c00", fontSize: 13, marginBottom: 12 }}>{error}</p>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => setShowForm(false)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border, #ddd)", background: "none", fontSize: 14, cursor: "pointer" }}>Cancel</button>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: "8px 20px", borderRadius: 8, background: "var(--accent, #111)", color: "#fff", border: "none", fontSize: 14, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const ORDER_STATUS_LABELS = { pending_payment: "Pending payment", pending: "Pending", fulfilled: "Fulfilled", cancelled: "Cancelled" };
const ORDER_STATUS_CLS    = { pending_payment: "pill-warn", pending: "pill-info", fulfilled: "pill-ok", cancelled: "pill-muted" };

function OrdersPanel({ venueToken, clubId }) {
  const [orders,     setOrders]     = useState(null);
  const [filter,     setFilter]     = useState("");
  const [actioning,  setActioning]  = useState(null);
  const [notes,      setNotes]      = useState("");
  const [error,      setError]      = useState(null);
  const [saving,     setSaving]     = useState(false);
  const isSavingRef = useRef(false);

  const load = () => {
    venueListPurchases(venueToken, clubId, filter || null)
      .then((rows) => setOrders(rows || []))
      .catch(() => setOrders([]));
  };

  useEffect(() => { load(); }, [venueToken, clubId, filter]);

  const handleAction = async (action) => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      if (action === "fulfil") await venueFulfilPurchase(venueToken, actioning.id, notes.trim() || null);
      if (action === "cancel") await venueCancelPurchase(venueToken, actioning.id, notes.trim() || null);
      setActioning(null);
      setNotes("");
      load();
    } catch (e) {
      console.error("[merch] action failed", e);
      setError("Failed — try again.");
    } finally {
      isSavingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
        <SectionHead style={{ margin: 0 }}>Orders</SectionHead>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}
          style={{ marginLeft: "auto", padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border, #ddd)", fontSize: 13 }}>
          <option value="">All statuses</option>
          {Object.entries(ORDER_STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {orders === null && <p style={{ color: "var(--muted, #888)" }}>Loading…</p>}
      {orders?.length === 0 && <EmptyState message="No orders yet." />}
      {orders?.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border, #eee)" }}>
              {["Member", "Item", "Qty", "Total", "Status", "Notes", ""].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "6px 8px", fontWeight: 600, fontSize: 12, color: "var(--muted, #888)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} style={{ borderBottom: "1px solid var(--border, #f0f0f0)" }}>
                <td style={{ padding: "10px 8px", fontWeight: 500 }}>{o.member_name || "—"}</td>
                <td style={{ padding: "10px 8px" }}>{o.item_name || "—"}</td>
                <td style={{ padding: "10px 8px" }}>{o.quantity}</td>
                <td style={{ padding: "10px 8px" }}>£{((o.total_pence || 0) / 100).toFixed(2)}</td>
                <td style={{ padding: "10px 8px" }}>
                  <span className={ORDER_STATUS_CLS[o.status] || "pill-muted"} style={{ fontSize: 11 }}>
                    {ORDER_STATUS_LABELS[o.status] || o.status}
                  </span>
                </td>
                <td style={{ padding: "10px 8px", color: "var(--muted, #666)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.notes || "—"}</td>
                <td style={{ padding: "10px 8px", textAlign: "right" }}>
                  {(o.status === "pending" || o.status === "pending_payment") && (
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button onClick={() => { setActioning({ ...o, _action: "fulfil" }); setNotes(""); setError(null); }}
                        style={{ padding: "4px 10px", borderRadius: 6, background: "var(--accent, #111)", color: "#fff", border: "none", fontSize: 12, cursor: "pointer" }}>
                        Fulfil
                      </button>
                      <button onClick={() => { setActioning({ ...o, _action: "cancel" }); setNotes(""); setError(null); }}
                        style={{ padding: "4px 10px", borderRadius: 6, background: "none", color: "#c00", border: "1px solid #c00", fontSize: 12, cursor: "pointer" }}>
                        Cancel
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {actioning && (
        <Modal onClose={() => setActioning(null)} title={actioning._action === "fulfil" ? "Mark as fulfilled" : "Cancel order"}>
          <p style={{ fontSize: 14, marginBottom: 12 }}>
            {actioning._action === "fulfil"
              ? `Mark ${actioning.member_name}'s order for "${actioning.item_name}" as fulfilled?`
              : `Cancel ${actioning.member_name}'s order for "${actioning.item_name}"?`}
          </p>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 5 }}>Notes (optional)</label>
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border, #ddd)", fontSize: 14, boxSizing: "border-box" }}
              placeholder={actioning._action === "fulfil" ? "e.g. Handed out at training" : "e.g. Out of stock"} />
          </div>
          {error && <p style={{ color: "#c00", fontSize: 13, marginBottom: 12 }}>{error}</p>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => setActioning(null)} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border, #ddd)", background: "none", fontSize: 14, cursor: "pointer" }}>Back</button>
            <button onClick={() => handleAction(actioning._action)} disabled={saving}
              style={{
                padding: "8px 20px", borderRadius: 8, border: "none", fontSize: 14, fontWeight: 600,
                cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1,
                background: actioning._action === "fulfil" ? "var(--accent, #111)" : "#c00", color: "#fff",
              }}>
              {saving ? "Saving…" : actioning._action === "fulfil" ? "Confirm fulfilled" : "Confirm cancel"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
