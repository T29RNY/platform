import { useEffect, useRef, useState } from "react";
import { colors as C } from "@platform/core";
import { supabase } from "@platform/core/storage/supabase.js";
import { X } from "@phosphor-icons/react";

// Modal sign-in. Two stages: email → 6-digit code.
// No Google button (Google sometimes blocks "webview-style" sign-ins on iOS
// PWAs — see DECISIONS.md "AUTH-DECOUPLING POSTURE"). Email-OTP is the safe path.
//
// Email template precondition: the Supabase "Magic link or OTP" template
// must surface `{{ .Token }}` (the 6-digit code) prominently. Default
// template only shows the link.
export default function AuthGateModal({ open, onClose, onAuthed, reason }) {
  const [email, setEmail]     = useState("");
  const [stage, setStage]     = useState("email"); // "email" | "code"
  const [code, setCode]       = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const codeInputRef = useRef(null);

  useEffect(() => {
    if (!open) {
      setEmail(""); setStage("email"); setCode(""); setLoading(false); setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (stage === "code" && codeInputRef.current) codeInputRef.current.focus();
  }, [stage]);

  if (!open) return null;

  const sendCode = async () => {
    const e = email.trim().toLowerCase();
    if (!e) return;
    setLoading(true); setError(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: e,
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
      setStage("code");
    } catch (err) {
      setError(err.message || "Couldn't send code. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    const token = code.trim();
    if (token.length < 6) return;
    setLoading(true); setError(null);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token,
        type: "email",
      });
      if (error) throw error;
      onAuthed?.();
    } catch (err) {
      setError(err.message || "That code didn't work. Try again.");
      setLoading(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 380,
          background: C.bg, color: C.text,
          border: `1px solid ${C.border}`, borderRadius: 14,
          padding: "24px 22px 22px",
          fontFamily: "Inter, sans-serif",
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 22,
            color: C.amber, letterSpacing: 2,
          }}>
            SIGN IN
          </div>
          <button onClick={onClose} style={{
            background: "transparent", border: "none", color: C.muted,
            cursor: "pointer", padding: 4, marginTop: -4, marginRight: -4,
          }}>
            <X weight="thin" size={20} />
          </button>
        </div>

        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5, marginBottom: 18 }}>
          {reason || "Sign in to continue."}
        </div>

        {stage === "email" && (
          <>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && sendCode()}
              style={{
                width: "100%", padding: "13px 14px", borderRadius: 8,
                border: `1.5px solid ${email ? C.amber : C.border}`,
                background: C.surface, color: C.text,
                fontFamily: "Inter, sans-serif", fontSize: 15,
                outline: "none", boxSizing: "border-box", marginBottom: 10,
              }}
            />
            {error && (
              <div style={{
                padding: "8px 12px", borderRadius: 6,
                background: C.red + "18", color: C.red,
                fontSize: 12, marginBottom: 10,
              }}>{error}</div>
            )}
            <button
              onClick={sendCode}
              disabled={loading || !email.trim()}
              style={{
                width: "100%", padding: "13px 0", borderRadius: 8, border: "none",
                background: loading || !email.trim() ? "#2a2a2a" : C.amber,
                color: loading || !email.trim() ? C.muted : C.black,
                fontFamily: "Inter, sans-serif", fontSize: 14, fontWeight: 700,
                cursor: loading || !email.trim() ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Sending..." : "Send me a code"}
            </button>
          </>
        )}

        {stage === "code" && (
          <>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
              We sent a code to <strong style={{ color: C.text }}>{email}</strong>.
              Check your inbox — might take a few seconds.
            </div>
            <input
              ref={codeInputRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={10}
              placeholder="••••••"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
              onKeyDown={e => e.key === "Enter" && verifyCode()}
              style={{
                width: "100%", padding: "13px 14px", borderRadius: 8,
                border: `1.5px solid ${code.length >= 6 ? C.amber : C.border}`,
                background: C.surface, color: C.text,
                fontFamily: "monospace", fontSize: 22, letterSpacing: 6,
                textAlign: "center",
                outline: "none", boxSizing: "border-box", marginBottom: 10,
              }}
            />
            {error && (
              <div style={{
                padding: "8px 12px", borderRadius: 6,
                background: C.red + "18", color: C.red,
                fontSize: 12, marginBottom: 10,
              }}>{error}</div>
            )}
            <button
              onClick={verifyCode}
              disabled={loading || code.length < 6}
              style={{
                width: "100%", padding: "13px 0", borderRadius: 8, border: "none",
                background: loading || code.length < 6 ? "#2a2a2a" : C.amber,
                color: loading || code.length < 6 ? C.muted : C.black,
                fontFamily: "Inter, sans-serif", fontSize: 14, fontWeight: 700,
                cursor: loading || code.length < 6 ? "not-allowed" : "pointer",
                marginBottom: 8,
              }}
            >
              {loading ? "Verifying..." : "Verify"}
            </button>
            <button
              onClick={() => { setStage("email"); setCode(""); setError(null); }}
              style={{
                width: "100%", padding: "10px 0", background: "transparent",
                border: "none", color: C.muted, fontSize: 12, cursor: "pointer",
              }}
            >
              Use a different email
            </button>
          </>
        )}
      </div>
    </div>
  );
}
