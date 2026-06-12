import React, { useEffect, useRef, useState } from "react";
import { memberCheckIn } from "@platform/core/storage/supabase.js";

// CheckInOverlay — reception member check-in (Phase 5, mig 274). Staff-triggered
// full-screen modal. On a device with a camera (a reception tablet/phone) it scans
// the member's pass QR via the native BarcodeDetector; on a camera-less TV it falls
// back to manual entry of the code printed on the pass. Either way it calls
// member_check_in(displayToken, value) — venue-bound server-side — and greets the
// member by name. Rendered outside the scaled 1920×1080 canvas so the camera and
// greeting display at real device resolution.

const RESULT_HOLD_MS = 4500; // show the greeting, then return to scanning

function greet(r) {
  if (!r || !r.ok) {
    const reason = r?.reason;
    if (reason === "wrong_venue") return { tone: "warn", title: "Different venue", sub: "That pass belongs to another venue." };
    if (reason === "cancelled") return { tone: "warn", title: r.first_name ? `${r.first_name}, your membership has ended` : "Membership ended", sub: "Please see reception to renew." };
    if (reason === "pass_not_found") return { tone: "warn", title: "Pass not recognised", sub: "Try again or see reception." };
    return { tone: "warn", title: "Couldn't read that code", sub: "Hold the QR steady, or enter the code." };
  }
  const name = r.first_name || "there";
  const visit = r.visit_count || 1;
  if (r.already_checked_in) return { tone: "ok", title: `Welcome back, ${name}!`, sub: "You're already checked in today." };
  return {
    tone: r.frozen ? "warn" : "ok",
    title: visit > 1 ? `Welcome back, ${name}!` : `Welcome, ${name}!`,
    sub: r.frozen ? `${r.tier_name || "Member"} · membership frozen` : `${r.tier_name || "Member"} · visit #${visit}`,
  };
}

export default function CheckInOverlay({ token, onClose }) {
  const [supported] = useState(() => typeof window !== "undefined" && "BarcodeDetector" in window);
  const [manual, setManual] = useState(!supported); // camera-less → manual entry by default
  const [manualVal, setManualVal] = useState("");
  const [result, setResult] = useState(null);   // { ok, ... } from the RPC
  const [camError, setCamError] = useState(null);
  const [busy, setBusy] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const lockRef = useRef(false); // de-bounce a detected code while a result shows

  const submit = async (value) => {
    if (lockRef.current || !value) return;
    lockRef.current = true;
    setBusy(true);
    try {
      const r = await memberCheckIn(token, value);
      setResult(r);
    } catch (e) {
      console.error("[display] member check-in failed", e);
      setResult({ ok: false, reason: "error" });
    } finally {
      setBusy(false);
      setTimeout(() => { setResult(null); setManualVal(""); lockRef.current = false; }, RESULT_HOLD_MS);
    }
  };

  // camera scan loop (only when supported + not in manual mode)
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
              if (codes && codes.length) { submit(codes[0].rawValue); }
            } catch { /* transient detect error — keep scanning */ }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        console.error("[display] camera unavailable", e);
        setCamError("Camera unavailable — enter the code instead.");
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
  }, [supported, manual, token]);

  const g = result ? greet(result) : null;

  const backdrop = {
    position: "fixed", inset: 0, zIndex: 9999, background: "rgba(8,10,16,0.94)",
    display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    fontFamily: "var(--font-body)", color: "var(--ink)",
  };
  const card = {
    width: "100%", maxWidth: 480, background: "var(--panel)",
    border: "1px solid rgba(255,255,255,0.12)", borderRadius: 20, padding: 28, textAlign: "center",
  };

  return (
    <div style={backdrop} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <strong style={{ fontSize: 20, letterSpacing: 0.3 }}>Member check-in</strong>
          <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", color: "var(--ink)", fontSize: 26, lineHeight: 1, cursor: "pointer", opacity: 0.7 }}>×</button>
        </div>

        {g ? (
          <div style={{ padding: "28px 8px" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>{g.tone === "ok" ? "✓" : "!"}</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 30, lineHeight: 1.1, color: g.tone === "ok" ? "var(--venue)" : "var(--gold)" }}>{g.title}</div>
            <div style={{ marginTop: 10, opacity: 0.8 }}>{g.sub}</div>
          </div>
        ) : manual ? (
          <form onSubmit={(e) => { e.preventDefault(); submit(manualVal.trim()); }}>
            <p style={{ opacity: 0.8, marginTop: 0 }}>Enter the code shown on the member's pass.</p>
            <input
              autoFocus value={manualVal} onChange={(e) => setManualVal(e.target.value)}
              placeholder="m_…" inputMode="text"
              style={{ width: "100%", boxSizing: "border-box", padding: "14px 16px", fontSize: 16, fontFamily: "var(--font-mono)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.06)", color: "var(--ink)" }}
            />
            <button type="submit" disabled={busy || !manualVal.trim()} style={{ marginTop: 14, width: "100%", padding: "14px 16px", fontSize: 16, fontWeight: 700, borderRadius: 12, border: "none", background: "var(--venue)", color: "var(--ink)", cursor: "pointer", opacity: busy || !manualVal.trim() ? 0.5 : 1 }}>
              {busy ? "Checking in…" : "Check in"}
            </button>
            {supported && (
              <button type="button" onClick={() => { setCamError(null); setManual(false); }} style={{ marginTop: 12, background: "transparent", border: "none", color: "var(--ink)", opacity: 0.7, cursor: "pointer", fontSize: 13 }}>
                Use camera instead
              </button>
            )}
          </form>
        ) : (
          <div>
            <div style={{ position: "relative", width: "100%", aspectRatio: "1 / 1", borderRadius: 16, overflow: "hidden", background: "rgba(0,0,0,0.4)" }}>
              <video ref={videoRef} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              <div style={{ position: "absolute", inset: "18%", border: "3px solid rgba(255,255,255,0.85)", borderRadius: 14 }} />
            </div>
            <p style={{ opacity: 0.8 }}>{camError || "Hold the member's pass QR up to the camera."}</p>
            <button type="button" onClick={() => setManual(true)} style={{ background: "transparent", border: "none", color: "var(--ink)", opacity: 0.7, cursor: "pointer", fontSize: 13 }}>
              Enter code manually
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
