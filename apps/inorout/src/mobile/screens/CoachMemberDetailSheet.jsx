// CoachMemberDetailSheet.jsx — shared coach member-detail bottom-sheet. Self-contained:
// give it a member_profile_id and it fetches the coach's data contract itself via the
// existing clubManagerGetMemberDetail wrapper (club_manager_get_member_detail, mig 306) and
// renders it 1:1 with the desktop coach medical panel (SessionsScreen): DOB/age, medical
// (conditions/allergies/medications/GP/SEND), emergency contact, parent/guardian.
//
// Read-only — clinical fields are edited on the desktop console (DPIA-gated). Renders through
// the shared MobileSheet (portals to #m-sheet-host, clears the docked nav). Consumers:
// TeamManagerPeople (roster), TeamManagerTonight + TeamManagerLeague (availability rows, once
// mig 526 carries member_profile_id in the fixtures roster). Extracted from the People screen
// (#419) so every roster row across the coach track opens the identical sheet.

import { useState, useEffect } from "react";
import { clubManagerGetMemberDetail } from "@platform/core";
import MIcon from "../icons.jsx";
import MobileSheet from "../MobileSheet.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "1990-04-05" → 34 (whole years). Null-safe.
function ageFromDob(dob) {
  if (!dob) return null;
  const [y, m, d] = String(dob).split("-").map(Number);
  if (!y || !m || !d) return null;
  const now = new Date();
  let a = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a -= 1;
  return a >= 0 && a < 130 ? a : null;
}
// "1990-04-05" → "5 Apr 1990". Local parts, no TZ shift.
function fmtDob(dob) {
  if (!dob) return null;
  const [y, m, d] = String(dob).split("-").map(Number);
  if (!y || !m || !d) return null;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
function initials(name) {
  const w = String(name || "?").trim().split(/\s+/).filter(Boolean);
  if (!w.length) return "?";
  return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[w.length - 1][0]).toUpperCase();
}

function DetailRow({ icon, k, v }) {
  if (v == null || v === "") return null;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "11px 0", borderBottom: "1px solid var(--hair)" }}>
      <MIcon name={icon} size={16} color="var(--ink3)" />
      <span style={{ flex: 1, fontSize: 13, color: "var(--ink3)", fontWeight: 600 }}>{k}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", maxWidth: "62%", textAlign: "right", overflowWrap: "anywhere" }}>{v}</span>
    </div>
  );
}

export default function CoachMemberDetailSheet({ memberProfileId, name, hasMedical, onClose }) {
  const [state, setState] = useState({ loading: true, error: false, detail: null });

  useEffect(() => {
    if (!memberProfileId) { setState({ loading: false, error: true, detail: null }); return; }
    let cancelled = false;
    setState({ loading: true, error: false, detail: null });
    clubManagerGetMemberDetail(memberProfileId)
      .then((d) => { if (!cancelled) setState({ loading: false, error: !d, detail: d || null }); })
      .catch(() => { if (!cancelled) setState({ loading: false, error: true, detail: null }); });
    return () => { cancelled = true; };
  }, [memberProfileId]);

  const { loading, error, detail: d } = state;
  const displayName = name || "Player";
  const age = d ? ageFromDob(d.dob) : null;
  const ec1 = d ? [d.ec1_name, d.ec1_relationship, d.ec1_phone].filter(Boolean).join(" · ") : null;
  const guardian = d ? [d.guardian_first_name, d.guardian_last_name, d.guardian_phone].filter(Boolean).join(" ") : null;
  const hasAny = d && (d.medical_conditions || d.allergies || d.medications || d.gp_details || d.send_notes || ec1 || guardian || d.dob);

  return (
    <MobileSheet title="Player" onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 6 }}>
        <span style={{
          width: 52, height: 52, borderRadius: 16, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--s4)", color: "var(--ink3)", fontSize: 18, fontWeight: 800,
        }}>{initials(displayName)}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{displayName}</div>
          <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 1 }}>
            {age != null ? `Age ${age}` : "Squad member"}{hasMedical ? " · has medical notes" : ""}
          </div>
        </div>
      </div>

      {loading && <p style={{ color: "var(--ink3)", fontSize: 14, marginTop: 12 }}>Loading details…</p>}
      {error && <p style={{ color: "var(--ink2)", fontSize: 14, marginTop: 12 }}>Couldn't load this player's details.</p>}

      {d && (
        <div style={{ marginTop: 6 }}>
          <DetailRow icon="calendar" k="Date of birth" v={fmtDob(d.dob)} />
          <DetailRow icon="alert" k="Conditions" v={d.medical_conditions} />
          <DetailRow icon="alert" k="Allergies" v={d.allergies} />
          <DetailRow icon="alert" k="Medication" v={d.medications} />
          <DetailRow icon="info" k="GP" v={d.gp_details} />
          <DetailRow icon="info" k="SEND" v={d.send_notes} />
          <DetailRow icon="phone" k="Emergency contact" v={ec1} />
          <DetailRow icon="users" k="Parent / guardian" v={guardian} />
          {!hasAny && (
            <p style={{ color: "var(--ink3)", fontSize: 13.5, marginTop: 12 }}>No additional details on record for this player.</p>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0 4px", color: "var(--ink4)", fontSize: 12.5 }}>
            <MIcon name="key" size={13} color="var(--ink4)" /> Player details are edited on the desktop console.
          </div>
        </div>
      )}
    </MobileSheet>
  );
}
