import { useState } from "react";
import { supabase } from "@platform/core/storage/supabase.js";
import { startOAuth } from "../native/native-auth.js";

const BASE_URL = typeof window !== "undefined"
  ? `${window.location.protocol}//${window.location.host}`
  : "https://app.in-or-out.com";

const GOOGLE_SVG = (
  <svg width="18" height="18" viewBox="0 0 18 18">
    <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
    <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
    <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/>
    <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/>
  </svg>
);

// Apple logo — currentColor inherits the button's text colour (no hex).
const APPLE_SVG = (
  <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M17.05 12.04c-.03-2.86 2.34-4.23 2.44-4.3-1.33-1.95-3.41-2.21-4.15-2.24-1.77-.18-3.45 1.04-4.35 1.04-.89 0-2.27-1.01-3.74-.99-1.92.03-3.69 1.12-4.68 2.84-2 3.46-.51 8.58 1.43 11.39.95 1.38 2.08 2.92 3.56 2.87 1.43-.06 1.97-.92 3.7-.92 1.72 0 2.21.92 3.72.89 1.54-.03 2.51-1.4 3.45-2.79 1.09-1.6 1.54-3.15 1.56-3.23-.03-.02-2.99-1.15-3.02-4.55zM14.2 4.38c.79-.96 1.32-2.29 1.18-3.62-1.14.05-2.52.76-3.33 1.72-.73.85-1.37 2.21-1.2 3.51 1.27.1 2.57-.65 3.35-1.61z"/>
  </svg>
);

export default function EmailCaptureOverlay({ conflictMessage }) {
  const [email,        setEmail]        = useState("");
  const [sending,      setSending]      = useState(false);
  const [showEmail,    setShowEmail]    = useState(false);
  const [awaitingCode, setAwaitingCode] = useState(false); // native: enter emailed code
  const [code,         setCode]         = useState("");
  const [codeError,    setCodeError]    = useState(null);

  const returnTo = encodeURIComponent(window.location.pathname);

  const signInWithGoogle = async () => {
    await startOAuth("google", {
      redirectTo: `${BASE_URL}/auth/callback?returnTo=${returnTo}`,
    });
  };

  const signInWithApple = async () => {
    await startOAuth("apple", {
      redirectTo: `${BASE_URL}/auth/callback?returnTo=${returnTo}`,
    });
  };

  const signInWithEmail = async () => {
    if (!email.trim()) return;
    setSending(true); setCodeError(null);
    // CODE flow on BOTH web and native — the magic link to /auth/callback opens
    // in Safari inside the wrapper (not a universal-link path) and the auth
    // emails are code-only; verifyOtp works everywhere (mirrors AuthGateModal).
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: true },
    });
    if (!error) setAwaitingCode(true);
    setSending(false);
  };

  // NATIVE code verification → route through /auth/callback (keeps the player's
  // returnTo so they land back where the overlay appeared).
  const verifyEmailCode = async () => {
    const token = code.trim();
    if (token.length < 6) return;
    setSending(true); setCodeError(null);
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(), token, type: "email",
    });
    if (error) {
      setCodeError(error.message || "That code didn't work — request a new one.");
      setSending(false);
    } else {
      window.location.assign(`/auth/callback?returnTo=${returnTo}`);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "var(--bg)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: 32,
    }}>
      {/* IO brand */}
      <div style={{
        fontFamily: "'Bebas Neue', sans-serif", fontSize: 32,
        letterSpacing: "0.1em", marginBottom: 40,
      }}>
        <span style={{ color: "var(--green)" }}>I</span>
        <span style={{ color: "var(--t1)" }}>n or </span>
        <span style={{ color: "var(--red)" }}>O</span>
        <span style={{ color: "var(--t1)" }}>ut</span>
      </div>

      {conflictMessage ? (
        <div style={{ textAlign: "center", maxWidth: 300 }}>
          <div style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 22,
            color: "var(--gold)", letterSpacing: "0.06em", marginBottom: 16,
          }}>
            ACCOUNT CONFLICT
          </div>
          <div style={{ fontSize: 14, color: "var(--t2)", fontWeight: 300, lineHeight: 1.7 }}>
            {conflictMessage}
          </div>
        </div>
      ) : awaitingCode ? (
        // NATIVE: enter the emailed code (no redirect — works in the wrapper).
        <div style={{ textAlign: "center", maxWidth: 300, width: "100%" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📧</div>
          <div style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 22,
            color: "var(--t1)", letterSpacing: "0.06em", marginBottom: 12,
          }}>
            ENTER YOUR CODE
          </div>
          <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300, lineHeight: 1.6, marginBottom: 16 }}>
            We emailed a code to <span style={{ color: "var(--t1)" }}>{email}</span>
          </div>
          <input
            type="text" inputMode="numeric" autoComplete="one-time-code"
            maxLength={10} autoFocus placeholder="••••••"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
            onKeyDown={e => e.key === "Enter" && verifyEmailCode()}
            style={{
              width: "100%", maxWidth: 200, padding: "13px 14px", borderRadius: 6,
              border: `0.5px solid ${code.length >= 6 ? "var(--gold)" : "rgba(255,255,255,0.1)"}`,
              background: "var(--s2)", color: "var(--t1)",
              fontFamily: "monospace", fontSize: 20, letterSpacing: 6, textAlign: "center",
              outline: "none", boxSizing: "border-box", marginBottom: 10,
            }}
          />
          {codeError && (
            <div style={{ fontSize: 12, color: "var(--red)", marginBottom: 10 }}>{codeError}</div>
          )}
          <button
            onClick={verifyEmailCode}
            disabled={sending || code.length < 6}
            style={{
              width: "100%", padding: "13px 0", borderRadius: 6, border: "none",
              background: sending || code.length < 6 ? "var(--s3)" : "var(--gold)",
              color: sending || code.length < 6 ? "var(--t2)" : "var(--bg)",
              fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 400,
              cursor: sending || code.length < 6 ? "not-allowed" : "pointer", marginBottom: 10,
            }}
          >
            {sending ? "Verifying..." : "Verify"}
          </button>
          <button
            onClick={() => { setAwaitingCode(false); setCode(""); setCodeError(null); }}
            style={{
              background: "none", border: "none", color: "var(--t2)",
              fontFamily: "'DM Sans', sans-serif", fontSize: 13, fontWeight: 300, cursor: "pointer",
            }}
          >
            Use a different email
          </button>
        </div>
      ) : (
        <div style={{ width: "100%", maxWidth: 320 }}>
          <div style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 30,
            color: "var(--gold)", letterSpacing: "0.06em",
            textAlign: "center", marginBottom: 12,
          }}>
            KEEP YOUR ACCESS
          </div>
          <div style={{
            fontSize: 14, color: "var(--t2)", fontWeight: 300,
            textAlign: "center", lineHeight: 1.6, marginBottom: 36,
          }}>
            Add your email to access your stats on any device
          </div>

          {/* Apple — HIG: ≥ as prominent as Google. Solid near-white fill,
              placed first. */}
          <button onClick={signInWithApple} style={{
            width: "100%", padding: "14px 0", borderRadius: 8, marginBottom: 12,
            border: "none", background: "var(--t1)",
            color: "var(--bg)", fontFamily: "'DM Sans', sans-serif", fontSize: 14,
            fontWeight: 500, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            {APPLE_SVG}
            Continue with Apple
          </button>

          <button onClick={signInWithGoogle} style={{
            width: "100%", padding: "14px 0", borderRadius: 8, marginBottom: 12,
            border: "0.5px solid rgba(255,255,255,0.1)", background: "var(--s2)",
            color: "var(--t1)", fontFamily: "'DM Sans', sans-serif", fontSize: 14,
            fontWeight: 400, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          }}>
            {GOOGLE_SVG}
            Continue with Google
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "16px 0" }}>
            <div style={{ flex: 1, height: "0.5px", background: "rgba(255,255,255,0.1)" }}/>
            <span style={{ fontSize: 11, color: "var(--t2)", fontWeight: 300 }}>or</span>
            <div style={{ flex: 1, height: "0.5px", background: "rgba(255,255,255,0.1)" }}/>
          </div>

          {!showEmail ? (
            <button onClick={() => setShowEmail(true)} style={{
              width: "100%", padding: "13px 0", borderRadius: 8,
              border: "0.5px solid rgba(255,255,255,0.1)", background: "transparent",
              color: "var(--t2)", fontFamily: "'DM Sans', sans-serif", fontSize: 14,
              fontWeight: 300, cursor: "pointer",
            }}>
              Use email instead
            </button>
          ) : (
            <div>
              <input
                type="email" value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === "Enter" && signInWithEmail()}
                placeholder="your@email.com"
                autoFocus
                style={{
                  width: "100%", padding: "13px 14px", borderRadius: 6,
                  border: `0.5px solid ${email ? "var(--gold)" : "rgba(255,255,255,0.1)"}`,
                  background: "var(--s2)", color: "var(--t1)",
                  fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 300,
                  outline: "none", boxSizing: "border-box", marginBottom: 10,
                }}
              />
              <button
                onClick={signInWithEmail}
                disabled={sending || !email.trim()}
                style={{
                  width: "100%", padding: "13px 0", borderRadius: 6, border: "none",
                  background: sending || !email.trim() ? "var(--s3)" : "var(--gold)",
                  color: sending || !email.trim() ? "var(--t2)" : "var(--bg)",
                  fontFamily: "'DM Sans', sans-serif", fontSize: 14, fontWeight: 400,
                  cursor: sending || !email.trim() ? "not-allowed" : "pointer",
                }}
              >
                {sending ? "Sending..." : "Send me a code"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
