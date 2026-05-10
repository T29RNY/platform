import { useEffect, useState } from "react";
import { colors as C } from "@platform/core";
import { supabase } from "@platform/supabase";

// This page handles the redirect back from Google/Apple/Email auth
// URL: in-or-out.com/auth/callback
export default function AuthCallback() {
  const [status, setStatus] = useState("processing");

  useEffect(() => {
    async function handle() {
      try {
        // Exchange the code for a session
        const { data, error } = await supabase.auth.exchangeCodeForSession(
          window.location.search
        );

        if (error) throw error;

        // Get where they were trying to go (stored before auth)
        const returnTo = localStorage.getItem("auth_return_to") || "/";
        localStorage.removeItem("auth_return_to");

        setStatus("success");
        setTimeout(() => {
          window.location.href = returnTo;
        }, 500);
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
