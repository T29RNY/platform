import { useState, useRef, useEffect } from "react";
import { supabase } from "@platform/core/storage/supabase.js";
import { EnvelopeSimple, PaperPlaneTilt, User } from "@phosphor-icons/react";
import { startOAuth } from "../native/native-auth.js";

const BASE_URL = typeof window !== "undefined"
  ? `${window.location.protocol}//${window.location.host}`
  : "https://app.in-or-out.com";

function JoinStyles() {
  return (
    <style>{`
      .join-shell {
        min-height: 100dvh;
        width: 100%;
        position: relative;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: max(28px, env(safe-area-inset-top)) 20px max(28px, env(safe-area-inset-bottom));
        background: var(--bg);
        color: var(--t1);
        font-family: "DM Sans", sans-serif;
      }

      .join-shell--checking {}

      .join-orb {
        position: absolute;
        width: 220px;
        height: 220px;
        border-radius: 999px;
        filter: blur(54px);
        opacity: 0.32;
        pointer-events: none;
      }

      .join-orb--green {
        top: 12%;
        left: -120px;
        background: rgba(61, 220, 106, 0.28);
      }

      .join-orb--red {
        top: 8%;
        right: -130px;
        background: rgba(255, 64, 64, 0.22);
      }

      .join-orb--gold {
        bottom: -110px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(232, 160, 32, 0.24);
      }

      .join-inner {
        width: 100%;
        max-width: 410px;
        position: relative;
        z-index: 2;
      }

      .join-brand {
        display: block;
        text-align: center;
        font-family: "Bebas Neue", sans-serif;
        font-size: clamp(64px, 17vw, 92px);
        line-height: 0.9;
        letter-spacing: 0.045em;
        color: var(--t1);
        text-transform: uppercase;
        user-select: none;
      }

      .join-brand--small {
        font-size: clamp(32px, 10vw, 44px);
        letter-spacing: 0.07em;
        margin-bottom: 48px;
      }

      .join-brand--quiet {
        animation: joinQuietPulse 1.8s ease-in-out infinite;
      }

      .join-brand__green {
        color: var(--green);
        text-shadow: 0 0 24px rgba(61, 220, 106, 0.48);
      }

      .join-brand__red {
        color: var(--red);
        text-shadow: 0 0 24px rgba(255, 64, 64, 0.42);
      }

      @keyframes joinQuietPulse {
        0%, 100% { opacity: 0.62; transform: scale(0.985); }
        50%       { opacity: 1;    transform: scale(1);     }
      }

      .join-auth-card {
        width: 100%;
        text-align: center;
      }

      .join-invite-label {
        font-family: "DM Sans", sans-serif;
        font-weight: 300;
        font-size: 14px;
        color: var(--t2);
        margin: 32px 0 6px;
        letter-spacing: 0.04em;
      }

      .join-invite-title {
        font-family: "Bebas Neue", sans-serif;
        font-size: clamp(32px, 9vw, 44px);
        line-height: 1;
        letter-spacing: 0.045em;
        font-weight: 400;
        color: var(--gold);
        text-transform: uppercase;
        margin: 0 0 36px;
        text-shadow: 0 0 28px rgba(232, 160, 32, 0.22);
      }

      .join-google-btn {
        width: 100%;
        min-height: 56px;
        border-radius: 14px;
        border: 1px solid rgba(232, 160, 32, 0.4);
        background: var(--s1);
        color: var(--t1);
        font-family: "DM Sans", sans-serif;
        font-size: 15px;
        font-weight: 600;
        letter-spacing: 0.01em;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        -webkit-tap-highlight-color: transparent;
        transition: transform 160ms ease, opacity 160ms ease;
      }

      .join-google-btn:active  { transform: scale(0.98); }
      .join-google-btn:disabled { opacity: 0.48; cursor: not-allowed; }

      /* Apple — HIG: ≥ as prominent as Google. Solid near-white fill (vs the
         Google button's surface fill + amber hairline), placed first. */
      .join-apple-btn {
        width: 100%;
        min-height: 56px;
        margin-bottom: 12px;
        border-radius: 14px;
        border: none;
        background: var(--t1);
        color: var(--bg);
        font-family: "DM Sans", sans-serif;
        font-size: 15px;
        font-weight: 600;
        letter-spacing: 0.01em;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        -webkit-tap-highlight-color: transparent;
        transition: transform 160ms ease, opacity 160ms ease;
      }
      .join-apple-btn:active  { transform: scale(0.98); }
      .join-apple-btn:disabled { opacity: 0.48; cursor: not-allowed; }

      .join-divider {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 20px 0;
        width: 100%;
      }

      .join-divider-line {
        flex: 1;
        height: 0.5px;
        background: rgba(242, 240, 234, 0.12);
      }

      .join-divider-text {
        font-family: "DM Sans", sans-serif;
        font-size: 11px;
        font-weight: 300;
        color: var(--t2);
        letter-spacing: 0.08em;
      }

      .join-email-link {
        background: transparent;
        border: none;
        color: var(--gold);
        font-family: "DM Sans", sans-serif;
        font-size: 14px;
        font-weight: 400;
        text-decoration: underline;
        text-underline-offset: 4px;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        padding: 8px 10px;
      }

      .join-email-form {
        display: grid;
        gap: 14px;
        width: 100%;
        margin-top: 18px;
        animation: joinReveal 180ms ease-out both;
      }

      .join-field {
        min-height: 56px;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 0 16px;
        border-radius: 14px;
        background: var(--s1);
        border: 1px solid rgba(208, 204, 194, 0.17);
        color: var(--t2);
        transition: border-color 160ms ease, box-shadow 160ms ease;
      }

      .join-field:focus-within {
        border-color: rgba(232, 160, 32, 0.78);
        box-shadow: 0 0 0 3px rgba(232, 160, 32, 0.10);
      }

      .join-field input {
        width: 100%;
        min-width: 0;
        border: 0;
        outline: 0;
        background: transparent;
        color: var(--t1);
        font-family: "DM Sans", sans-serif;
        font-size: 16px;
        font-weight: 400;
        -webkit-appearance: none;
        appearance: none;
      }

      .join-field input::placeholder {
        color: var(--t2);
        opacity: 0.64;
      }

      .join-secondary-btn {
        width: 100%;
        min-height: 56px;
        border-radius: 14px;
        border: 1px solid rgba(232, 160, 32, 0.28);
        background: var(--s2);
        color: var(--gold);
        font-family: "DM Sans", sans-serif;
        font-size: 15px;
        font-weight: 600;
        letter-spacing: 0.01em;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 9px;
        -webkit-tap-highlight-color: transparent;
        transition: transform 160ms ease, opacity 160ms ease;
      }

      .join-secondary-btn:disabled { opacity: 0.48; cursor: not-allowed; }

      .join-email-link--muted {
        color: var(--t2);
        opacity: 0.72;
        text-decoration: none;
        margin-top: 4px;
      }

      .join-sent-box {
        width: 100%;
        margin-top: 32px;
        text-align: center;
      }

      .join-sent-title {
        font-family: "Bebas Neue", sans-serif;
        font-size: 28px;
        letter-spacing: 0.06em;
        color: var(--gold);
        margin: 0 0 12px;
      }

      .join-sent-body {
        font-family: "DM Sans", sans-serif;
        font-weight: 300;
        font-size: 14px;
        color: var(--t2);
        line-height: 1.5;
        margin: 0 0 12px;
      }

      .join-sent-email {
        color: var(--t1);
        font-weight: 400;
      }

      .join-sent-warn {
        font-family: "DM Sans", sans-serif;
        font-weight: 300;
        font-size: 12px;
        color: var(--t2);
        opacity: 0.6;
        line-height: 1.5;
        margin: 0 0 20px;
      }

      .join-error {
        margin: 16px 0 0;
        color: var(--red);
        font-family: "DM Sans", sans-serif;
        font-size: 13px;
        line-height: 1.45;
      }

      @keyframes joinReveal {
        from { opacity: 0; transform: translateY(-4px); }
        to   { opacity: 1; transform: translateY(0);    }
      }

      .join-name-card {
        width: 100%;
        text-align: left;
      }

      .join-name-title {
        font-family: "Bebas Neue", sans-serif;
        font-size: clamp(46px, 13vw, 62px);
        line-height: 0.95;
        letter-spacing: 0.045em;
        font-weight: 400;
        color: var(--t1);
        text-transform: uppercase;
        margin: 0 0 32px;
      }

      .join-field--name {
        margin-bottom: 0;
      }

      .join-primary-btn {
        width: 100%;
        min-height: 56px;
        border-radius: 14px;
        border: none;
        background: var(--gold);
        color: var(--bg);
        font-family: "Bebas Neue", sans-serif;
        font-size: 18px;
        letter-spacing: 0.08em;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition: transform 160ms ease, opacity 160ms ease;
        margin-top: 14px;
      }

      .join-primary-btn:disabled {
        opacity: 0.48;
        cursor: not-allowed;
        background: var(--s2);
        color: var(--t2);
      }

      @media (max-width: 380px) {
        .join-shell  { padding-left: 16px; padding-right: 16px; }
        .join-brand  { font-size: clamp(58px, 16vw, 78px); }
        .join-brand--small { font-size: 34px; }
      }
    `}</style>
  );
}

function BrandMark({ size = "large", quiet = false }) {
  const cls = "join-brand"
    + (size === "small" ? " join-brand--small" : "")
    + (quiet ? " join-brand--quiet" : "");
  return (
    <div className={cls}>
      <span className="join-brand__green">I</span>
      N OR{" "}
      <span className="join-brand__red">O</span>
      UT
    </div>
  );
}

function JoinShell({ children, checking = false }) {
  return (
    <main className={"join-shell" + (checking ? " join-shell--checking" : "")}>
      <div className="join-orb join-orb--green" />
      <div className="join-orb join-orb--red" />
      <div className="join-orb join-orb--gold" />
      <div className="join-inner">{children}</div>
    </main>
  );
}

function CheckingState() {
  return (
    <JoinShell checking>
      <BrandMark quiet />
    </JoinShell>
  );
}

function SignInStep({ team, onGoogle, onApple }) {
  const [email,        setEmail]        = useState("");
  const [emailOpen,    setEmailOpen]    = useState(false);
  const [sending,      setSending]      = useState(false);
  const [authError,    setAuthError]    = useState(null);
  const [awaitingCode, setAwaitingCode] = useState(false); // native: enter emailed code
  const [code,         setCode]         = useState("");

  const handleEmailSignIn = async () => {
    if (!email.trim()) return;
    setSending(true); setAuthError(null);
    try {
      // CODE flow on BOTH web and native — the magic link to /auth/callback opens
      // in Safari inside the wrapper (not a universal-link path) and the auth
      // emails are code-only; verifyOtp works everywhere (mirrors AuthGateModal).
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
      setAwaitingCode(true);
    } catch (err) {
      setAuthError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  };

  // NATIVE code verification → route through /auth/callback, preserving the invite
  // URL as returnTo so the join flow resumes after sign-in.
  const verifyEmailCode = async () => {
    const token = code.trim();
    if (token.length < 6) return;
    setSending(true); setAuthError(null);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(), token, type: "email",
      });
      if (error) throw error;
      const returnTo = encodeURIComponent(window.location.href);
      window.location.assign(`/auth/callback?returnTo=${returnTo}`);
    } catch (err) {
      setAuthError(err.message || "That code didn't work — request a new one.");
      setSending(false);
    }
  };

  return (
    <JoinShell>
      <div className="join-auth-card">
        <BrandMark />
        <p className="join-invite-label">
          You've been invited to join
        </p>
        <h1 className="join-invite-title">
          {team?.name || "your team"}
        </h1>

        {awaitingCode ? (
          <div className="join-sent-box">
            <p className="join-sent-title">Enter your code</p>
            <p className="join-sent-body">
              We emailed a code to{" "}
              <span className="join-sent-email">{email}</span>
            </p>
            <div className="join-email-form">
              <div className="join-field">
                <EnvelopeSimple size={20} weight="thin" aria-hidden="true" />
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={10}
                  placeholder="Code"
                  autoFocus
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  onKeyDown={e => { if (e.key === "Enter") verifyEmailCode(); }}
                  disabled={sending}
                />
              </div>
              <button
                type="button"
                className="join-secondary-btn"
                onClick={verifyEmailCode}
                disabled={sending || code.length < 6}>
                <PaperPlaneTilt size={18} weight="thin" aria-hidden="true" />
                {sending ? "Verifying..." : "Verify"}
              </button>
              {authError && (
                <p className="join-error" role="alert">{authError}</p>
              )}
              <button
                type="button"
                className="join-email-link join-email-link--muted"
                onClick={() => { setAwaitingCode(false); setCode(""); setAuthError(null); }}>
                Use a different email
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              type="button"
              className="join-apple-btn"
              onClick={onApple}>
              <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M17.05 12.04c-.03-2.86 2.34-4.23 2.44-4.3-1.33-1.95-3.41-2.21-4.15-2.24-1.77-.18-3.45 1.04-4.35 1.04-.89 0-2.27-1.01-3.74-.99-1.92.03-3.69 1.12-4.68 2.84-2 3.46-.51 8.58 1.43 11.39.95 1.38 2.08 2.92 3.56 2.87 1.43-.06 1.97-.92 3.7-.92 1.72 0 2.21.92 3.72.89 1.54-.03 2.51-1.4 3.45-2.79 1.09-1.6 1.54-3.15 1.56-3.23-.03-.02-2.99-1.15-3.02-4.55zM14.2 4.38c.79-.96 1.32-2.29 1.18-3.62-1.14.05-2.52.76-3.33 1.72-.73.85-1.37 2.21-1.2 3.51 1.27.1 2.57-.65 3.35-1.61z"/>
              </svg>
              Continue with Apple
            </button>
            <button
              type="button"
              className="join-google-btn"
              onClick={onGoogle}>
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/>
                <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/>
                <path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/>
                <path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/>
              </svg>
              Continue with Google
            </button>
            <div className="join-divider">
              <span className="join-divider-line" />
              <span className="join-divider-text">or</span>
              <span className="join-divider-line" />
            </div>

            {!emailOpen ? (
              <button
                type="button"
                className="join-email-link"
                onClick={() => setEmailOpen(true)}>
                Use email instead
              </button>
            ) : (
              <div className="join-email-form">
                <div className="join-field">
                  <EnvelopeSimple size={20} weight="thin" aria-hidden="true" />
                  <input
                    id="join-email"
                    type="email"
                    value={email}
                    placeholder="Email address"
                    autoComplete="email"
                    inputMode="email"
                    onChange={e => setEmail(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleEmailSignIn(); }}
                    disabled={sending}
                  />
                </div>
                <button
                  type="button"
                  className="join-secondary-btn"
                  onClick={handleEmailSignIn}
                  disabled={sending || !email.trim()}>
                  <PaperPlaneTilt size={18} weight="thin" aria-hidden="true" />
                  {sending ? "Sending..." : "Send me a code"}
                </button>
                <button
                  type="button"
                  className="join-email-link join-email-link--muted"
                  onClick={() => setEmailOpen(false)}
                  disabled={sending}>
                  Back to Google sign in
                </button>
                {authError && (
                  <p className="join-error" role="alert">{authError}</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </JoinShell>
  );
}

function NameStep({ team, onNameSubmit, loading, error }) {
  const [name, setName] = useState("");
  const isSavingRef = useRef(false);

  const teamName = team?.name || "your team";
  const canJoin = name.trim().length > 0 && !loading;

  const handleJoin = () => {
    if (isSavingRef.current) return;
    if (!name.trim()) return;
    isSavingRef.current = true;
    try {
      onNameSubmit(name.trim());
    } finally {
      isSavingRef.current = false;
    }
  };

  return (
    <JoinShell>
      <div className="join-name-card">
        <BrandMark size="small" />
        <h1 className="join-name-title">
          What should we call you?
        </h1>
        <div className="join-field join-field--name">
          <User size={20} weight="thin" aria-hidden="true" />
          <input
            id="join-name"
            type="text"
            value={name}
            placeholder="Your name"
            autoComplete="name"
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && canJoin) handleJoin(); }}
            disabled={loading}
            autoFocus
          />
        </div>
        <button
          type="button"
          className="join-primary-btn"
          onClick={handleJoin}
          disabled={!canJoin}>
          {loading ? "Joining..." : `Join ${teamName}`}
        </button>
        {error ? (
          <p className="join-error" role="alert">{error}</p>
        ) : null}
      </div>
    </JoinShell>
  );
}

export default function JoinTeam({
  team, authUser, onNameSubmit, loading,
  error, prefillName, checking
}) {
  // Local session probe — independent of the parent App.jsx authUser prop.
  // Defense-in-depth against the OAuth redirect-loop bug: after /auth/callback
  // bounces back here, supabase has a valid session in storage but the parent
  // may not have populated authUser yet on first paint. If we render the
  // "Continue with Google" button to a user who is in fact signed in, they
  // tap it, OAuth runs again, and they appear to loop. Holding the sign-in
  // view behind this probe stops that. Once either authUser (from parent)
  // OR localSessionUser (from this probe) is set, we proceed.
  const [localSessionUser, setLocalSessionUser] = useState(null);
  const [sessionProbed, setSessionProbed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data?.session?.user) setLocalSessionUser(data.session.user);
      setSessionProbed(true);
    }).catch(() => {
      if (!cancelled) setSessionProbed(true);
    });
    return () => { cancelled = true; };
  }, []);

  const handleGoogleSignIn = async () => {
    const returnTo = encodeURIComponent(window.location.href);
    await startOAuth("google", {
      redirectTo: `${BASE_URL}/auth/callback?returnTo=${returnTo}`,
    });
  };

  const handleAppleSignIn = async () => {
    const returnTo = encodeURIComponent(window.location.href);
    await startOAuth("apple", {
      redirectTo: `${BASE_URL}/auth/callback?returnTo=${returnTo}`,
    });
  };

  const effectiveAuthUser = authUser || localSessionUser;

  // Until the local probe resolves, do not paint the sign-in screen — that
  // false-negative is what creates the visible "tap, redirect, land on
  // sign-in again, tap, loop" bug.
  if (!effectiveAuthUser && !sessionProbed) return (
    <>
      <JoinStyles />
      <CheckingState />
    </>
  );

  if (!effectiveAuthUser) return (
    <>
      <JoinStyles />
      <SignInStep team={team} onGoogle={handleGoogleSignIn} onApple={handleAppleSignIn} />
    </>
  );

  if (checking) return (
    <>
      <JoinStyles />
      <CheckingState />
    </>
  );

  return (
    <>
      <JoinStyles />
      <NameStep team={team} onNameSubmit={onNameSubmit} loading={loading} error={error} />
    </>
  );
}
