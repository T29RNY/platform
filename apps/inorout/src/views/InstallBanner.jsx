import { useState, useEffect } from "react";
import { colors as C } from "@platform/core";

const DISMISSED_KEY = "ioo_install_dismissed";

export default function InstallBanner() {
  const [show,        setShow]        = useState(false);
  const [deferredPrompt, setDeferred] = useState(null);
  const [isIOS,       setIsIOS]       = useState(false);

  useEffect(() => {
    // Don't show if already dismissed
    if (localStorage.getItem(DISMISSED_KEY)) return;

    // Don't show if already installed as PWA
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    if (window.navigator.standalone) return;

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIsIOS(ios);

    if (ios) {
      // Show iOS instructions after 3 seconds
      setTimeout(() => setShow(true), 3000);
    } else {
      // Listen for Chrome/Android install prompt
      window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        setDeferred(e);
        setTimeout(() => setShow(true), 3000);
      });
    }
  }, []);

  const dismiss = () => {
    setShow(false);
    localStorage.setItem(DISMISSED_KEY, "1");
  };

  const install = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") dismiss();
    }
  };

  if (!show) return null;

  return (
    <div style={{
      position:"fixed", bottom:0, left:0, right:0, zIndex:100,
      maxWidth:430, margin:"0 auto",
      background:"#1a1a1a", borderTop:`1px solid ${C.amber}`,
      padding:"14px 18px", display:"flex", alignItems:"flex-start", gap:12,
    }}>
      {/* Icon */}
      <div style={{ width:40, height:40, borderRadius:10, background:C.amber,
        display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:22, flexShrink:0 }}>⚽</div>

      {/* Text */}
      <div style={{ flex:1 }}>
        <div style={{ fontFamily:"Inter,sans-serif", fontSize:13, fontWeight:700,
          color:C.text, marginBottom:3 }}>Add to Home Screen</div>
        {isIOS ? (
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:12, color:C.muted, lineHeight:1.4 }}>
            Tap <strong style={{ color:C.text }}>Share</strong> then{" "}
            <strong style={{ color:C.text }}>"Add to Home Screen"</strong> for the best experience
          </div>
        ) : (
          <div style={{ fontFamily:"Inter,sans-serif", fontSize:12, color:C.muted }}>
            Install for quick access — works like a native app
          </div>
        )}
        {!isIOS && deferredPrompt && (
          <button onClick={install} style={{
            marginTop:8, padding:"6px 14px", borderRadius:5,
            border:"none", background:C.amber, color:"#000",
            fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:700, cursor:"pointer"
          }}>Install</button>
        )}
      </div>

      {/* Dismiss */}
      <button onClick={dismiss} style={{
        background:"none", border:"none", color:C.muted,
        fontSize:20, cursor:"pointer", padding:0, lineHeight:1, flexShrink:0
      }}>×</button>
    </div>
  );
}
