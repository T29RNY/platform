// MemberDocSheet.jsx — the per-member compliance detail sheet, SHARED by every /hub role that
// reads a club doc-status board: the coach (TeamManagerDocs → club_manager_get_team_doc_status)
// and the club-admin (ClubAdminSafeguarding → venue_get_club_doc_status, mig 553). Both readers
// return the identical per-member shape:
//   { name, consents{ signed, required, status, items:[{title,version,signed,signed_at}] },
//     id{ status, detail:{document_type,status,uploaded_at,verified_at,rejection_reason} },
//     medical{ status, reviewed_at }, outstanding, all_clear }
// so one sheet serves all roles — a future doc-type change updates every role at once.
//
// Shows EXACTLY which consents are signed/missing, the ID status, and the medical-review date.
// STATUS / metadata ONLY — the medical content itself is never here (it stays with the family).
// Renders inside [data-surface="mobile"] and portals through MobileSheet (clears the docked nav).

import MIcon from "../icons.jsx";
import MobileSheet from "../MobileSheet.jsx";

// ISO timestamp → "8 Jul 2026" (viewer-local; no date lib).
export function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const ID_TYPE = { passport: "Passport", driving_licence: "Driving licence", pass_card: "PASS card", birth_certificate: "Birth certificate" };

// One doc line: ✓/! + label + a status sub-line.
function DocRow({ label, ok, sub }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--hair)" }}>
      <MIcon name={ok ? "check" : "alert"} size={15} color={ok ? "var(--ok-ink)" : "var(--amber)"} style={{ flex: "none" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}

// Per-player detail sheet — WHICH consents are signed/missing, the ID status, the medical-review
// date. Status/metadata only; the medical content itself is never here.
export default function MemberDocSheet({ m, onClose }) {
  const items = m.consents?.items || [];
  const idStatus = m.id?.status;
  const idDetail = m.id?.detail;
  const medStatus = m.medical?.status;
  const medDate = fmtDate(m.medical?.reviewed_at);
  return (
    <MobileSheet title={m.name} onClose={onClose}>
      <div className="m-eyebrow" style={{ margin: "2px 2px 8px" }}>Consent forms</div>
      {items.length === 0 && <div style={{ fontSize: 13, color: "var(--ink3)", padding: "2px 2px 8px" }}>No consent forms set for this club yet.</div>}
      {items.map((it, i) => (
        <DocRow key={i} label={it.title} ok={it.signed}
          sub={it.signed ? (fmtDate(it.signed_at) ? "Signed " + fmtDate(it.signed_at) : "Signed") : "Not signed yet"} />
      ))}

      {idStatus && idStatus !== "na" && (
        <>
          <div className="m-eyebrow" style={{ margin: "14px 2px 8px" }}>Proof of age</div>
          <DocRow label="ID document" ok={idStatus === "done"}
            sub={
              idStatus === "done" ? (ID_TYPE[idDetail?.document_type] || "Approved") + (fmtDate(idDetail?.verified_at) ? " · verified " + fmtDate(idDetail?.verified_at) : "")
              : idStatus === "submitted" ? "Uploaded — awaiting verification"
              : idDetail?.rejection_reason ? "Rejected: " + idDetail.rejection_reason
              : "Not uploaded yet"
            } />
        </>
      )}

      <div className="m-eyebrow" style={{ margin: "14px 2px 8px" }}>Medical &amp; emergency review</div>
      <DocRow label="Yearly review" ok={medStatus === "done"}
        sub={medStatus === "done" ? (medDate ? "Confirmed " + medDate : "Confirmed")
          : (medDate ? "Last confirmed " + medDate + " — due again" : "Never confirmed")} />

      <div style={{ fontSize: 11.5, color: "var(--ink4)", marginTop: 14, lineHeight: 1.5 }}>
        Status only — the medical details themselves stay private to the family, who complete these in their own app.
      </div>
    </MobileSheet>
  );
}
