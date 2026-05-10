import { useState } from "react";
import { colors as C } from "@platform/core";

const BASE_URL = "https://in-or-out.com";

export default function JoinSuccess({ playerName, playerToken, teamName }) {
  const [copied, setCopied] = useState(false);
  const link = `${BASE_URL}/p/${playerToken}`;

  const copy = () => {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const whatsapp = () => {
    const msg = `Hey! I just joined ${teamName} on In or Out.\n\nMy link: ${link}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`);
  };

  return (
    <div style={{ background:C.bg, minHeight:"100dvh", color:C.text,
      maxWidth:430, margin:"0 auto", fontFamily:"Inter,sans-serif",
      display:"flex", flexDirection:"column", alignItems:"center",
      justifyContent:"center", padding:24 }}>

      <div style={{ fontSize:52, marginBottom:16 }}>🎉</div>
      <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:28,
        color:C.amber, letterSpacing:2, marginBottom:4, textAlign:"center" }}>
        YOU'RE IN, {playerName.toUpperCase()}!
      </div>
      <div style={{ fontFamily:"Inter,sans-serif", fontSize:13, color:C.muted,
        textAlign:"center", marginBottom:32, lineHeight:1.5 }}>
        You've joined {teamName}.<br/>
        Bookmark your personal link below — you'll use it every week.
      </div>

      {/* Link box */}
      <div style={{ width:"100%", background:C.surface, borderRadius:8,
        border:`1px solid ${C.border}`, padding:16, marginBottom:16 }}>
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700,
          color:C.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:8 }}>
          Your Personal Link
        </div>
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:12, color:C.text,
          background:"#0a0a0a", padding:"10px 12px", borderRadius:6,
          border:`1px solid ${C.border}`, marginBottom:12,
          wordBreak:"break-all" }}>
          {link}
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={copy} style={{ flex:1, padding:"10px 0", borderRadius:6,
            border:`1px solid ${copied?C.green:C.amber}`,
            background:copied?C.green+"18":C.amber+"18",
            color:copied?C.green:C.amber,
            fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:700, cursor:"pointer" }}>
            {copied?"✓ Copied!":"Copy Link"}
          </button>
          <button onClick={whatsapp} style={{ flex:1, padding:"10px 0", borderRadius:6,
            border:"1px solid #25D366", background:"#25D36618", color:"#25D366",
            fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:700, cursor:"pointer" }}>
            Share on WhatsApp
          </button>
        </div>
      </div>

      {/* Go to app */}
      <a href={link} style={{ display:"block", width:"100%" }}>
        <button style={{ width:"100%", padding:"15px 0", borderRadius:6,
          border:"none", background:C.amber, color:"#000",
          fontFamily:"Inter,sans-serif", fontSize:15, fontWeight:800,
          cursor:"pointer" }}>
          Open My View →
        </button>
      </a>
    </div>
  );
}
