import { useState } from "react";
import { colors as C } from "@platform/core";
import { supabase } from "@platform/core/storage/supabase.js";

const BASE_URL = typeof window !== "undefined"
  ? `${window.location.protocol}//${window.location.host}`
  : "https://www.in-or-out.com";

export default function SignIn({ teamName, onBack, returnTo }) {
  const [email,      setEmail]      = useState("");
  const [sent,       setSent]       = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState(null);
  const [showEmail,  setShowEmail]  = useState(false);

  // Store where to return after auth
  const storeReturnTo = () => {
    const url = returnTo || window.location.href;
    // Strip the hash if present
    const clean = url.split("#")[0];
    localStorage.setItem("auth_return_to", clean);
  };

  const signInWithGoogle = async () => {
    storeReturnTo();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${BASE_URL}/auth/callback`,
      },
    });
    if (error) setError(error.message);
  };

  const signInWithEmail = async () => {
    if (!email.trim()) return;
    setLoading(true); setError(null);
    storeReturnTo();
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

  return (
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
      maxWidth:430, margin:"0 auto", fontFamily:"Inter,sans-serif",
      display:"flex", flexDirection:"column" }}>

      {/* Header */}
      <div style={{ padding:"24px 24px 20px", background:C.bg,
        borderBottom:`1px solid ${C.border}` }}>
        <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:28,
          color:C.amber, letterSpacing:3 }}>IN OR OUT</div>
        {teamName && (
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:13,
            color:C.muted, marginTop:4 }}>
            Sign in to join <strong style={{ color:C.text }}>{teamName}</strong>
          </div>
        )}
      </div>

      <div style={{ padding:24, flex:1 }}>
        {sent ? (
          // Magic link sent
          <div style={{ textAlign:"center", paddingTop:40 }}>
            <div style={{ fontSize:52, marginBottom:16 }}>📧</div>
            <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:24,
              color:C.text, letterSpacing:1, marginBottom:8 }}>
              CHECK YOUR EMAIL
            </div>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:13,
              color:C.muted, lineHeight:1.6, marginBottom:24 }}>
              We sent a sign-in link to<br/>
              <strong style={{ color:C.text }}>{email}</strong><br/>
              Tap it to continue — no password needed.
            </div>
            <button onClick={() => { setSent(false); setEmail(""); }}
              style={{ background:"none", border:"none", color:C.amber,
                fontFamily:"Inter,sans-serif", fontSize:13, cursor:"pointer" }}>
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <div style={{ fontFamily:"Inter,sans-serif", fontSize:14,
              color:C.muted, marginBottom:28, lineHeight:1.6 }}>
              Sign in to continue. Takes 10 seconds — no password needed.
            </div>

            {/* Google */}
            <button onClick={signInWithGoogle} style={{
              width:"100%", padding:"14px 0", borderRadius:8, marginBottom:12,
              border:`1.5px solid ${C.border}`, background:C.surface,
              color:C.text, fontFamily:"Inter,sans-serif", fontSize:14,
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
              <span style={{ fontFamily:"Inter,sans-serif", fontSize:11,
                color:C.muted, fontWeight:600 }}>OR</span>
              <div style={{ flex:1, height:1, background:C.border }}/>
            </div>

            {/* Email */}
            {!showEmail ? (
              <button onClick={() => setShowEmail(true)} style={{
                width:"100%", padding:"14px 0", borderRadius:8,
                border:`1.5px solid ${C.border}`, background:"transparent",
                color:C.muted, fontFamily:"Inter,sans-serif", fontSize:14,
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
                    fontFamily:"Inter,sans-serif", fontSize:14,
                    outline:"none", boxSizing:"border-box", marginBottom:10 }}
                />
                {error && (
                  <div style={{ padding:"8px 12px", borderRadius:6,
                    background:C.red+"18", color:C.red,
                    fontFamily:"Inter,sans-serif", fontSize:12,
                    marginBottom:10 }}>{error}</div>
                )}
                <button onClick={signInWithEmail}
                  disabled={loading || !email.trim()} style={{
                  width:"100%", padding:"13px 0", borderRadius:6, border:"none",
                  background: loading || !email.trim() ? "#2a2a2a" : C.amber,
                  color: loading || !email.trim() ? C.muted : C.black,
                  fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:800,
                  cursor: loading || !email.trim() ? "not-allowed" : "pointer" }}>
                  {loading ? "Sending..." : "Send Magic Link →"}
                </button>
              </div>
            )}

            <div style={{ fontFamily:"Inter,sans-serif", fontSize:11,
              color:C.muted, textAlign:"center", marginTop:20, lineHeight:1.5 }}>
              No password · No spam · Unsubscribe anytime
            </div>
          </>
        )}
      </div>
    </div>
  );
}
