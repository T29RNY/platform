import { useEffect, useState } from "react";
import { colors as C } from "@platform/core";
import { supabase } from "@platform/supabase";

export default function AuthCallback() {
  const [status, setStatus] = useState("processing");

  useEffect(() => {
    async function handle() {
      try {
        // Supabase handles the session from the URL automatically
        const { data, error } = await supabase.auth.getSession();

        if (error) throw error;

        // Get where they were trying to go
        const returnTo = localStorage.getItem("auth_return_to") || "/";
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
