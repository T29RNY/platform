import { useState, useEffect } from "react";
import { colors as C } from "@platform/core";
import { supabase } from "@platform/supabase";
import InstallBanner from "./InstallBanner.jsx";

const BASE_URL = typeof window !== "undefined"
  ? `${window.location.protocol}//${window.location.host}`
  : "https://www.in-or-out.com";

// Step 1 — Not signed in: show Google + Email options only
function SignInStep({ team }) {
  const [email,   setEmail]   = useState("");
  const [sent,    setSent]    = useState(false);
  const [sending, setSending] = useState(false);
  const [showEmail, setShowEmail] = useState(false);

  const signInWithGoogle = async () => {
    const returnTo = encodeURIComponent(window.location.href);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${BASE_URL}/auth/callback?returnTo=${returnTo}`,
      },
    });
  };

  const signInWithEmail = async () => {
    if (!email.trim()) return;
    setSending(true);
    const returnTo = encodeURIComponent(window.location.href);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${BASE_URL}/auth/callback?returnTo=${returnTo}` },
    });
    if (!error) setSent(true);
    setSending(false);
  };

  return (
    <div style={{ padding:24, flex:1 }}>
      {sent ? (
        <div style={{ textAlign:"center", paddingTop:40 }}>
          <div style={{ fontSize:52, marginBottom:16 }}>📧</div>
          <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:24,
            color:C.text, letterSpacing:1, marginBottom:8 }}>CHECK YOUR EMAIL</div>
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
            Sign in to join. Takes 10 seconds — no password needed.
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

          <div style={{ display:"flex", alignItems:"center", gap:12, margin:"16px 0" }}>
            <div style={{ flex:1, height:1, background:C.border }}/>
            <span style={{ fontFamily:"Inter,sans-serif", fontSize:11,
              color:C.muted, fontWeight:600 }}>OR</span>
            <div style={{ flex:1, height:1, background:C.border }}/>
          </div>

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
                type="email" value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key==="Enter" && signInWithEmail()}
                placeholder="your@email.com" autoFocus
                style={{ width:"100%", padding:"13px 14px", borderRadius:6,
                  border:`1.5px solid ${email?C.amber:C.border}`,
                  background:"#0a0a0a", color:C.text,
                  fontFamily:"Inter,sans-serif", fontSize:14,
                  outline:"none", boxSizing:"border-box", marginBottom:10 }}
              />
              <button onClick={signInWithEmail}
                disabled={sending || !email.trim()} style={{
                width:"100%", padding:"13px 0", borderRadius:6, border:"none",
                background: sending || !email.trim() ? "#2a2a2a" : C.amber,
                color: sending || !email.trim() ? C.muted : "#000",
                fontFamily:"Inter,sans-serif", fontSize:14, fontWeight:800,
                cursor: sending || !email.trim() ? "not-allowed" : "pointer" }}>
                {sending ? "Sending..." : "Send Magic Link →"}
              </button>
            </div>
          )}

          <div style={{ fontFamily:"Inter,sans-serif", fontSize:11,
            color:C.muted, textAlign:"center", marginTop:20 }}>
            No password · No spam
          </div>
        </>
      )}
    </div>
  );
}

// Step 2 — Signed in, new player: ask for name
function NameStep({ team, onSubmit, loading, error, prefillName }) {
  const [name, setName] = useState(prefillName || "");

  return (
    <div style={{ padding:24, flex:1 }}>
      <div style={{ fontFamily:"Inter,sans-serif", fontSize:14,
        color:C.muted, marginBottom:20, lineHeight:1.6 }}>
        Almost there — what should we call you in the squad?
      </div>
      <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700,
        color:C.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>
        Your Name
      </div>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key==="Enter" && name.trim() && onSubmit(name.trim())}
        placeholder="e.g. Dave"
        autoFocus
        style={{ width:"100%", padding:"14px 16px", borderRadius:6,
          border:`1.5px solid ${name.trim()?C.amber:C.border}`,
          background:"#0a0a0a", color:C.text,
          fontFamily:"Inter,sans-serif", fontSize:16, fontWeight:500,
          outline:"none", boxSizing:"border-box", marginBottom:16,
          transition:"border-color 0.2s" }}
      />
      {error && (
        <div style={{ padding:"10px 14px", borderRadius:6, background:C.red+"18",
          border:`1px solid ${C.red}44`, fontFamily:"Inter,sans-serif",
          fontSize:13, color:C.red, marginBottom:16 }}>{error}</div>
      )}
      <button
        onClick={() => name.trim() && onSubmit(name.trim())}
        disabled={loading || !name.trim()}
        style={{ width:"100%", padding:"15px 0", borderRadius:6, border:"none",
          background: loading || !name.trim() ? "var(--s3)" : "var(--gold)",
          color: loading || !name.trim() ? "var(--t2)" : "var(--bg)",
          fontFamily:"Inter,sans-serif", fontSize:15, fontWeight:800,
          cursor: loading || !name.trim() ? "not-allowed" : "pointer" }}>
        {loading ? "Joining..." : `Join ${team.name} →`}
      </button>
      <div style={{ fontFamily:"Inter,sans-serif", fontSize:11,
        color:C.muted, textAlign:"center", marginTop:16 }}>
        Takes 10 seconds — no password needed
      </div>
    </div>
  );
}

// Main JoinTeam component — orchestrates the steps
export default function JoinTeam({ team, authUser, onNameSubmit, loading, error, prefillName, checking }) {
  useEffect(() => {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone =
      window.navigator.standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches;
    if (isIOS && !isStandalone) {
      const path = window.location.pathname;
      localStorage.setItem("ioo_redirect_to", JSON.stringify({ path, ts: Date.now() }));
    }
  }, []);

  return (
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
      maxWidth:430, margin:"0 auto", fontFamily:"Inter,sans-serif",
      display:"flex", flexDirection:"column" }}>
      <InstallBanner/>

      {/* Header */}
      <div style={{ padding:"24px 24px 20px", background:"#0f0f0f",
        borderBottom:`1px solid ${C.border}` }}>
        <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:28, letterSpacing:3 }}>
          <span style={{ color:"var(--green)" }}>I</span>
          <span style={{ color:"var(--t1)" }}>n or </span>
          <span style={{ color:"var(--red)" }}>O</span>
          <span style={{ color:"var(--t1)" }}>ut</span>
        </div>
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:13,
          color:C.muted, marginTop:4 }}>
          You've been invited to join{" "}
          <strong style={{ color:C.text }}>{team.name}</strong>
        </div>
      </div>

      {/* Steps */}
      {!authUser
        ? <SignInStep team={team}/>
        : checking
          ? <div style={{ display:"flex", justifyContent:"center", padding:40 }}>
              <div style={{ fontSize:32 }}>⚽</div>
            </div>
          : <NameStep team={team} onSubmit={onNameSubmit} loading={loading} error={error} prefillName={prefillName}/>
      }
    </div>
  );
}
