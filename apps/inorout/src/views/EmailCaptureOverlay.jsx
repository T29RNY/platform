import { useState } from "react";
import { supabase } from "@platform/core/storage/supabase.js";

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

export default function EmailCaptureOverlay({ conflictMessage }) {
  const [email,     setEmail]     = useState("");
  const [sent,      setSent]      = useState(false);
  const [sending,   setSending]   = useState(false);
  const [showEmail, setShowEmail] = useState(false);

  const returnTo = encodeURIComponent(window.location.pathname);

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${BASE_URL}/auth/callback?returnTo=${returnTo}` },
    });
  };

  const signInWithEmail = async () => {
    if (!email.trim()) return;
    setSending(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${BASE_URL}/auth/callback?returnTo=${returnTo}` },
    });
    if (!error) setSent(true);
    setSending(false);
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
      ) : sent ? (
        <div style={{ textAlign: "center", maxWidth: 300 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📧</div>
          <div style={{
            fontFamily: "'Bebas Neue', sans-serif", fontSize: 22,
            color: "var(--t1)", letterSpacing: "0.06em", marginBottom: 12,
          }}>
            CHECK YOUR EMAIL
          </div>
          <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300, lineHeight: 1.6 }}>
            Tap the link in your email to continue.
          </div>
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
                {sending ? "Sending..." : "Send Magic Link →"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
