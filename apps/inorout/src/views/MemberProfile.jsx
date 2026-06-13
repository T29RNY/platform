import React, { useEffect, useRef, useState } from "react";
import { memberGetSelf, memberUpdateSelf } from "@platform/core/storage/supabase.js";

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

  useEffect(() => {
    let alive = true;
    memberGetSelf()
      .then((r) => {
        if (!alive) return;
        if (r?.found) setProfile(r);
        else setProfile(null);
      })
      .catch((e) => {
        console.error("[member-profile] load failed", e);
        if (alive) setProfile(null);
      });
    return () => { alive = false; };
  }, []);

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
    padding: "0 0 48px",
  };

  if (profile === undefined) return (
    <div style={{ ...wrap, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "var(--t2)" }}>Loading…</p>
    </div>
  );

  // Zero-footprint: casual player with no member_profile — render nothing.
  if (profile === null) return null;

  const displayName = [profile.first_name, profile.last_name].filter(Boolean).join(" ");

  return (
    <div style={wrap}>
      {/* header */}
      <div style={{
        background: "var(--b2)",
        borderBottom: "1px solid var(--border-subtle)",
        padding: "20px 20px 16px",
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

      <div style={{ padding: "20px 20px 0", display: "flex", flexDirection: "column", gap: 24 }}>

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
      </div>
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
