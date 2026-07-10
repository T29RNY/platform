// CoachDbsSheet.jsx — shared coach-DBS detail + ADD/UPDATE editor, opened by tapping a
// coach row on ClubAdminSafeguarding (the DBS board) or ClubAdminToday (the "Needs you"
// DBS list). One component, one contract, so both surfaces write identically.
//
// Mirrors the desktop DBS modal (apps/venue/src/views/MembershipsView.jsx DbsModal) 1:1:
// same fields (check type / status / certificate number / issued + expiry dates / notes),
// same enums, same venue-token write venueUpsertStaffDbs → venue_upsert_staff_dbs
// (keyed by member_profile_id + club_id). No new backend. An upsert, so it both ADDS a
// first DBS for a "No DBS" coach and UPDATES an existing one — exactly like the desktop.
//
// Certificate number opens blank on every edit (as the desktop does): venue_list_club_staff
// never returns the cert number (only status + expiry), so it can't be pre-filled — you
// re-enter it when you change it. Uses the shared (portaled) MobileSheet with a pinned
// footer so the Save button clears the docked nav.

import { useState, useRef } from "react";
import { venueUpsertStaffDbs } from "@platform/core";
import MIcon from "../icons.jsx";
import MobileSheet from "../MobileSheet.jsx";

const cap = (s) => { const t = String(s || "").trim(); return t ? t[0].toUpperCase() + t.slice(1) : ""; };
const ROLE_LABEL = {
  manager: "Manager", assistant_manager: "Assistant manager", coach: "Coach",
  head_coach: "Head coach", assistant: "Assistant coach", assistant_coach: "Assistant coach",
  physio: "Physio", other: "Coach",
};
const roleLabel = (r) => ROLE_LABEL[String(r || "").toLowerCase()] || cap(r) || "Coach";

// Desktop DbsModal option sets, verbatim (MembershipsView.jsx:2935-2947 + DBS_STATUS_BADGE).
const CHECK_TYPES = [["basic", "Basic"], ["standard", "Standard"], ["enhanced", "Enhanced"], ["enhanced_barred", "Enhanced + barred list"]];
const STATUSES = [["pending", "Pending"], ["valid", "Valid"], ["expired", "Expired"], ["withdrawn", "Withdrawn"]];

const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: "var(--r-sm)",
  border: "1px solid var(--hair)", background: "var(--s3)", color: "var(--ink)",
  fontFamily: "var(--m-font)", fontSize: 14, marginTop: 4,
};
const labelStyle = { display: "block", fontSize: 12, color: "var(--ink3)", marginTop: 16 };

// coach = { name, sev:{tone,label}, teams:[...], role, youth, memberProfileId, status (raw), checkType, expiry }
export default function CoachDbsSheet({ coach, venueToken, clubId, toast, onClose, onSaved }) {
  const c = coach || {};
  const tone = c.sev?.tone;
  const soft = tone === "crit" ? "var(--live-soft)" : tone === "warn" ? "var(--amber-soft)" : "var(--ok-soft)";
  const ink = tone === "crit" ? "var(--live)" : tone === "warn" ? "var(--amber)" : "var(--ok)";

  const [checkType, setCheckType] = useState(c.checkType || "enhanced");
  const [status, setStatus] = useState(c.status || "pending");
  const [certNum, setCertNum] = useState("");
  const [issued, setIssued] = useState("");
  const [expiry, setExpiry] = useState(c.expiry ? String(c.expiry).slice(0, 10) : "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);

  const canWrite = !!c.memberProfileId && !!venueToken && !!clubId;

  const save = async () => {
    if (savingRef.current) return;
    if (!canWrite) { toast?.({ icon: "alert", text: "Can’t update this coach’s DBS here" }); return; }
    savingRef.current = true; setBusy(true);
    try {
      await venueUpsertStaffDbs(venueToken, c.memberProfileId, clubId, {
        checkType,
        status,
        certificateNumber: certNum.trim() || null,
        issuedDate: issued || null,
        expiryDate: expiry || null,
        notes: notes.trim() || null,
      });
      toast?.({ icon: "check", text: "DBS record saved" });
      onSaved();
    } catch (err) {
      console.error("[dbs] venue_upsert_staff_dbs failed", err);
      toast?.({ icon: "alert", text: "Couldn’t save the DBS record — try again" });
      savingRef.current = false; setBusy(false);
    }
  };

  return (
    <MobileSheet
      title="Coach DBS"
      onClose={onClose}
      footer={canWrite ? (
        <button onClick={save} disabled={busy} style={{
          width: "100%", padding: "13px", borderRadius: "var(--r-sm)", background: "var(--amber)", color: "var(--amber-ink)",
          border: "none", fontFamily: "var(--m-font)", fontWeight: 700, fontSize: 15, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
        }}>{busy ? "Saving…" : "Save DBS record"}</button>
      ) : null}
    >
      {/* who + current status */}
      <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 6 }}>
        <div style={{ width: 48, height: 48, borderRadius: 14, flex: "none", background: soft, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <MIcon name="shield" size={24} color={ink} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name || "Coach"}</div>
          <div style={{ fontSize: 13, color: "var(--ink3)", marginTop: 1 }}>
            {roleLabel(c.role)}{c.sev?.label ? ` · currently ${c.sev.label}` : ""}
          </div>
        </div>
      </div>

      {(Array.isArray(c.teams) && c.teams.filter(Boolean).length > 0) && (
        <div style={{ fontSize: 12.5, color: "var(--ink3)", margin: "2px 0 4px" }}>
          {c.teams.filter(Boolean).join(", ")}{c.youth ? " · works with under-18s" : ""}
        </div>
      )}

      {/* editable DBS fields (mirror the desktop DbsModal) */}
      <label style={{ ...labelStyle, marginTop: 12 }}>
        Check type
        <select value={checkType} onChange={(e) => setCheckType(e.target.value)} style={inputStyle}>
          {CHECK_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label style={labelStyle}>
        Status
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle}>
          {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label style={labelStyle}>
        Certificate number
        <input value={certNum} onChange={(e) => setCertNum(e.target.value)} placeholder="e.g. 001234567890" style={inputStyle} />
      </label>
      <div style={{ fontSize: 11, color: "var(--ink4)", marginTop: 5, lineHeight: 1.35 }}>
        For privacy the stored number isn’t shown back — re-enter it when you save, otherwise the recorded number is cleared.
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <label style={{ ...labelStyle, flex: 1 }}>
          Issued
          <input type="date" value={issued} onChange={(e) => setIssued(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ ...labelStyle, flex: 1 }}>
          Expiry
          <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} style={inputStyle} />
        </label>
      </div>
      <label style={labelStyle}>
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Optional" style={{ ...inputStyle, resize: "vertical", lineHeight: 1.4 }} />
      </label>
      <div style={{ fontSize: 11.5, color: "var(--ink4)", margin: "12px 2px 0", lineHeight: 1.4 }}>
        Saving updates this coach’s DBS across the club — the same record the desktop console shows.
      </div>
    </MobileSheet>
  );
}
