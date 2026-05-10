import { useState } from "react";
import { colors as C } from "@platform/core";
import { ONBOARDING_CONFIG as CFG } from "../config.js";

const BASE_URL = "https://in-or-out.com";

function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button onClick={copy} style={{
      padding:"7px 14px", borderRadius:5,
      border:`1px solid ${copied?C.green:C.border}`,
      background:copied?C.green+"18":"transparent",
      color:copied?C.green:C.muted,
      fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700,
      cursor:"pointer", flexShrink:0, whiteSpace:"nowrap",
    }}>
      {copied ? "✓ Copied" : label||"Copy"}
    </button>
  );
}

function WhatsAppButton({ text }) {
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" style={{
      padding:"7px 14px", borderRadius:5,
      border:`1px solid #25D366`,
      background:"#25D36618",
      color:"#25D366",
      fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:700,
      cursor:"pointer", flexShrink:0, whiteSpace:"nowrap",
      textDecoration:"none", display:"inline-block",
    }}>
      WhatsApp
    </a>
  );
}

export default function ShareLinks({
  groupName, adminToken, players, onComplete,
}) {
  const adminUrl  = `${BASE_URL}/admin/${adminToken}`;
  const [adminCopied, setAdminCopied] = useState(false);

  const copyAdmin = () => {
    navigator.clipboard.writeText(adminUrl).then(() => {
      setAdminCopied(true);
      setTimeout(() => setAdminCopied(false), 2000);
    });
  };

  return (
    <div style={{ padding:24, fontFamily:"Inter,sans-serif" }}>
      {/* Header */}
      <div style={{ textAlign:"center", marginBottom:28 }}>
        <div style={{ fontSize:40, marginBottom:8 }}>🎉</div>
        <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:24,
          color:C.text, letterSpacing:1 }}>
          {CFG.steps.shareLinks.title}
        </div>
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:13,
          color:C.muted, marginTop:6 }}>
          {CFG.steps.shareLinks.subtitle}
        </div>
      </div>

      {/* Admin link */}
      <div style={{ background:C.amber+"0f", border:`1px solid ${C.amber}44`,
        borderRadius:10, padding:16, marginBottom:20 }}>
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:800,
          color:C.amber, letterSpacing:1, textTransform:"uppercase", marginBottom:4 }}>
          ⚙️ Your Admin Link — Keep This Private
        </div>
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:12, color:C.muted,
          marginBottom:10, lineHeight:1.4 }}>
          This is how you manage the team. Bookmark it now.
        </div>
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:12, color:C.text,
          background:"#0a0a0a", padding:"10px 12px", borderRadius:6,
          border:`1px solid ${C.border}`, marginBottom:10,
          wordBreak:"break-all" }}>
          {adminUrl}
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={copyAdmin} style={{
            flex:1, padding:"10px 0", borderRadius:6,
            border:`1px solid ${adminCopied?C.green:C.amber}`,
            background:adminCopied?C.green+"18":C.amber+"18",
            color:adminCopied?C.green:C.amber,
            fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:700, cursor:"pointer",
          }}>
            {adminCopied?"✓ Copied":"Copy Admin Link"}
          </button>
        </div>
      </div>

      {/* Player links */}
      {players.length > 0 && (
        <div style={{ marginBottom:24 }}>
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:11, fontWeight:800,
            color:C.muted, letterSpacing:1, textTransform:"uppercase", marginBottom:12 }}>
            Player Links — Share These via WhatsApp
          </div>
          {players.map(p => {
            const playerUrl = `${BASE_URL}/p/${p.token}`;
            const waMsg = CFG.whatsappMessage(groupName, playerUrl);
            return (
              <div key={p.id} style={{ display:"flex", alignItems:"center",
                gap:10, padding:"12px 0", borderBottom:`1px solid ${C.border}` }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontFamily:"Inter,sans-serif", fontSize:14,
                    fontWeight:600, color:C.text }}>{p.name}</div>
                  <div style={{ fontFamily:"Inter,sans-serif", fontSize:11,
                    color:C.muted, marginTop:2, wordBreak:"break-all" }}>
                    {playerUrl}
                  </div>
                </div>
                <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                  <CopyButton text={playerUrl}/>
                  <WhatsAppButton text={waMsg}/>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {players.length === 0 && (
        <div style={{ padding:"14px 16px", borderRadius:8, background:C.surface,
          border:`1px solid ${C.border}`, marginBottom:20,
          fontFamily:"Inter,sans-serif", fontSize:13, color:C.muted }}>
          You skipped adding players. You can add them from your Admin dashboard.
        </div>
      )}

      {/* Go to dashboard */}
      <a href={adminUrl} style={{ display:"block" }}>
        <button style={{
          width:"100%", padding:"15px 0", borderRadius:6, border:"none",
          background:C.amber, color:"#000",
          fontFamily:"Inter,sans-serif", fontSize:15, fontWeight:800,
          cursor:"pointer", letterSpacing:0.5,
        }}>
          {CFG.steps.shareLinks.cta}
        </button>
      </a>
    </div>
  );
}
