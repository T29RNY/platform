import { useEffect, useState } from "react";
import { colors as C } from "@platform/core";
import { supabase, updateUserProfile } from "@platform/supabase";

export default function AuthCallback() {
  const [status, setStatus] = useState("processing");

  useEffect(() => {
    async function handle() {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        const user = data.session?.user;
        if (user) {
          const display_name =
            user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            user.email;
          try { await updateUserProfile(user.id, { display_name }); } catch(e) {}
        }

        // Primary: sessionStorage pendingJoin survives the redirect regardless of
        // whether Supabase preserves the returnTo query param (URL allowlist)
        let returnTo = null;
        try {
          const pending = sessionStorage.getItem("ioo_pending_join");
          if (pending) {
            const { returnTo: r } = JSON.parse(pending);
            sessionStorage.removeItem("ioo_pending_join");
            returnTo = r;
          }
        } catch(e) {}

        // Fallback: URL param, then localStorage, then root
        if (!returnTo) {
          const urlParams = new URLSearchParams(window.location.search);
          const returnToParam = urlParams.get("returnTo");
          returnTo = returnToParam
            ? decodeURIComponent(returnToParam)
            : localStorage.getItem("auth_return_to") || "/";
        }
        localStorage.removeItem("auth_return_to");

        setStatus("success");
        setTimeout(() => {
          window.location.replace(returnTo);
        }, 800);
      } catch (err) {
        console.error("Auth callback error:", err);
        setStatus("error");
      }
    }
    handle();
  }, []);

  return (
    <div style={{ background:C.bg, minHeight:"100dvh", display:"flex",
      flexDirection:"column", alignItems:"center", justifyContent:"center",
      gap:16, fontFamily:"Inter,sans-serif" }}>
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
