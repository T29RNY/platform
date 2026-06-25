// GuardianDocs.jsx — Guardian track, screen 4 (mounted at /hub, More hub → "Documents").
//
// Honest build of design_handoff_guardian_app/m-guardian-more.jsx GuardianDocs + DocSheet.
// Per-CHILD requirement manifest from guardian_list_child_documents (mig 431), three kinds:
//   • sign   → consent text + "I agree" + typed e-signature → memberAcceptConsent
//              (existing RPC; already records signature + timestamp + UA + signed-on-behalf-of).
//   • upload → real file pick → uploadMemberIdDoc (own-prefix) → guardianSubmitIdDocument
//              (parent uploads the child's proof-of-age into member_id_documents).
//   • review → read-only medical / emergency-contact snapshot → guardianConfirmRecordReview.
// Retention: once an upload is verified, the screen self-heals — it removes the ID file via
// the Storage API (removeMemberIdDoc) and stamps purged_at (guardianPurgeIdDocument).
//
// Renders inside the scoped [data-surface="mobile"] tree (amber tokens).

import { useState, useEffect, useCallback, useRef } from "react";
import {
  guardianListChildDocuments, memberAcceptConsent,
  uploadMemberIdDoc, guardianSubmitIdDocument, guardianConfirmRecordReview,
  removeMemberIdDoc, guardianPurgeIdDocument,
} from "@platform/core";
import MIcon from "../icons.jsx";
import MobileSheet from "../MobileSheet.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDay(iso) {
  if (!iso) return "";
  const dt = new Date(iso);
  if (isNaN(dt)) return "";
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

// kind → the action verb on a due row.
function actLabel(kind) {
  return kind === "upload" ? "Upload" : kind === "review" ? "Review" : "Sign";
}
function kindIcon(kind) {
  return kind === "upload" ? "box" : kind === "review" ? "shield" : "flag";
}

export default function GuardianDocs({ childId, childFirst, toast, onBack }) {
  const [state, setState] = useState({ loading: true, error: false, data: null });
  const [sheet, setSheet] = useState(null);
  const healed = useRef(false);

  const load = useCallback(async () => {
    if (!childId) { setState({ loading: false, error: false, data: null }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const data = await guardianListChildDocuments(childId);
      setState({ loading: false, error: false, data });
    } catch {
      setState({ loading: false, error: true, data: null });
    }
  }, [childId]);

  useEffect(() => { healed.current = false; load(); }, [load]);

  // Retention self-heal: remove the file for any verified-but-unpurged proof-of-age,
  // then stamp purged_at. Fire-and-forget; runs once per load.
  useEffect(() => {
    const data = state.data;
    if (!data || healed.current) return;
    const stale = (data.upload || []).filter(
      (u) => u.storage_path && !u.purged && ["approved", "rejected"].includes(u.doc_status)
    );
    if (!stale.length) return;
    healed.current = true;
    (async () => {
      for (const u of stale) {
        try {
          await removeMemberIdDoc(u.storage_path);
          await guardianPurgeIdDocument(u.doc_id);
        } catch { /* best-effort; next load retries */ }
      }
    })();
  }, [state.data]);

  const { loading, error, data } = state;

  if (loading) {
    return <Frame onBack={onBack}><Note>Loading {childFirst ? `${childFirst}'s` : "your"} documents…</Note></Frame>;
  }
  if (error || !data) {
    return (
      <Frame onBack={onBack}>
        <Note>Couldn't load documents right now.</Note>
        <button onClick={load} style={pillBtn}>Try again</button>
      </Frame>
    );
  }

  const sign = data.sign || [];
  const upload = data.upload || [];
  const review = data.review ? [data.review] : [];
  const rows = [...sign, ...upload, ...review];
  const due = rows.filter((r) => r.status === "due").length;

  const onDone = () => { load(); };

  return (
    <Frame onBack={onBack}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "2px 2px 12px" }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.01em", margin: 0 }}>Documents</h2>
        {due > 0 && <span style={{ fontSize: 13, fontWeight: 700, color: "var(--amber)" }}>{due} need action</span>}
      </div>

      {rows.length === 0 && (
        <Note>No documents are required for {childFirst || "your child"} right now.</Note>
      )}

      {rows.map((r) => {
        const needs = r.status === "due";
        const submitted = r.status === "submitted";
        return (
          <button key={r.req_id} className="m-card" onClick={() => openDoc(r)}
            style={{
              width: "100%", textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit",
              padding: "13px 14px", marginBottom: 9, display: "flex", alignItems: "center", gap: 12,
              fontFamily: "var(--m-font)",
            }}>
            <div style={{
              width: 38, height: 38, borderRadius: 11, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
              background: needs ? "var(--amber-soft)" : submitted ? "var(--s4)" : "var(--ok-soft)",
            }}>
              <MIcon name={needs ? kindIcon(r.kind) : submitted ? "clock" : "check"} size={18}
                color={needs ? "var(--amber)" : submitted ? "var(--ink2)" : "var(--ok-ink)"} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.title}</div>
              <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 1 }}>{r.sub}</div>
            </div>
            {needs ? (
              <span style={{
                flex: "none", fontSize: 11, fontWeight: 700, padding: "4px 11px", borderRadius: "var(--r-pill)",
                background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)",
              }}>{actLabel(r.kind)}</span>
            ) : submitted ? (
              <span style={{ flex: "none", fontSize: 11, fontWeight: 700, color: "var(--ink3)" }}>Awaiting review</span>
            ) : (
              <span style={{ flex: "none", fontSize: 11.5, fontWeight: 600, color: "var(--ink4)" }}>
                {r.completed_at ? (r.kind === "sign" ? "Signed " : r.kind === "upload" ? "Verified " : "Updated ") + fmtDay(r.completed_at) : "Done"}
              </span>
            )}
          </button>
        );
      })}

      <div style={{ fontSize: 12.5, color: "var(--ink4)", textAlign: "center", marginTop: 14, lineHeight: 1.5, padding: "0 24px" }}>
        Keeps {childFirst ? `${childFirst}'s` : "your"} registration, medical and consent forms current for the season.
      </div>

      {sheet && (
        <DocSheet
          doc={sheet}
          childId={childId}
          childFirst={childFirst}
          callerProfileId={data.caller_profile_id}
          medical={data.medical}
          toast={toast}
          onClose={() => setSheet(null)}
          onDone={() => { setSheet(null); onDone(); }}
        />
      )}
    </Frame>
  );

  function openDoc(r) { setSheet(r); }
}

function Frame({ children, onBack }) {
  return (
    <div className="m-view-enter">
      {onBack && (
        <button onClick={onBack} style={{
          display: "flex", alignItems: "center", gap: 6, marginBottom: 10, cursor: "pointer",
          background: "transparent", border: "none", color: "var(--ink3)", fontFamily: "var(--m-font)",
          fontWeight: 600, fontSize: 13.5, padding: "2px 0",
        }}>
          <MIcon name="chevleft" size={16} /> More
        </button>
      )}
      {children}
    </div>
  );
}

function Note({ children }) {
  return <div className="m-card" style={{ padding: "14px 15px", color: "var(--ink3)", fontSize: 13.5, lineHeight: 1.5 }}>{children}</div>;
}

const pillBtn = {
  marginTop: 12, padding: "9px 16px", borderRadius: "var(--r-pill)", cursor: "pointer",
  background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)",
  fontWeight: 700, fontSize: 13.5, fontFamily: "var(--m-font)",
};

const DOC_TYPES = [
  { id: "birth_certificate", label: "Birth certificate" },
  { id: "passport", label: "Passport" },
];

function DocSheet({ doc, childId, childFirst, callerProfileId, medical, toast, onClose, onDone }) {
  const isSign = doc.kind === "sign";
  const isUpload = doc.kind === "upload";
  const isReview = doc.kind === "review";

  const [agree, setAgree] = useState(false);
  const [sig, setSig] = useState("");
  const [file, setFile] = useState(null);
  const [docType, setDocType] = useState("birth_certificate");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const ready = isSign ? (agree && sig.trim().length > 1) : isUpload ? !!file : true;
  const cta = isUpload ? "Submit upload" : isReview ? "Confirm details" : "Sign & submit";

  async function submit() {
    setBusy(true);
    try {
      if (isSign) {
        await memberAcceptConsent(doc.doc_id, sig.trim(), {
          onBehalfOfProfileId: childId,
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        });
        toast?.({ icon: "check", tone: "ok", text: "Consent signed", sub: doc.title });
      } else if (isUpload) {
        const path = await uploadMemberIdDoc(callerProfileId, file);
        await guardianSubmitIdDocument(childId, doc.club_id, docType, path);
        toast?.({ icon: "check", tone: "ok", text: "Document uploaded", sub: "Sent to the club for verification" });
      } else {
        await guardianConfirmRecordReview(childId, "medical");
        toast?.({ icon: "check", tone: "ok", text: "Details confirmed", sub: doc.title });
      }
      onDone();
    } catch (e) {
      const m = String(e?.message || "");
      const sub = m.includes("already_accepted") ? "This was already signed."
        : m.includes("not_member_of_club") ? `${childFirst || "Your child"} isn't enrolled at this club.`
        : m.includes("id_not_required") ? "Proof of age isn't required here."
        : "Please try again.";
      toast?.({ icon: "alert", tone: "warn", text: "Couldn't complete", sub });
      setBusy(false);
    }
  }

  return (
    <MobileSheet
      title={isUpload ? "Upload document" : isReview ? "Review details" : "Sign consent"}
      onClose={() => { if (!busy) onClose(); }}
      footer={
        <button onClick={submit} disabled={!ready || busy} style={{
          width: "100%", height: 50, borderRadius: 14, border: "none",
          cursor: ready && !busy ? "pointer" : "default",
          background: ready && !busy ? "var(--amber)" : "var(--s4)",
          color: ready && !busy ? "var(--amber-ink)" : "var(--ink4)",
          fontFamily: "var(--m-font)", fontWeight: 800, fontSize: 15,
        }}>
          {busy ? "Saving…" : cta}
        </button>
      }>

      {/* doc header */}
      <div className="m-card" style={{ padding: "15px 16px", background: "var(--s2)", marginTop: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: 13, flex: "none", background: "var(--amber-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <MIcon name={kindIcon(doc.kind)} size={20} color="var(--amber)" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.01em", color: "var(--ink)" }}>{doc.title}</div>
            <div style={{ fontSize: 12.5, color: "var(--ink3)", marginTop: 2 }}>{doc.sub}</div>
          </div>
        </div>
        {doc.body && <div style={{ fontSize: 13.5, color: "var(--ink2)", lineHeight: 1.5, marginTop: 13 }}>{doc.body}</div>}
      </div>

      {/* REVIEW: read-only medical / contact snapshot */}
      {isReview && medical && (
        <div className="m-card" style={{ padding: "4px 15px", marginTop: 12, background: "var(--s2)" }}>
          <KV k="Emergency contact" v={medical.ec1_name ? `${medical.ec1_name}${medical.ec1_phone ? " · " + medical.ec1_phone : ""}` : "Not recorded"} />
          <KV k="Relationship" v={medical.ec1_relationship || "—"} />
          <KV k="Allergies / dietary" v={medical.dietary_notes || "None recorded"} />
          <KV k="Medical notes" v={medical.send_notes || "None recorded"} />
          <KV k="Emergency treatment" v={medical.consent_emergency_treatment ? "Consented" : "Not consented"} />
          <KV k="Administer medication" v={medical.consent_administer_medication ? "Consented" : "Not consented"} last />
        </div>
      )}

      {/* UPLOAD: doc-type toggle + real file picker */}
      {isUpload && (
        <>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            {DOC_TYPES.map((t) => {
              const on = docType === t.id;
              return (
                <button key={t.id} onClick={() => setDocType(t.id)} style={{
                  flex: 1, padding: "10px 0", borderRadius: "var(--r-md)", cursor: "pointer",
                  background: on ? "var(--amber-soft)" : "var(--s2)",
                  border: "1px solid " + (on ? "var(--amber-glow)" : "var(--hair)"),
                  color: on ? "var(--amber)" : "var(--ink2)", fontFamily: "var(--m-font)",
                  fontSize: 13, fontWeight: 700,
                }}>{t.label}</button>
              );
            })}
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment"
            style={{ display: "none" }} onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <button onClick={() => fileRef.current?.click()} style={{
            width: "100%", marginTop: 12, padding: "26px 18px", borderRadius: 16, cursor: "pointer", fontFamily: "var(--m-font)",
            border: `1.5px dashed ${file ? "var(--ok)" : "var(--hair2)"}`, background: file ? "var(--ok-soft)" : "var(--s1)",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 10, color: "inherit",
          }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: file ? "var(--ok-soft)" : "var(--s4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <MIcon name={file ? "check" : "plus"} size={22} color={file ? "var(--ok-ink)" : "var(--ink2)"} />
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--ink)" }}>{file ? file.name : "Take photo or choose file"}</div>
            <div style={{ fontSize: 12, color: "var(--ink4)" }}>{file ? "Tap to replace" : "JPG or PDF · up to 10MB"}</div>
          </button>
          <div style={{ fontSize: 11.5, color: "var(--ink4)", marginTop: 8, textAlign: "center", lineHeight: 1.5 }}>
            Used once for verification, then deleted.
          </div>
        </>
      )}

      {/* SIGN: agree + typed e-signature */}
      {isSign && (
        <>
          <button onClick={() => setAgree((a) => !a)} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", marginTop: 12,
            borderRadius: 15, border: "1px solid var(--hair)", background: "var(--s2)", cursor: "pointer",
            fontFamily: "var(--m-font)", textAlign: "left", color: "inherit",
          }}>
            <span style={{
              width: 24, height: 24, borderRadius: 7, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
              background: agree ? "var(--amber-soft)" : "transparent",
              boxShadow: agree ? "inset 0 0 0 1.5px var(--amber)" : "inset 0 0 0 1.5px var(--hair2)",
            }}>{agree && <MIcon name="check" size={15} color="var(--amber)" />}</span>
            <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, lineHeight: 1.35, color: "var(--ink)" }}>
              I have read and agree to the above on behalf of {childFirst || "my child"}.
            </span>
          </button>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink3)", margin: "14px 2px 6px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Signature · type your full name
          </div>
          <input value={sig} onChange={(e) => setSig(e.target.value)} placeholder="Full name" style={{
            width: "100%", padding: "12px 14px", borderRadius: 13, border: "1px solid var(--hair2)",
            background: "var(--s1)", color: "var(--ink)", fontFamily: "var(--m-font)", fontStyle: "italic", fontSize: 18,
            boxSizing: "border-box",
          }} />
          <div style={{ fontSize: 11.5, color: "var(--ink4)", marginTop: 8, textAlign: "center" }}>
            Dated {fmtDay(new Date().toISOString())} · legally binding e-signature
          </div>
        </>
      )}
    </MobileSheet>
  );
}

function KV({ k, v, last }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 0", borderBottom: last ? "none" : "1px solid var(--hair)" }}>
      <span style={{ flex: 1, fontSize: 13.5, color: "var(--ink3)", fontWeight: 600 }}>{k}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", textAlign: "right", maxWidth: "58%" }}>{v}</span>
    </div>
  );
}
