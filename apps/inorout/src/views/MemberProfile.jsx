import React, { useEffect, useRef, useState } from "react";
import { memberGetSelf, memberUpdateSelf, memberListChildren, memberRegisterChild, memberUpdateChild,
         memberGetPendingConsents, memberListConsents, memberAcceptConsent,
         uploadMemberIdDoc, memberSubmitIdDocument, memberListIdDocuments,
         memberListMyPurchases, memberListMyClassBookings, memberGetGradeHistory,
         memberGetFightRecord, signOut } from "@platform/core/storage/supabase.js";
import ClubNavBar from "../components/ui/ClubNavBar.jsx";
import Tour from "../components/Tour.jsx";
import { clubToursEnabled } from "../lib/tourRegistry.js";
import { getDisciplineLabels } from "../lib/disciplineLabels.js";

// Which active club drives discipline-gated surfaces (grade history): honour
// ?club=<id> for a multi-club member, else the first club — mirrors selectedClub.
const pickActiveClub = (clubs) => {
  if (!Array.isArray(clubs) || clubs.length === 0) return null;
  const urlClub = (typeof window !== "undefined") ? new URLSearchParams(window.location.search).get("club") : null;
  return (urlClub ? clubs.find((c) => c.club_id === urlClub) : null) ?? clubs[0] ?? null;
};

// MemberProfile — the member's own account profile at /profile.
// Authenticated gate is enforced by App.jsx before mounting.
// Zero-footprint: renders nothing when no member_profile is linked to this auth account.

const fmtDate = (d) => {
  if (!d) return "";
  try { return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); }
  catch { return d; }
};

const PHOTO_USES = [
  { key: "website",  label: "Club website" },
  { key: "social",   label: "Social media" },
  { key: "press",    label: "Press / media" },
  { key: "marketing",label: "Marketing materials" },
];

export default function MemberProfile({ authUser }) {
  const [profile, setProfile] = useState(undefined); // undefined=loading, null=no profile
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const isSavingRef = useRef(false);

  const [children, setChildren] = useState([]); // child profile summaries
  const [addingChild, setAddingChild] = useState(false);
  const [addChildForm, setAddChildForm] = useState({ first_name: "", last_name: "", dob: "" });
  const [addingChildSaving, setAddingChildSaving] = useState(false);
  const [addChildError, setAddChildError] = useState(null);
  const isAddingChildRef = useRef(false);

  const [expandedChild, setExpandedChild] = useState(null); // uuid of child being edited
  const [childForm, setChildForm] = useState(null);
  const [childSaving, setChildSaving] = useState(false);
  const [childSaveError, setChildSaveError] = useState(null);
  const isChildSavingRef = useRef(false);

  const [pendingConsents, setPendingConsents] = useState([]);
  const [signedConsents,  setSignedConsents]  = useState([]);
  const [signingDoc,      setSigningDoc]      = useState(null);  // pending doc being signed
  const [typedSig,        setTypedSig]        = useState("");
  const [sigError,        setSigError]        = useState(null);
  const [signingSaving,   setSigningSaving]   = useState(false);
  const isSigningRef = useRef(false);

  const [idDocuments,    setIdDocuments]    = useState([]);   // member's own submissions
  const [myOrders,       setMyOrders]       = useState([]);
  const [myClasses,      setMyClasses]      = useState([]);   // class booking history (mig 340)
  const [gradeHistory,   setGradeHistory]   = useState([]);   // belt/grade award log (mig 357, grading disciplines only)
  const [fightRecord,    setFightRecord]    = useState(null); // { record, bouts } (mig 359, boxing only)
  const [idUploadClub,   setIdUploadClub]   = useState(null); // club being uploaded for
  const [idDocType,      setIdDocType]      = useState("passport");
  const [idFile,         setIdFile]         = useState(null);
  const [idUploading,    setIdUploading]    = useState(false);
  const [idUploadError,  setIdUploadError]  = useState(null);
  const isIdUploadingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      memberGetSelf(),
      memberListChildren(),
      memberGetPendingConsents().catch(() => null),
      memberListConsents().catch(() => null),
      memberListIdDocuments().catch(() => null),
      memberListMyPurchases().catch(() => null),
      memberListMyClassBookings().catch(() => null),
    ]).then(([selfResult, childrenResult, pendingResult, signedResult, idDocsResult, ordersResult, classesResult]) => {
      if (!alive) return;
      setProfile(selfResult?.found ? selfResult : null);
      setChildren(childrenResult?.children ?? []);
      setPendingConsents(pendingResult?.pending ?? []);
      setSignedConsents(signedResult?.consents ?? []);
      setIdDocuments(idDocsResult?.documents ?? []);
      setMyOrders(ordersResult?.purchases ?? []);
      setMyClasses(Array.isArray(classesResult) ? classesResult : []);
    }).catch((e) => {
      console.error("[member-profile] load failed", e);
      if (alive) setProfile(null);
    });
    return () => { alive = false; };
  }, []);

  // Belt/grade history for the active grading club (martial-arts only). Keyed on
  // profile so it loads once active_clubs arrives; no-op for non-grading clubs.
  useEffect(() => {
    const club = pickActiveClub(profile?.active_clubs);
    if (!club?.pass_token || !getDisciplineLabels(club.discipline).hasGrading) { setGradeHistory([]); return; }
    let alive = true;
    memberGetGradeHistory(club.pass_token)
      .then((r) => { if (alive) setGradeHistory(r?.history ?? []); })
      .catch(() => { if (alive) setGradeHistory([]); });
    return () => { alive = false; };
  }, [profile]);

  // Fight record for the active boxing club (mig 359). Keyed on profile like the
  // grade history above; no-op for non-fight-record clubs.
  useEffect(() => {
    const club = pickActiveClub(profile?.active_clubs);
    if (!club?.pass_token || !getDisciplineLabels(club.discipline).hasFightRecord) { setFightRecord(null); return; }
    let alive = true;
    memberGetFightRecord(club.pass_token)
      .then((r) => { if (alive) setFightRecord(r?.ok ? r : null); })
      .catch(() => { if (alive) setFightRecord(null); });
    return () => { alive = false; };
  }, [profile]);

  const startEdit = () => {
    setForm({
      first_name:                   profile.first_name ?? "",
      last_name:                    profile.last_name ?? "",
      phone:                        profile.phone ?? "",
      gender:                       profile.gender ?? "",
      address_line1:                profile.address_line1 ?? "",
      address_line2:                profile.address_line2 ?? "",
      address_city:                 profile.address_city ?? "",
      address_postcode:             profile.address_postcode ?? "",
      ec1_name:                     profile.ec1_name ?? "",
      ec1_relationship:             profile.ec1_relationship ?? "",
      ec1_phone:                    profile.ec1_phone ?? "",
      ec2_name:                     profile.ec2_name ?? "",
      ec2_relationship:             profile.ec2_relationship ?? "",
      ec2_phone:                    profile.ec2_phone ?? "",
      send_notes:                   profile.send_notes ?? "",
      dietary_notes:                profile.dietary_notes ?? "",
      consent_emergency_treatment:  profile.consent_emergency_treatment ?? false,
      consent_administer_medication:profile.consent_administer_medication ?? false,
      may_leave_unaccompanied:      profile.may_leave_unaccompanied ?? false,
      authorised_collectors:        profile.authorised_collectors ?? "",
      photo_consent:                profile.photo_consent ?? {},
      medical_conditions:           profile.medical_conditions ?? "",
      allergies:                    profile.allergies ?? "",
      medications:                  profile.medications ?? "",
      gp_details:                   profile.gp_details ?? "",
    });
    setSaveError(null);
    setEditing(true);
  };

  const cancelEdit = () => { setEditing(false); setForm(null); setSaveError(null); };

  const openAddChild = () => {
    setAddChildForm({ first_name: "", last_name: "", dob: "" });
    setAddChildError(null);
    setAddingChild(true);
  };
  const cancelAddChild = () => { setAddingChild(false); setAddChildError(null); };

  const handleAddChild = async () => {
    if (isAddingChildRef.current) return;
    if (!addChildForm.first_name.trim()) { setAddChildError("First name is required."); return; }
    isAddingChildRef.current = true;
    setAddingChildSaving(true);
    setAddChildError(null);
    try {
      await memberRegisterChild({
        first_name: addChildForm.first_name.trim(),
        last_name:  addChildForm.last_name.trim() || null,
        dob:        addChildForm.dob || null,
      });
      const updated = await memberListChildren();
      setChildren(updated?.children ?? []);
      setAddingChild(false);
    } catch (e) {
      console.error("[member-profile] add child failed", e);
      setAddChildError("Couldn't add child — please try again.");
    } finally {
      setAddingChildSaving(false);
      isAddingChildRef.current = false;
    }
  };

  const openEditChild = (child) => {
    setExpandedChild(child.id);
    setChildSaveError(null);
    setChildForm({
      first_name:                    child.first_name ?? "",
      last_name:                     child.last_name ?? "",
      phone:                         child.phone ?? "",
      gender:                        child.gender ?? "",
      address_line1:                 child.address_line1 ?? "",
      address_line2:                 child.address_line2 ?? "",
      address_city:                  child.address_city ?? "",
      address_postcode:              child.address_postcode ?? "",
      ec1_name:                      child.ec1_name ?? "",
      ec1_relationship:              child.ec1_relationship ?? "",
      ec1_phone:                     child.ec1_phone ?? "",
      ec2_name:                      child.ec2_name ?? "",
      ec2_relationship:              child.ec2_relationship ?? "",
      ec2_phone:                     child.ec2_phone ?? "",
      send_notes:                    child.send_notes ?? "",
      dietary_notes:                 child.dietary_notes ?? "",
      consent_emergency_treatment:   child.consent_emergency_treatment ?? false,
      consent_administer_medication: child.consent_administer_medication ?? false,
      may_leave_unaccompanied:       child.may_leave_unaccompanied ?? false,
      authorised_collectors:         child.authorised_collectors ?? "",
      photo_consent:                 child.photo_consent ?? {},
      medical_conditions:            child.medical_conditions ?? "",
      allergies:                     child.allergies ?? "",
      medications:                   child.medications ?? "",
      gp_details:                    child.gp_details ?? "",
    });
  };
  const cancelEditChild = () => { setExpandedChild(null); setChildForm(null); setChildSaveError(null); };
  const setC = (key, val) => setChildForm((f) => ({ ...f, [key]: val }));
  const setChildConsent = (key, val) => setChildForm((f) => ({
    ...f, photo_consent: { ...f.photo_consent, [key]: val },
  }));

  const handleSaveChild = async (childId) => {
    if (isChildSavingRef.current) return;
    isChildSavingRef.current = true;
    setChildSaving(true);
    setChildSaveError(null);
    try {
      const updated = await memberUpdateChild(childId, { ...childForm });
      setChildren((prev) => prev.map((c) => c.id === childId ? { ...c, ...updated } : c));
      setExpandedChild(null);
      setChildForm(null);
    } catch (e) {
      console.error("[member-profile] save child failed", e);
      setChildSaveError("Couldn't save — please try again.");
    } finally {
      setChildSaving(false);
      isChildSavingRef.current = false;
    }
  };

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));
  const setConsent = (key, val) => setForm((f) => ({
    ...f,
    photo_consent: { ...f.photo_consent, [key]: val },
  }));

  const handleSave = async () => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setSaving(true);
    setSaveError(null);
    const updates = { ...form };
    try {
      const updated = await memberUpdateSelf(updates);
      setProfile(updated);
      setEditing(false);
      setForm(null);
    } catch (e) {
      console.error("[member-profile] save failed", e);
      setSaveError("Couldn't save — please try again.");
    } finally {
      setSaving(false);
      isSavingRef.current = false;
    }
  };

  const wrap = {
    minHeight: "100dvh",
    background: "var(--bg)",
    color: "var(--t1)",
    fontFamily: "var(--font-body)",
    // room for the fixed ClubNavBar (multi-context nav, Phase 1)
    padding: "0 0 calc(80px + env(safe-area-inset-bottom,0))",
  };

  if (profile === undefined) return (
    <div style={{ ...wrap, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "var(--t2)" }}>Loading…</p>
    </div>
  );

  // No member_profile (a signed-in user with no club/squad membership reaching
  // /profile) — empty state, NOT a blank page (mirrors SessionsScreen F7 fix).
  if (profile === null) return (
    <div style={{ ...wrap, display: "flex", flexDirection: "column" }}>
      <div style={{
        background: "var(--b2)",
        borderBottom: "1px solid var(--border-subtle)",
        padding: "calc(20px + env(safe-area-inset-top)) 20px 16px",
      }}>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 26, lineHeight: 1 }}>
          Profile
        </div>
      </div>
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", flex: 1, gap: 12, padding: "40px 24px",
        textAlign: "center",
      }}>
        <div style={{ fontSize: 40 }}>👤</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--t1)" }}>
          Nothing here yet
        </div>
        <p style={{
          color: "var(--t2)", fontFamily: "var(--font-body)", fontSize: 14,
          lineHeight: 1.5, maxWidth: 280, margin: 0,
        }}>
          Your profile fills in once you join a club or a squad.
        </p>
        <button
          onClick={async () => { try { await signOut(); } catch (e) { console.error(e); } window.location.replace("/"); }}
          style={{
            marginTop: 8, padding: "12px 22px", borderRadius: "var(--r)",
            background: "transparent", border: "1px solid var(--border-subtle)",
            color: "var(--t2)", fontFamily: "var(--font-body)", fontSize: 14,
            cursor: "pointer", WebkitTapHighlightColor: "transparent",
          }}
        >
          Sign out
        </button>
      </div>
      <ClubNavBar active="profile" />
    </div>
  );

  const displayName = [profile.first_name, profile.last_name].filter(Boolean).join(" ");

  // Honour ?club=<id> so a multi-club member's nav targets the club they arrived
  // from (Pass tab → that club's pass; Sessions tab keeps the selection) rather
  // than always the first club. Falls back to club[0] when no/unknown ?club=, the
  // prior behaviour. (Multi-context nav, Phase 1 bug fix — mirrors SessionsScreen.)
  const _activeClubs = profile.active_clubs ?? [];
  const _urlClub = (typeof window !== "undefined")
    ? new URLSearchParams(window.location.search).get("club")
    : null;
  const selectedClub =
    (_urlClub ? _activeClubs.find((c) => c.club_id === _urlClub) : null)
    ?? _activeClubs[0] ?? null;
  const gradingLabels = getDisciplineLabels(selectedClub?.discipline);

  return (
    <div style={wrap}>
      {/* header */}
      <div style={{
        background: "var(--b2)",
        borderBottom: "1px solid var(--border-subtle)",
        padding: "calc(20px + env(safe-area-inset-top)) 20px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: 26, lineHeight: 1 }}>{displayName}</div>
          <div style={{ color: "var(--t2)", fontSize: 13, marginTop: 4 }}>{profile.email}</div>
        </div>
        {!editing && (
          <button onClick={startEdit} style={btnStyle("var(--amber)", "var(--black)")}>Edit</button>
        )}
      </div>

      <div data-tour="profile-personal" style={{ padding: "20px 20px 0", display: "flex", flexDirection: "column", gap: 24 }}>

        {/* ── Personal ─────────────────────────────────────────────── */}
        <Section title="Personal">
          <ReadRow label="Email" value={profile.email} note="Cannot be changed" />
          {editing ? (
            <>
              <FieldRow label="First name">
                <Input value={form.first_name} onChange={(v) => set("first_name", v)} />
              </FieldRow>
              <FieldRow label="Last name">
                <Input value={form.last_name} onChange={(v) => set("last_name", v)} />
              </FieldRow>
              <FieldRow label="Phone">
                <Input value={form.phone} onChange={(v) => set("phone", v)} type="tel" />
              </FieldRow>
              <FieldRow label="Gender (optional)">
                <Input value={form.gender} onChange={(v) => set("gender", v)} />
              </FieldRow>
            </>
          ) : (
            <>
              {profile.dob    && <ReadRow label="Date of birth" value={fmtDate(profile.dob)} />}
              {profile.phone  && <ReadRow label="Phone" value={profile.phone} />}
              {profile.gender && <ReadRow label="Gender" value={profile.gender} />}
            </>
          )}
        </Section>

        {/* ── Address ──────────────────────────────────────────────── */}
        <Section title="Address">
          {editing ? (
            <>
              <FieldRow label="Address line 1">
                <Input value={form.address_line1} onChange={(v) => set("address_line1", v)} />
              </FieldRow>
              <FieldRow label="Address line 2">
                <Input value={form.address_line2} onChange={(v) => set("address_line2", v)} />
              </FieldRow>
              <FieldRow label="City / town">
                <Input value={form.address_city} onChange={(v) => set("address_city", v)} />
              </FieldRow>
              <FieldRow label="Postcode">
                <Input value={form.address_postcode} onChange={(v) => set("address_postcode", v)} />
              </FieldRow>
            </>
          ) : (
            profile.address_line1
              ? <ReadRow label="Address" value={[
                  profile.address_line1,
                  profile.address_line2,
                  profile.address_city,
                  profile.address_postcode,
                ].filter(Boolean).join(", ")} />
              : <Empty />
          )}
        </Section>

        {/* ── Emergency contacts ───────────────────────────────────── */}
        <Section title="Emergency contacts">
          {editing ? (
            <>
              <SubHead>Contact 1</SubHead>
              <FieldRow label="Name"><Input value={form.ec1_name} onChange={(v) => set("ec1_name", v)} /></FieldRow>
              <FieldRow label="Relationship"><Input value={form.ec1_relationship} onChange={(v) => set("ec1_relationship", v)} /></FieldRow>
              <FieldRow label="Phone"><Input value={form.ec1_phone} onChange={(v) => set("ec1_phone", v)} type="tel" /></FieldRow>
              <SubHead>Contact 2</SubHead>
              <FieldRow label="Name"><Input value={form.ec2_name} onChange={(v) => set("ec2_name", v)} /></FieldRow>
              <FieldRow label="Relationship"><Input value={form.ec2_relationship} onChange={(v) => set("ec2_relationship", v)} /></FieldRow>
              <FieldRow label="Phone"><Input value={form.ec2_phone} onChange={(v) => set("ec2_phone", v)} type="tel" /></FieldRow>
            </>
          ) : (
            <>
              {profile.ec1_name
                ? <ReadRow label={profile.ec1_relationship || "Contact 1"} value={`${profile.ec1_name}${profile.ec1_phone ? " · " + profile.ec1_phone : ""}`} />
                : <Empty />}
              {profile.ec2_name && (
                <ReadRow label={profile.ec2_relationship || "Contact 2"} value={`${profile.ec2_name}${profile.ec2_phone ? " · " + profile.ec2_phone : ""}`} />
              )}
            </>
          )}
        </Section>

        {/* ── Safeguarding ─────────────────────────────────────────── */}
        <Section title="Additional needs & consents">
          {editing ? (
            <>
              <FieldRow label="SEND / additional needs">
                <Textarea value={form.send_notes} onChange={(v) => set("send_notes", v)} placeholder="Any disability, SEND, or additional needs and reasonable adjustments" />
              </FieldRow>
              <FieldRow label="Dietary requirements">
                <Textarea value={form.dietary_notes} onChange={(v) => set("dietary_notes", v)} placeholder="Any dietary requirements or allergies" />
              </FieldRow>
              <CheckRow
                label="Consent to emergency medical treatment (if parent / guardian cannot be reached)"
                checked={form.consent_emergency_treatment}
                onChange={(v) => set("consent_emergency_treatment", v)}
              />
              <CheckRow
                label="Consent to administer prescribed medication if needed"
                checked={form.consent_administer_medication}
                onChange={(v) => set("consent_administer_medication", v)}
              />
              <CheckRow
                label="Can leave the session unaccompanied"
                checked={form.may_leave_unaccompanied}
                onChange={(v) => set("may_leave_unaccompanied", v)}
              />
              <FieldRow label="Authorised collectors (if different from guardian)">
                <Textarea value={form.authorised_collectors} onChange={(v) => set("authorised_collectors", v)} placeholder="Names of people authorised to collect" />
              </FieldRow>
            </>
          ) : (
            <>
              {profile.send_notes && <ReadRow label="SEND / additional needs" value={profile.send_notes} />}
              {profile.dietary_notes && <ReadRow label="Dietary" value={profile.dietary_notes} />}
              <ReadRow label="Emergency medical consent" value={profile.consent_emergency_treatment ? "Yes" : "No"} />
              <ReadRow label="Medication consent" value={profile.consent_administer_medication ? "Yes" : "No"} />
              <ReadRow label="May leave unaccompanied" value={profile.may_leave_unaccompanied ? "Yes" : "No"} />
              {profile.authorised_collectors && <ReadRow label="Authorised collectors" value={profile.authorised_collectors} />}
            </>
          )}
        </Section>

        {/* ── Photo consent ────────────────────────────────────────── */}
        <Section title="Photo & image consent">
          {editing ? (
            PHOTO_USES.map(({ key, label }) => (
              <CheckRow
                key={key}
                label={label}
                checked={!!(form.photo_consent?.[key])}
                onChange={(v) => setConsent(key, v)}
              />
            ))
          ) : (
            PHOTO_USES.map(({ key, label }) => (
              <ReadRow key={key} label={label} value={(profile.photo_consent?.[key]) ? "Consented" : "Not consented"} />
            ))
          )}
        </Section>

        {/* ── Medical (special-category) ───────────────────────────── */}
        <Section title="Medical information">
          <div style={{ fontSize: 12, color: "var(--t2)", marginBottom: 12, lineHeight: 1.5 }}>
            Special-category data. Access is audit-logged.
          </div>
          {editing ? (
            <>
              <FieldRow label="Medical conditions">
                <Textarea value={form.medical_conditions} onChange={(v) => set("medical_conditions", v)} />
              </FieldRow>
              <FieldRow label="Allergies">
                <Textarea value={form.allergies} onChange={(v) => set("allergies", v)} />
              </FieldRow>
              <FieldRow label="Current medications">
                <Textarea value={form.medications} onChange={(v) => set("medications", v)} />
              </FieldRow>
              <FieldRow label="GP name & surgery">
                <Textarea value={form.gp_details} onChange={(v) => set("gp_details", v)} />
              </FieldRow>
            </>
          ) : (
            <>
              {profile.medical_conditions && <ReadRow label="Conditions" value={profile.medical_conditions} />}
              {profile.allergies && <ReadRow label="Allergies" value={profile.allergies} />}
              {profile.medications && <ReadRow label="Medications" value={profile.medications} />}
              {profile.gp_details && <ReadRow label="GP" value={profile.gp_details} />}
              {!profile.medical_conditions && !profile.allergies && !profile.medications && !profile.gp_details && <Empty />}
            </>
          )}
        </Section>

        {/* ── My children ──────────────────────────────────────────── */}
        {profile && (
          <div>
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
              color: "var(--t2)", marginBottom: 12,
            }}>My children</div>

            {children.map((child) => {
              const childName = [child.first_name, child.last_name].filter(Boolean).join(" ");
              const isExpanded = expandedChild === child.id;
              return (
                <div key={child.id} style={{
                  background: "var(--b2)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--r)",
                  overflow: "hidden",
                  marginBottom: 10,
                }}>
                  <div style={{
                    padding: "14px",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                  }}>
                    <div>
                      <div style={{ fontFamily: "var(--font-display)", fontSize: 18 }}>{childName}</div>
                      {child.dob && (
                        <div style={{ fontSize: 13, color: "var(--t2)", marginTop: 2 }}>
                          DOB: {fmtDate(child.dob)}
                        </div>
                      )}
                    </div>
                    {!isExpanded && (
                      <button onClick={() => openEditChild(child)} style={btnStyle("var(--b3)", "var(--t1)")}>
                        Edit
                      </button>
                    )}
                  </div>

                  {isExpanded && childForm && (
                    <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "0 14px 14px" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 0, marginTop: 12 }}>

                        <SubHead>Personal</SubHead>
                        <FieldRow label="First name">
                          <Input value={childForm.first_name} onChange={(v) => setC("first_name", v)} />
                        </FieldRow>
                        <FieldRow label="Last name">
                          <Input value={childForm.last_name} onChange={(v) => setC("last_name", v)} />
                        </FieldRow>
                        <FieldRow label="Phone (optional)">
                          <Input value={childForm.phone} onChange={(v) => setC("phone", v)} type="tel" />
                        </FieldRow>
                        <FieldRow label="Gender (optional)">
                          <Input value={childForm.gender} onChange={(v) => setC("gender", v)} />
                        </FieldRow>

                        <SubHead>Emergency contacts</SubHead>
                        <FieldRow label="Contact 1 — name">
                          <Input value={childForm.ec1_name} onChange={(v) => setC("ec1_name", v)} />
                        </FieldRow>
                        <FieldRow label="Contact 1 — relationship">
                          <Input value={childForm.ec1_relationship} onChange={(v) => setC("ec1_relationship", v)} />
                        </FieldRow>
                        <FieldRow label="Contact 1 — phone">
                          <Input value={childForm.ec1_phone} onChange={(v) => setC("ec1_phone", v)} type="tel" />
                        </FieldRow>
                        <FieldRow label="Contact 2 — name">
                          <Input value={childForm.ec2_name} onChange={(v) => setC("ec2_name", v)} />
                        </FieldRow>
                        <FieldRow label="Contact 2 — relationship">
                          <Input value={childForm.ec2_relationship} onChange={(v) => setC("ec2_relationship", v)} />
                        </FieldRow>
                        <FieldRow label="Contact 2 — phone">
                          <Input value={childForm.ec2_phone} onChange={(v) => setC("ec2_phone", v)} type="tel" />
                        </FieldRow>

                        <SubHead>Additional needs & consents</SubHead>
                        <FieldRow label="SEND / additional needs">
                          <Textarea value={childForm.send_notes} onChange={(v) => setC("send_notes", v)} placeholder="Any disability, SEND, or additional needs" />
                        </FieldRow>
                        <FieldRow label="Dietary requirements">
                          <Textarea value={childForm.dietary_notes} onChange={(v) => setC("dietary_notes", v)} />
                        </FieldRow>
                        <CheckRow
                          label="Consent to emergency medical treatment"
                          checked={childForm.consent_emergency_treatment}
                          onChange={(v) => setC("consent_emergency_treatment", v)}
                        />
                        <CheckRow
                          label="Consent to administer prescribed medication"
                          checked={childForm.consent_administer_medication}
                          onChange={(v) => setC("consent_administer_medication", v)}
                        />
                        <CheckRow
                          label="Can leave the session unaccompanied"
                          checked={childForm.may_leave_unaccompanied}
                          onChange={(v) => setC("may_leave_unaccompanied", v)}
                        />
                        <FieldRow label="Authorised collectors">
                          <Textarea value={childForm.authorised_collectors} onChange={(v) => setC("authorised_collectors", v)} placeholder="Names of people authorised to collect" />
                        </FieldRow>

                        <SubHead>Photo & image consent</SubHead>
                        {PHOTO_USES.map(({ key, label }) => (
                          <CheckRow
                            key={key}
                            label={label}
                            checked={!!(childForm.photo_consent?.[key])}
                            onChange={(v) => setChildConsent(key, v)}
                          />
                        ))}

                        <SubHead>Medical information</SubHead>
                        <div style={{ padding: "8px 14px 4px", fontSize: 12, color: "var(--t2)" }}>
                          Special-category data. Access is audit-logged.
                        </div>
                        <FieldRow label="Medical conditions">
                          <Textarea value={childForm.medical_conditions} onChange={(v) => setC("medical_conditions", v)} />
                        </FieldRow>
                        <FieldRow label="Allergies">
                          <Textarea value={childForm.allergies} onChange={(v) => setC("allergies", v)} />
                        </FieldRow>
                        <FieldRow label="Current medications">
                          <Textarea value={childForm.medications} onChange={(v) => setC("medications", v)} />
                        </FieldRow>
                        <FieldRow label="GP name & surgery">
                          <Textarea value={childForm.gp_details} onChange={(v) => setC("gp_details", v)} />
                        </FieldRow>
                      </div>

                      {childSaveError && (
                        <div style={{ color: "var(--red)", fontSize: 13, textAlign: "center", marginTop: 10 }}>
                          {childSaveError}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                        <button
                          onClick={() => handleSaveChild(child.id)}
                          disabled={childSaving}
                          style={{ ...btnStyle("var(--amber)", "var(--black)"), flex: 1, padding: "12px 0" }}
                        >
                          {childSaving ? "Saving…" : "Save"}
                        </button>
                        <button
                          onClick={cancelEditChild}
                          disabled={childSaving}
                          style={{ ...btnStyle("transparent", "var(--t2)", false, "1px solid var(--border-subtle)"), flex: 1, padding: "12px 0" }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {addingChild ? (
              <div style={{
                background: "var(--b2)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--r)",
                overflow: "hidden",
                marginBottom: 10,
              }}>
                <div style={{ padding: "14px", fontWeight: 700, fontSize: 14 }}>Add a child</div>
                <FieldRow label="First name *">
                  <Input value={addChildForm.first_name} onChange={(v) => setAddChildForm((f) => ({ ...f, first_name: v }))} />
                </FieldRow>
                <FieldRow label="Last name">
                  <Input value={addChildForm.last_name} onChange={(v) => setAddChildForm((f) => ({ ...f, last_name: v }))} />
                </FieldRow>
                <FieldRow label="Date of birth">
                  <Input value={addChildForm.dob} onChange={(v) => setAddChildForm((f) => ({ ...f, dob: v }))} type="date" />
                </FieldRow>
                {addChildError && (
                  <div style={{ padding: "0 14px 8px", color: "var(--red)", fontSize: 13 }}>{addChildError}</div>
                )}
                <div style={{ display: "flex", gap: 10, padding: "8px 14px 14px" }}>
                  <button
                    onClick={handleAddChild}
                    disabled={addingChildSaving}
                    style={{ ...btnStyle("var(--amber)", "var(--black)"), flex: 1, padding: "12px 0" }}
                  >
                    {addingChildSaving ? "Adding…" : "Add child"}
                  </button>
                  <button
                    onClick={cancelAddChild}
                    disabled={addingChildSaving}
                    style={{ ...btnStyle("transparent", "var(--t2)", false, "1px solid var(--border-subtle)"), flex: 1, padding: "12px 0" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              !editing && (
                <button onClick={openAddChild} style={{
                  width: "100%", padding: "12px 0",
                  background: "var(--b2)", border: "1px dashed var(--border)",
                  borderRadius: "var(--r)", color: "var(--t2)",
                  fontSize: 14, fontFamily: "var(--font-body)", cursor: "pointer",
                }}>
                  + Add a child
                </button>
              )
            )}
          </div>
        )}

        {/* ── ID & age verification ────────────────────────────────── */}
        {profile?.id_mandate_clubs?.length > 0 && !editing && (
          <Section title="ID & age verification">
            {profile.id_mandate_clubs.map((club) => {
              const latestDoc = idDocuments.find((d) => d.club_id === club.club_id);
              const isApproved = latestDoc?.status === "approved";
              const isPending  = latestDoc?.status === "pending";
              const isRejected = latestDoc?.status === "rejected";
              const uploadingThis = idUploadClub === club.club_id && idUploading;

              return (
                <div key={club.club_id} style={{
                  padding: "12px 14px",
                  borderBottom: "1px solid var(--border-subtle)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{club.club_name}</div>
                    {isApproved && (
                      <span style={{ fontSize: 12, color: "var(--green, #4caf50)", fontWeight: 600 }}>✓ Verified</span>
                    )}
                    {isPending && (
                      <span style={{ fontSize: 12, color: "var(--t2)" }}>Pending review</span>
                    )}
                    {isRejected && (
                      <span style={{ fontSize: 12, color: "var(--red, #f44336)" }}>Rejected</span>
                    )}
                  </div>

                  {isRejected && latestDoc.rejection_reason && (
                    <div style={{ fontSize: 12, color: "var(--red, #f44336)", marginBottom: 8 }}>
                      {latestDoc.rejection_reason}
                    </div>
                  )}

                  {!isApproved && !isPending && (
                    <div style={{ fontSize: 12, color: "var(--t2)", marginBottom: 10 }}>
                      {isRejected ? "Please upload a new document." : "Upload a photo or scan of your ID to complete registration."}
                    </div>
                  )}

                  {!isApproved && !isPending && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <select
                        value={idUploadClub === club.club_id ? idDocType : "passport"}
                        onChange={(e) => { setIdUploadClub(club.club_id); setIdDocType(e.target.value); }}
                        style={{
                          padding: "8px 10px", borderRadius: "var(--r)",
                          border: "1px solid var(--border)", background: "var(--b1)",
                          color: "var(--t1)", fontSize: 13, fontFamily: "var(--font-body)",
                        }}
                      >
                        <option value="passport">Passport</option>
                        <option value="driving_licence">Driving licence</option>
                        <option value="pass_card">PASS card</option>
                        <option value="birth_certificate">Birth certificate</option>
                      </select>

                      <label style={{
                        display: "block", padding: "10px 14px", textAlign: "center",
                        border: "1px dashed var(--border)", borderRadius: "var(--r)",
                        fontSize: 13, color: "var(--t2)", cursor: "pointer",
                      }}>
                        {idUploadClub === club.club_id && idFile
                          ? idFile.name
                          : "Choose file (JPG, PNG, PDF — max 10 MB)"}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,application/pdf"
                          style={{ display: "none" }}
                          onChange={(e) => {
                            setIdUploadClub(club.club_id);
                            setIdFile(e.target.files[0] ?? null);
                            setIdUploadError(null);
                          }}
                        />
                      </label>

                      {idUploadError && idUploadClub === club.club_id && (
                        <div style={{ fontSize: 12, color: "var(--red, #f44336)" }}>{idUploadError}</div>
                      )}

                      <button
                        disabled={uploadingThis || idUploadClub !== club.club_id || !idFile}
                        onClick={async () => {
                          if (isIdUploadingRef.current) return;
                          if (!idFile) return;
                          isIdUploadingRef.current = true;
                          setIdUploading(true); setIdUploadError(null);
                          try {
                            const path = await uploadMemberIdDoc(profile.id, idFile);
                            await memberSubmitIdDocument(club.club_id, idDocType, path);
                            const result = await memberListIdDocuments();
                            setIdDocuments(result?.documents ?? []);
                            setIdFile(null); setIdUploadClub(null);
                          } catch (e) {
                            console.error("[member-profile] id upload failed", e);
                            setIdUploadError("Upload failed — please try again.");
                          } finally { setIdUploading(false); isIdUploadingRef.current = false; }
                        }}
                        style={btnStyle(
                          idUploadClub === club.club_id && idFile ? "var(--amber)" : "var(--border)",
                          "var(--black)", true
                        )}
                      >
                        {uploadingThis ? "Uploading…" : "Submit document"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </Section>
        )}

        {/* ── Consents ─────────────────────────────────────────────── */}
        {(pendingConsents.length > 0 || signedConsents.length > 0) && !editing && (
          <Section title={pendingConsents.length > 0 ? `Consents · ${pendingConsents.length} action required` : "Consents"}>
            {pendingConsents.map((doc) => (
              <div key={`${doc.document_id}:${doc.for_profile_id}`} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "12px 14px", borderBottom: "1px solid var(--border-subtle)",
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{doc.title}</div>
                  <div style={{ fontSize: 12, color: "var(--t2)", marginTop: 2 }}>
                    {doc.club_name}{doc.for_profile_id !== profile.member_profile_id ? ` · for ${doc.for_name}` : ""}
                    {" · "}v{doc.version}
                  </div>
                </div>
                <button
                  onClick={() => { setSigningDoc(doc); setTypedSig(""); setSigError(null); }}
                  style={{ ...btnStyle("var(--amber)", "var(--black)"), padding: "8px 14px", fontSize: 13, flexShrink: 0 }}
                >
                  Sign
                </button>
              </div>
            ))}
            {signedConsents.map((ca) => (
              <div key={ca.acceptance_id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "12px 14px", borderBottom: "1px solid var(--border-subtle)",
              }}>
                <div>
                  <div style={{ fontSize: 14 }}>{ca.title}</div>
                  <div style={{ fontSize: 12, color: "var(--t2)", marginTop: 2 }}>
                    {ca.club_name}
                    {ca.for_profile_id !== profile.member_profile_id ? ` · for ${ca.for_name}` : ""}
                    {" · "}v{ca.version}{!ca.is_current ? " (outdated)" : ""}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "var(--t2)", flexShrink: 0 }}>
                  ✓ Signed {new Date(ca.accepted_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </div>
              </div>
            ))}
          </Section>
        )}

        {/* Consent signing modal */}
        {signingDoc && (
          <ConsentModal
            doc={signingDoc}
            typedSig={typedSig}
            onSigChange={setTypedSig}
            error={sigError}
            saving={signingSaving}
            onClose={() => setSigningDoc(null)}
            onSign={async () => {
              if (isSigningRef.current) return;
              if (!typedSig.trim()) { setSigError("Please type your full name."); return; }
              isSigningRef.current = true;
              setSigningSaving(true); setSigError(null);
              try {
                const onBehalf = signingDoc.for_profile_id !== profile.member_profile_id ? signingDoc.for_profile_id : null;
                await memberAcceptConsent(signingDoc.document_id, typedSig.trim(), { onBehalfOfProfileId: onBehalf });
                const [p, s] = await Promise.all([memberGetPendingConsents(), memberListConsents()]);
                setPendingConsents(p?.pending ?? []);
                setSignedConsents(s?.consents ?? []);
                setSigningDoc(null);
              } catch (e) {
                console.error("[member-profile] sign consent failed", e);
                setSigError("Couldn't save — please try again.");
              } finally { setSigningSaving(false); isSigningRef.current = false; }
            }}
          />
        )}

        {/* ── My orders ───────────────────────────────────────────── */}
        {myOrders.length > 0 && (
          <Section title="My orders">
            {myOrders.map((o, i) => (
              <div key={o.id} style={{
                padding: "10px 0",
                borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none",
                display: "flex", alignItems: "flex-start", gap: 12,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--t1)" }}>{o.item_name}</div>
                  <div style={{ fontSize: 12, color: "var(--t2)", marginTop: 2 }}>
                    Qty {o.quantity} · £{((o.total_pence || 0) / 100).toFixed(2)}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--t3, #666)", marginTop: 3 }}>{fmtDate(o.created_at)}</div>
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                  background: o.status === "fulfilled" ? "rgba(76,175,80,0.15)" : o.status === "cancelled" ? "rgba(255,255,255,0.06)" : "rgba(255,190,60,0.15)",
                  color: o.status === "fulfilled" ? "rgba(76,175,80,1)" : o.status === "cancelled" ? "var(--t2)" : "var(--amber)",
                }}>
                  {o.status === "pending_payment" ? "Pending" : o.status === "fulfilled" ? "Fulfilled" : o.status === "cancelled" ? "Cancelled" : o.status}
                </span>
              </div>
            ))}
          </Section>
        )}

        {/* ── Progression (belts / grades, mig 357 — grading clubs only) ── */}
        {gradingLabels.hasGrading && gradeHistory.length > 0 && (
          <Section title="Progression">
            {gradeHistory.map((g, i) => (
              <div key={g.award_id} style={{
                padding: "10px 0",
                borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none",
                display: "flex", alignItems: "center", gap: 12,
              }}>
                <span style={{ width: 22, height: 22, borderRadius: 5, background: g.colour_hex || "var(--t2)", border: "1px solid var(--border-subtle)", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--t1)" }}>
                    {g.grade_name}{g.stripes > 0 ? ` · ${g.stripes} stripe${g.stripes === 1 ? "" : "s"}` : ""}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--t2)", marginTop: 2 }}>
                    {g.scheme_name}{g.note ? ` · ${g.note}` : ""}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--t3, #666)", marginTop: 3 }}>{fmtDate(g.awarded_at)}</div>
                </div>
                {i === 0 && <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "rgba(76,175,80,0.15)", color: "rgba(76,175,80,1)" }}>Current</span>}
              </div>
            ))}
          </Section>
        )}

        {/* ── Fight record (bouts, mig 359 — boxing clubs only) ── */}
        {gradingLabels.hasFightRecord && fightRecord && (
          <Section title="Fight record">
            <div style={{ display: "flex", gap: 14, padding: "4px 0 12px", flexWrap: "wrap" }}>
              {[["W", fightRecord.record?.wins, "rgba(76,175,80,1)"],
                ["L", fightRecord.record?.losses, "#FF6060"],
                ["D", fightRecord.record?.draws, "var(--t2)"],
                ...(fightRecord.record?.no_contests ? [["NC", fightRecord.record.no_contests, "var(--t2)"]] : [])
              ].map(([k, v, col]) => (
                <div key={k} style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 30, lineHeight: 1, color: col }}>{v || 0}</div>
                  <div style={{ fontSize: 11, color: "var(--t3, #666)", marginTop: 2 }}>{k}</div>
                </div>
              ))}
              {fightRecord.record?.sparring_count > 0 && (
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 30, lineHeight: 1, color: "var(--t2)" }}>{fightRecord.record.sparring_count}</div>
                  <div style={{ fontSize: 11, color: "var(--t3, #666)", marginTop: 2 }}>Sparring</div>
                </div>
              )}
            </div>
            {(fightRecord.bouts || []).map((b, i) => {
              const tone = b.result === "win" ? { bg: "rgba(76,175,80,0.15)", fg: "rgba(76,175,80,1)" }
                : b.result === "loss" ? { bg: "rgba(255,96,96,0.15)", fg: "#FF6060" }
                : { bg: "rgba(255,255,255,0.06)", fg: "var(--t2)" };
              const label = b.is_sparring ? "Sparring" : b.result === "win" ? "Win" : b.result === "loss" ? "Loss" : b.result === "draw" ? "Draw" : "NC";
              return (
                <div key={b.bout_id} style={{
                  padding: "10px 0",
                  borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none",
                  display: "flex", alignItems: "flex-start", gap: 12,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--t1)" }}>{b.opponent_name || "Opponent —"}</div>
                    <div style={{ fontSize: 12, color: "var(--t2)", marginTop: 2 }}>
                      {b.event_name || ""}{b.method ? `${b.event_name ? " · " : ""}${b.method}` : ""}{b.rounds != null ? ` · ${b.rounds}r` : ""}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--t3, #666)", marginTop: 3 }}>{fmtDate(b.bout_date)}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: tone.bg, color: tone.fg }}>{label}</span>
                </div>
              );
            })}
          </Section>
        )}

        {/* ── My class history (mig 340) ───────────────────────────── */}
        {myClasses.length > 0 && (
          <Section title="My class history">
            {myClasses.map((b, i) => {
              const label = b.status === "confirmed" ? (b.is_upcoming ? "Booked" : "Attended")
                : b.status === "waitlist" ? "Waitlisted"
                : b.status === "no_show" ? "Missed"
                : "Cancelled";
              const tone = b.status === "confirmed" ? { bg: "rgba(76,175,80,0.15)", fg: "rgba(76,175,80,1)" }
                : b.status === "waitlist" ? { bg: "rgba(96,160,255,0.15)", fg: "#60A0FF" }
                : b.status === "no_show" ? { bg: "rgba(255,96,96,0.15)", fg: "#FF6060" }
                : { bg: "rgba(255,255,255,0.06)", fg: "var(--t2)" };
              return (
                <div key={b.booking_id} style={{
                  padding: "10px 0",
                  borderTop: i > 0 ? "1px solid var(--border-subtle)" : "none",
                  display: "flex", alignItems: "flex-start", gap: 12,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--t1)" }}>{b.class_name}</div>
                    <div style={{ fontSize: 12, color: "var(--t2)", marginTop: 2 }}>
                      {b.venue_name}{b.space_name ? ` · ${b.space_name}` : ""}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--t3, #666)", marginTop: 3 }}>{fmtDate(b.starts_at)}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: tone.bg, color: tone.fg }}>
                    {label}
                  </span>
                </div>
              );
            })}
          </Section>
        )}

        {/* ── Save / cancel ────────────────────────────────────────── */}
        {editing && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingBottom: 8 }}>
            {saveError && (
              <div style={{ color: "var(--red)", fontSize: 13, textAlign: "center" }}>{saveError}</div>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              style={btnStyle("var(--amber)", "var(--black)", true)}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button
              onClick={cancelEdit}
              disabled={saving}
              style={btnStyle("transparent", "var(--t2)", true, "1px solid var(--border-subtle)")}
            >
              Cancel
            </button>
          </div>
        )}

        {/* ── Account ───────────────────────────────────────────────── */}
        <div style={{ marginTop: 28, paddingTop: 16, borderTop: "1px solid var(--border-subtle)", display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            onClick={async () => { try { await signOut(); } catch (e) { console.error(e); } window.location.replace("/"); }}
            style={btnStyle("transparent", "var(--t2)", true, "1px solid var(--border-subtle)")}
          >
            Sign out
          </button>
        </div>
      </div>
      <Tour tourKey="io_tour_club_profile" enabled={clubToursEnabled()} />
      <ClubNavBar active="profile" passToken={selectedClub?.pass_token ?? null} clubEntry={selectedClub} />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
        color: "var(--t2)", marginBottom: 12,
      }}>{title}</div>
      <div style={{
        background: "var(--b2)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--r)",
        overflow: "hidden",
      }}>
        {children}
      </div>
    </div>
  );
}

function SubHead({ children }) {
  return (
    <div style={{
      padding: "10px 14px 4px",
      fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
      color: "var(--t2)", textTransform: "uppercase",
      borderTop: "1px solid var(--border-subtle)",
    }}>{children}</div>
  );
}

function ReadRow({ label, value, note }) {
  return (
    <div style={{
      padding: "12px 14px",
      borderBottom: "1px solid var(--border-subtle)",
      display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12,
    }}>
      <span style={{ color: "var(--t2)", fontSize: 14, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 14, textAlign: "right", wordBreak: "break-word" }}>
        {value ?? <span style={{ color: "var(--t2)" }}>—</span>}
        {note && <span style={{ display: "block", fontSize: 11, color: "var(--t2)", marginTop: 2 }}>{note}</span>}
      </span>
    </div>
  );
}

function FieldRow({ label, children }) {
  return (
    <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-subtle)" }}>
      <div style={{ fontSize: 11, color: "var(--t2)", marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function Input({ value, onChange, type = "text" }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%", boxSizing: "border-box",
        background: "var(--bg)", border: "1px solid var(--border)",
        borderRadius: "var(--r-button)", padding: "8px 10px",
        color: "var(--t1)", fontSize: 14, fontFamily: "var(--font-body)",
        outline: "none",
      }}
    />
  );
}

function Textarea({ value, onChange, placeholder }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={3}
      style={{
        width: "100%", boxSizing: "border-box",
        background: "var(--bg)", border: "1px solid var(--border)",
        borderRadius: "var(--r-button)", padding: "8px 10px",
        color: "var(--t1)", fontSize: 14, fontFamily: "var(--font-body)",
        outline: "none", resize: "vertical",
      }}
    />
  );
}

function CheckRow({ label, checked, onChange }) {
  return (
    <label style={{
      display: "flex", alignItems: "flex-start", gap: 10,
      padding: "12px 14px", borderBottom: "1px solid var(--border-subtle)",
      cursor: "pointer",
    }}>
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 2, flexShrink: 0, accentColor: "var(--amber)" }}
      />
      <span style={{ fontSize: 14, lineHeight: 1.4 }}>{label}</span>
    </label>
  );
}

function Empty() {
  return (
    <div style={{ padding: "14px", color: "var(--t2)", fontSize: 13 }}>Not provided</div>
  );
}

function btnStyle(bg, color, full = false, border = "none") {
  return {
    background: bg, color, border,
    borderRadius: "var(--r-button)",
    padding: "10px 18px",
    fontSize: 14, fontWeight: 700,
    fontFamily: "var(--font-body)",
    cursor: "pointer",
    ...(full ? { width: "100%", padding: "14px 0" } : {}),
  };
}

// ── ConsentModal ──────────────────────────────────────────────────────────────
// Scrollable document viewer + typed signature + agree button.
function ConsentModal({ doc, typedSig, onSigChange, error, saving, onClose, onSign }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-end",
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        width: "100%", maxHeight: "90vh",
        background: "var(--b1)", borderRadius: "var(--r) var(--r) 0 0",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0,
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{doc.title}</div>
            <div style={{ fontSize: 12, color: "var(--t2)", marginTop: 2 }}>
              {doc.club_name} · v{doc.version}
              {doc.for_name ? ` · for ${doc.for_name}` : ""}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "none", fontSize: 22, color: "var(--t2)",
            cursor: "pointer", padding: "0 4px", lineHeight: 1,
          }}>×</button>
        </div>

        {/* body — scrollable */}
        <div style={{
          flex: 1, overflowY: "auto", padding: "16px 20px",
          fontSize: 14, lineHeight: 1.6, color: "var(--t1)",
          whiteSpace: "pre-wrap",
        }}>
          {doc.body}
        </div>

        {/* sign area */}
        <div style={{
          padding: "16px 20px 24px", borderTop: "1px solid var(--border-subtle)", flexShrink: 0,
        }}>
          <div style={{ fontSize: 13, color: "var(--t2)", marginBottom: 10 }}>
            Type your full name below to confirm you have read and agree to this document.
          </div>
          <input
            className="input"
            placeholder="Your full name"
            value={typedSig}
            onChange={(e) => onSigChange(e.target.value)}
            style={{ marginBottom: 10 }}
            autoComplete="name"
          />
          {error && <div style={{ fontSize: 13, color: "var(--red)", marginBottom: 8 }}>{error}</div>}
          <button
            onClick={onSign}
            disabled={saving}
            style={btnStyle("var(--amber)", "var(--black)", true)}
          >
            {saving ? "Saving…" : "I agree — sign document"}
          </button>
        </div>
      </div>
    </div>
  );
}
