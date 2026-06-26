import { useEffect, useState } from "react";
import { colors as C } from "@platform/core";
import { supabase, updateUserProfile, getCompanyByDomain } from "@platform/core/storage/supabase.js";

// How long to wait for the session to materialise from the URL before giving up.
// supabase-js parses the PKCE `?code=` / implicit `#access_token` out of the URL
// on a microtask AFTER the client initialises; on a flaky WKWebView that can land
// a beat after our first getSession() read returns null. We wait for the SIGNED_IN
// event rather than redirecting on a null session — redirecting logged-out here is
// the exact "signed in, then logged out" App Store 2.1(a) symptom. If the wait
// elapses with no session we show an error with a way home, never a silent logout.
const SESSION_WAIT_MS = 8000;

export default function AuthCallback() {
  const [status, setStatus] = useState("processing");

  useEffect(() => {
    let settled = false;
    let sub = null;
    let timer = null;

    const cleanup = () => {
      if (sub) { try { sub.unsubscribe(); } catch (e) { /* noop */ } sub = null; }
      if (timer) { clearTimeout(timer); timer = null; }
    };

    // Runs exactly once, the moment a real session exists (immediately on the happy
    // path, or when SIGNED_IN fires after the URL is consumed).
    async function finish(user) {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (user) {
          const display_name =
            user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            user.email;
          try { await updateUserProfile(user.id, { display_name }); } catch (e) { /* non-fatal */ }

          // Phase 0F — resolve email domain to a company for HQ admin routing.
          // No-op for everyone today (table empty until HQ domains seed in Phase 6).
          // Defensive: any error here MUST NOT break sign-in.
          try {
            const email = user.email || "";
            const domain = email.split("@")[1];
            if (domain) {
              const company = await getCompanyByDomain(domain);
              if (company?.company_id) {
                sessionStorage.setItem("ioo_company_id", company.company_id);
              }
            }
          } catch (e) { /* non-fatal */ }
        }

        let returnTo = null;

        // ioo_pending_route — /create and other auth-gated routes
        try {
          const pendingRoute = sessionStorage.getItem('ioo_pending_route');
          if (pendingRoute) {
            sessionStorage.removeItem('ioo_pending_route');
            returnTo = pendingRoute;
          }
        } catch (e) { /* noop */ }

        // ioo_pending_join — survives the redirect regardless of whether Supabase
        // preserves the returnTo query param (URL allowlist doesn't include wildcards)
        if (!returnTo) {
          try {
            const pending = sessionStorage.getItem("ioo_pending_join");
            if (pending) {
              const { returnTo: r } = JSON.parse(pending);
              sessionStorage.removeItem("ioo_pending_join");
              returnTo = r;
            }
          } catch (e) { /* noop */ }
        }

        // Fallback: URL param, then localStorage, then root
        if (!returnTo) {
          const urlParams = new URLSearchParams(window.location.search);
          const returnToParam = urlParams.get("returnTo");
          returnTo = returnToParam
            ? decodeURIComponent(returnToParam)
            : localStorage.getItem("auth_return_to") || "/";
        }
        localStorage.removeItem("auth_return_to");

        // Hardening (unified login): a generic sign-in (no explicit deep-link, so
        // returnTo defaulted to "/") must land on the fresh account landing — NOT
        // resume a stale breadcrumb left in localStorage (e.g. a demo /p/ link
        // opened earlier, which otherwise bounces the user around after sign-in).
        // Explicit destinations (pending route/join, ?returnTo=) are honoured and
        // never cleared.
        if (returnTo === "/") {
          try {
            localStorage.removeItem("ioo_redirect_to");
            localStorage.removeItem("ioo_last_visited");
            localStorage.removeItem("ioo_last_context");
          } catch (e) { /* storage unavailable — non-fatal */ }
        }

        setStatus("success");
        setTimeout(() => {
          window.location.replace(returnTo);
        }, 800);
      } catch (err) {
        console.error("Auth callback error:", err);
        setStatus("error");
      }
    }

    async function handle() {
      try {
        // Fast-fail: the provider explicitly returned an error (e.g. the user
        // cancelled). No session is coming — don't sit through the wait.
        const qsErr = new URLSearchParams(window.location.search).get("error");
        const hashErr = new URLSearchParams(
          (window.location.hash || "").replace(/^#/, "")
        ).get("error");
        if (qsErr || hashErr) {
          settled = true;
          console.error("Auth callback: provider returned error", qsErr || hashErr);
          setStatus("error");
          return;
        }

        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        // Happy path — the session is already established (the SDK's URL-detection
        // ran under the same lock getSession awaits). Finish immediately.
        if (data.session?.user) { finish(data.session.user); return; }

        // No session yet — supabase-js may still be consuming the URL hash/code.
        // Wait for SIGNED_IN instead of redirecting logged-out.
        const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
          if (session?.user) finish(session.user);
        });
        sub = listener?.subscription || null;

        timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          console.error("Auth callback: no session established after wait");
          setStatus("error");
        }, SESSION_WAIT_MS);
      } catch (err) {
        console.error("Auth callback error:", err);
        setStatus("error");
      }
    }

    handle();
    return cleanup;
  }, []);

  return (
    <div style={{ background:C.bg, minHeight:"100dvh", display:"flex",
      flexDirection:"column", alignItems:"center", justifyContent:"center",
      gap:16, fontFamily:"'DM Sans', sans-serif" }}>
      {status === "processing" && <>
        <div style={{ fontSize:40 }}>⚽</div>
        <div style={{ fontSize:14, color:C.muted }}>Signing you in...</div>
      </>}
      {status === "success" && <>
        <div style={{ fontSize:40 }}>✅</div>
        <div style={{ fontSize:14, color:C.green }}>Signed in — redirecting...</div>
      </>}
      {status === "error" && <>
        <div style={{ fontSize:40 }}>⚠️</div>
        <div style={{ fontSize:14, color:C.red, textAlign:"center" }}>
          Something went wrong.<br/>
          <a href="/" style={{ color:C.amber }}>Go back to home</a>
        </div>
      </>}
    </div>
  );
}
