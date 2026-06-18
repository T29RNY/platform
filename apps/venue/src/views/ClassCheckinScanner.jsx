import React, { useEffect, useRef, useState } from "react";
import { venueClassCheckin } from "@platform/core/storage/supabase.js";

// ClassCheckinScanner — Phase 6 QR check-in (mig 343). Full-screen instructor-facing
// scanner reached from the class session-detail sheet. Ports the reception display's
// CheckInOverlay pattern (mig 274): native BarcodeDetector on a camera device, manual
// entry fallback otherwise. Each scan calls venue_class_checkin(token, session, value)
// — instructor/manager-gated server-side — and flashes a per-scan confirmation. A live
// running tally of this device's successful check-ins sits at the top. The parent
// reloads the attendee list on close so the canonical count refreshes.

const RESULT_HOLD_MS = 3200; // show the flash, then return to scanning

function flashFor(r) {
  if (!r || !r.ok) {
    const reason = r?.reason;
    if (reason === "wrong_venue")       return { tone: "warn", title: "Different venue", sub: "That pass belongs to another venue." };
    if (reason === "pass_not_found")    return { tone: "warn", title: "Pass not recognised", sub: "Try again or check the member." };
    if (reason === "not_booked")        return { tone: "warn", title: r.member_name ? `${r.member_name} isn't booked` : "Not booked", sub: "No booking for this class." };
    if (reason === "wrong_member")      return { tone: "warn", title: r.member_name ? `${r.member_name} — wrong session` : "Wrong member", sub: "This pass isn't for this appointment." };
    if (reason === "booking_cancelled") return { tone: "warn", title: r.member_name ? `${r.member_name} — cancelled` : "Booking cancelled", sub: "This booking was cancelled." };
    return { tone: "warn", title: "Couldn't read that code", sub: "Hold the QR steady, or enter the code." };
  }
  const name = r.member_name || "Member";
  if (r.already_checked_in) return { tone: "ok", title: `${name} — already in`, sub: "Already checked in for this class." };
  return { tone: "ok", title: `${name} checked in`, sub: r.promoted ? "Promoted from the waitlist." : "Welcome to the class." };
}

// Generalised (Phase 3, mig 358): pass an optional `checkin(value) => result` to
// reuse the scanner for any QR check-in (e.g. PT appointments via venue_pt_checkin).
// Defaults to the class check-in when omitted, so existing call sites are unchanged.
export default function ClassCheckinScanner({ venueToken, sessionId, className, onClose, checkin = null }) {
  const [supported] = useState(() => typeof window !== "undefined" && "BarcodeDetector" in window);
  const [manual, setManual] = useState(!supported);
  const [manualVal, setManualVal] = useState("");
  const [result, setResult] = useState(null);
  const [count, setCount] = useState(0);   // successful (new) check-ins this session
  const [busy, setBusy] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const lockRef = useRef(false);

  const submit = async (value) => {
    if (lockRef.current || !value) return;
    lockRef.current = true;
    setBusy(true);
    try {
      const r = checkin ? await checkin(value) : await venueClassCheckin(venueToken, sessionId, value);
      setResult(r);
      if (r?.ok && !r.already_checked_in) setCount((c) => c + 1);
    } catch (e) {
      console.error("[venue] class check-in failed", e);
      setResult({ ok: false, reason: "error" });
    } finally {
      setBusy(false);
      setTimeout(() => { setResult(null); setManualVal(""); lockRef.current = false; }, RESULT_HOLD_MS);
    }
  };

  useEffect(() => {
    if (!supported || manual) return;
    let raf, detector, alive = true;
    const start = async () => {
      try {
        detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
        const tick = async () => {
          if (!alive) return;
          if (!lockRef.current && videoRef.current && videoRef.current.readyState >= 2) {
            try {
              const codes = await detector.detect(videoRef.current);
              if (codes && codes.length) submit(codes[0].rawValue);
            } catch { /* transient detect error — keep scanning */ }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        console.error("[venue] camera unavailable", e);
        setManual(true);
      }
    };
    start();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [supported, manual]); // eslint-disable-line react-hooks/exhaustive-deps

  const g = result ? flashFor(result) : null;

  const backdrop = {
    position: "fixed", inset: 0, zIndex: 9999, background: "rgba(8,10,16,0.96)",
    display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    fontFamily: "var(--font-body)", color: "var(--ink)",
  };
  const card = {
    width: "100%", maxWidth: 460, background: "var(--bg-2)",
    border: "1px solid var(--border)", borderRadius: 18, padding: 22, textAlign: "center",
  };

  return (
    <div style={backdrop} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <strong style={{ fontSize: 17 }}>Check in · {className || "Class"}</strong>
          <button className="btn btn-sm btn-ghost" onClick={onClose}>Done</button>
        </div>
        <div className="pill pill-ok" style={{ marginBottom: 16 }}>
          <span className="pill-dot" />{count} checked in
        </div>

        {g ? (
          <div style={{ padding: "26px 8px" }}>
            <div style={{ fontSize: 38, marginBottom: 10, color: g.tone === "ok" ? "var(--ok)" : "var(--warn)" }}>{g.tone === "ok" ? "✓" : "!"}</div>
            <div style={{ fontSize: 22, lineHeight: 1.15 }}>{g.title}</div>
            <div className="text-mute" style={{ marginTop: 8, fontSize: 14 }}>{g.sub}</div>
          </div>
        ) : manual ? (
          <form onSubmit={(e) => { e.preventDefault(); submit(manualVal.trim()); }}>
            <p className="text-mute" style={{ marginTop: 0, fontSize: 13 }}>Enter the code shown on the member's pass.</p>
            <input className="input" autoFocus value={manualVal} onChange={(e) => setManualVal(e.target.value)}
              placeholder="m_…" inputMode="text" style={{ marginBottom: 12 }} />
            <button type="submit" className="btn btn-primary" disabled={busy || !manualVal.trim()} style={{ width: "100%" }}>
              {busy ? "Checking in…" : "Check in"}
            </button>
            {supported && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setManual(false)} style={{ marginTop: 10 }}>
                Use camera instead
              </button>
            )}
          </form>
        ) : (
          <div>
            <div style={{ position: "relative", borderRadius: 14, overflow: "hidden", background: "var(--bg)", aspectRatio: "3 / 4" }}>
              <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", inset: 0, border: "2px solid rgba(255,255,255,0.35)", borderRadius: 14, pointerEvents: "none" }} />
            </div>
            <p className="text-mute" style={{ fontSize: 13, marginBottom: 0 }}>Point the camera at the member's pass QR.</p>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setManual(true)} style={{ marginTop: 8 }}>
              Enter code manually
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
