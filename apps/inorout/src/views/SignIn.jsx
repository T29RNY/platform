import { useState } from "react";
import { colors as C } from "@platform/core";
import { supabase } from "@platform/core/storage/supabase.js";
import { startOAuth } from "../native/native-auth.js";
import { isNativeApp } from "../native/is-native.js";

// Apple logo — currentColor so it inherits the button's text colour (no hex).
const APPLE_SVG = (
  <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M17.05 12.04c-.03-2.86 2.34-4.23 2.44-4.3-1.33-1.95-3.41-2.21-4.15-2.24-1.77-.18-3.45 1.04-4.35 1.04-.89 0-2.27-1.01-3.74-.99-1.92.03-3.69 1.12-4.68 2.84-2 3.46-.51 8.58 1.43 11.39.95 1.38 2.08 2.92 3.56 2.87 1.43-.06 1.97-.92 3.7-.92 1.72 0 2.21.92 3.72.89 1.54-.03 2.51-1.4 3.45-2.79 1.09-1.6 1.54-3.15 1.56-3.23-.03-.02-2.99-1.15-3.02-4.55zM14.2 4.38c.79-.96 1.32-2.29 1.18-3.62-1.14.05-2.52.76-3.33 1.72-.73.85-1.37 2.21-1.2 3.51 1.27.1 2.57-.65 3.35-1.61z"/>
  </svg>
);

const BASE_URL = typeof window !== "undefined"
  ? `${window.location.protocol}//${window.location.host}`
  : "https://app.in-or-out.com";

export default function SignIn({ teamName, onBack, returnTo }) {
  const [email,        setEmail]        = useState("");
  const [sent,         setSent]         = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState(null);
  const [showEmail,    setShowEmail]    = useState(false);
  const [awaitingCode, setAwaitingCode] = useState(false); // native: enter the emailed code
  const [code,         setCode]         = useState("");

  // Store where to return after auth
  const storeReturnTo = () => {
    const url = returnTo || window.location.href;
    // Strip the hash if present
    const clean = url.split("#")[0];
    localStorage.setItem("auth_return_to", clean);
  };

  const signInWithGoogle = async () => {
    storeReturnTo();
    const { error } = await startOAuth("google", {
      redirectTo: `${BASE_URL}/auth/callback`,
    });
    if (error) setError(error.message);
  };

  const signInWithApple = async () => {
    storeReturnTo();
    const { error } = await startOAuth("apple", {
      redirectTo: `${BASE_URL}/auth/callback`,
    });
    if (error) setError(error.message);
  };

  const signInWithEmail = async () => {
    if (!email.trim()) return;
    setLoading(true); setError(null);
    storeReturnTo();
    // NATIVE: a magic link emailed to /auth/callback opens in Safari (that path
    // isn't a universal-link), not the wrapper — the session would land in Safari
    // and the app stays logged out. So inside the native app use the 6-digit CODE
    // flow (verifyOtp), identical to AuthGateModal: no redirect, works in the
    // WKWebView. WEB keeps the proven magic-link behaviour untouched.
    if (isNativeApp()) {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { shouldCreateUser: true },
      });
      if (error) { setError(error.message); setLoading(false); }
      else { setAwaitingCode(true); setLoading(false); }
      return;
    }
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${BASE_URL}/auth/callback`,
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setSent(true);
      setLoading(false);
    }
  };

  // NATIVE code verification. On success the session is live in storage; route
  // through /auth/callback so returnTo/profile handling is shared byte-for-byte
  // with the Apple and web sign-in paths.
  const verifyEmailCode = async () => {
    const token = code.trim();
    if (token.length < 6) return;
    setLoading(true); setError(null);
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token,
      type: "email",
    });
    if (error) {
      setError(error.message || "That code didn't work — request a new one.");
      setLoading(false);
    } else {
      window.location.assign("/auth/callback");
    }
  };

  return (
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
      maxWidth:430, margin:"0 auto", fontFamily:"'DM Sans', sans-serif",
      display:"flex", flexDirection:"column" }}>

      {/* Header */}
      <div style={{ padding:"calc(24px + env(safe-area-inset-top)) 24px 20px", background:C.bg,
        borderBottom:`1px solid ${C.border}` }}>
        {/* Brand lockup — IN green · OR neutral · OUT red (matches PageHeader / welcome). */}
        <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:28, letterSpacing:3 }}>
          <span style={{ color:C.green }}>IN</span>
          <span style={{ color:C.text }}> OR </span>
          <span style={{ color:C.red }}>OUT</span>
        </div>
        {teamName && (
          <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:13,
            color:C.muted, marginTop:4 }}>
            Sign in to join <strong style={{ color:C.text }}>{teamName}</strong>
          </div>
        )}
      </div>

      <div style={{ padding:24, flex:1 }}>
        {awaitingCode ? (
          // NATIVE: enter the 6-digit code from the email (no redirect — works in
          // the wrapper, unlike the magic link which would open in Safari).
          <div style={{ textAlign:"center", paddingTop:40 }}>
            <div style={{ fontSize:52, marginBottom:16 }}>📧</div>
            <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:24,
              color:C.text, letterSpacing:1, marginBottom:8 }}>
              ENTER YOUR CODE
            </div>
            <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:13,
              color:C.muted, lineHeight:1.6, marginBottom:20 }}>
              We emailed a 6-digit code to<br/>
              <strong style={{ color:C.text }}>{email}</strong>
            </div>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={10}
              autoFocus
              placeholder="••••••"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
              onKeyDown={e => e.key === "Enter" && verifyEmailCode()}
              style={{ width:"100%", maxWidth:220, padding:"13px 14px", borderRadius:6,
                border:`1.5px solid ${code.length>=6?C.amber:C.border}`,
                background:C.bg, color:C.text,
                fontFamily:"monospace", fontSize:22, letterSpacing:6, textAlign:"center",
                outline:"none", boxSizing:"border-box", marginBottom:12 }}
            />
            {error && (
              <div style={{ padding:"8px 12px", borderRadius:6,
                background:C.red+"18", color:C.red,
                fontFamily:"'DM Sans', sans-serif", fontSize:12,
                marginBottom:12 }}>{error}</div>
            )}
            <button onClick={verifyEmailCode}
              disabled={loading || code.length<6} style={{
              width:"100%", padding:"13px 0", borderRadius:6, border:"none",
              background: loading || code.length<6 ? "#2a2a2a" : C.amber,
              color: loading || code.length<6 ? C.muted : C.black,
              fontFamily:"'DM Sans', sans-serif", fontSize:14, fontWeight:800,
              cursor: loading || code.length<6 ? "not-allowed" : "pointer", marginBottom:12 }}>
              {loading ? "Verifying..." : "Verify"}
            </button>
            <button onClick={() => { setAwaitingCode(false); setCode(""); setError(null); }}
              style={{ background:"none", border:"none", color:C.amber,
                fontFamily:"'DM Sans', sans-serif", fontSize:13, cursor:"pointer" }}>
              Use a different email
            </button>
          </div>
        ) : sent ? (
          // Magic link sent
          <div style={{ textAlign:"center", paddingTop:40 }}>
            <div style={{ fontSize:52, marginBottom:16 }}>📧</div>
            <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:24,
              color:C.text, letterSpacing:1, marginBottom:8 }}>
              CHECK YOUR EMAIL
            </div>
            <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:13,
              color:C.muted, lineHeight:1.6, marginBottom:24 }}>
              We sent a sign-in link to<br/>
              <strong style={{ color:C.text }}>{email}</strong><br/>
              Tap it to continue — no password to remember.
            </div>
            <button onClick={() => { setSent(false); setEmail(""); }}
              style={{ background:"none", border:"none", color:C.amber,
                fontFamily:"'DM Sans', sans-serif", fontSize:13, cursor:"pointer" }}>
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:14,
              color:C.muted, marginBottom:28, lineHeight:1.6 }}>
              Sign in to continue — no password to remember.
            </div>

            {/* Apple — HIG: at least as prominent as Google. Solid near-white
                fill (vs Google's bordered surface), placed first. */}
            <button onClick={signInWithApple} style={{
              width:"100%", padding:"14px 0", borderRadius:8, marginBottom:12,
              border:"none", background:C.text,
              color:C.bg, fontFamily:"'DM Sans', sans-serif", fontSize:14,
              fontWeight:600, cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
              {APPLE_SVG}
              Continue with Apple
            </button>

            {/* Google */}
            <button onClick={signInWithGoogle} style={{
              width:"100%", padding:"14px 0", borderRadius:8, marginBottom:12,
              border:`1.5px solid ${C.border}`, background:C.surface,
              color:C.text, fontFamily:"'DM Sans', sans-serif", fontSize:14,
              fontWeight:600, cursor:"pointer",
              display:"flex", alignItems:"center", justifyContent:"center", gap:10 }}>
              <svg width="18" height="18" viewBox="0 0 18 18">
                <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
                <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
                <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/>
                <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/>
              </svg>
              Continue with Google
            </button>

            {/* Divider */}
            <div style={{ display:"flex", alignItems:"center", gap:12, margin:"16px 0" }}>
              <div style={{ flex:1, height:1, background:C.border }}/>
              <span style={{ fontFamily:"'DM Sans', sans-serif", fontSize:11,
                color:C.muted, fontWeight:600 }}>OR</span>
              <div style={{ flex:1, height:1, background:C.border }}/>
            </div>

            {/* Email */}
            {!showEmail ? (
              <button onClick={() => setShowEmail(true)} style={{
                width:"100%", padding:"14px 0", borderRadius:8,
                border:`1.5px solid ${C.border}`, background:"transparent",
                color:C.muted, fontFamily:"'DM Sans', sans-serif", fontSize:14,
                fontWeight:600, cursor:"pointer" }}>
                Continue with Email
              </button>
            ) : (
              <div>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && signInWithEmail()}
                  placeholder="your@email.com"
                  autoFocus
                  style={{ width:"100%", padding:"13px 14px", borderRadius:6,
                    border:`1.5px solid ${email?C.amber:C.border}`,
                    background:C.bg, color:C.text,
                    fontFamily:"'DM Sans', sans-serif", fontSize:14,
                    outline:"none", boxSizing:"border-box", marginBottom:10 }}
                />
                {error && (
                  <div style={{ padding:"8px 12px", borderRadius:6,
                    background:C.red+"18", color:C.red,
                    fontFamily:"'DM Sans', sans-serif", fontSize:12,
                    marginBottom:10 }}>{error}</div>
                )}
                <button onClick={signInWithEmail}
                  disabled={loading || !email.trim()} style={{
                  width:"100%", padding:"13px 0", borderRadius:6, border:"none",
                  background: loading || !email.trim() ? "#2a2a2a" : C.amber,
                  color: loading || !email.trim() ? C.muted : C.black,
                  fontFamily:"'DM Sans', sans-serif", fontSize:14, fontWeight:800,
                  cursor: loading || !email.trim() ? "not-allowed" : "pointer" }}>
                  {loading ? "Sending..." : (isNativeApp() ? "Send me a code" : "Send Magic Link →")}
                </button>
              </div>
            )}

            <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:11,
              color:C.muted, textAlign:"center", marginTop:20, lineHeight:1.5 }}>
              No password to remember · No spam · Unsubscribe anytime
            </div>
          </>
        )}
      </div>
    </div>
  );
}
