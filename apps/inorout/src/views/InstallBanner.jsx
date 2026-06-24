import { useState, useEffect } from "react";
import { colors as C } from "@platform/core";

const DISMISSED_KEY = "ioo_install_dismissed";

const IOS_STEPS = [
  {
    icon: "⬆️",
    title: "Tap the Share button",
    desc: "Tap the Share icon at the bottom of Safari — the box with an arrow pointing up.",
  },
  {
    icon: "📲",
    title: "Add to Home Screen",
    desc: 'Scroll down in the Share menu and tap "Add to Home Screen".',
  },
  {
    icon: "✅",
    title: "Tap Add to confirm",
    desc: 'Tap "Add" in the top-right corner to add In or Out to your home screen.',
  },
  {
    icon: "⚽",
    title: "Open from your home screen",
    desc: "You're all set! Tap the In or Out icon on your home screen to launch.",
  },
];

export default function InstallBanner() {
  const [show,           setShow]      = useState(false);
  const [deferredPrompt, setDeferred]  = useState(null);
  const [isIOS,          setIsIOS]     = useState(false);
  const [showModal,      setShowModal] = useState(false);
  const [modalStep,      setModalStep] = useState(0);

  useEffect(() => {
    if (localStorage.getItem(DISMISSED_KEY)) return;
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    if (window.navigator.standalone) return;

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIsIOS(ios);

    if (ios) {
      setTimeout(() => setShow(true), 3000);
    } else {
      window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        setDeferred(e);
        setTimeout(() => setShow(true), 3000);
      });
    }
  }, []);

  const dismiss = () => {
    setShow(false);
    setShowModal(false);
    localStorage.setItem(DISMISSED_KEY, "1");
  };

  const install = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") dismiss();
  };

  if (!show) return null;

  return (
    <>
      {/* Fixed bottom banner */}
      <div style={{
        position:"fixed", bottom:0, left:0, right:0, zIndex:100,
        maxWidth:430, margin:"0 auto",
        background:C.surface, borderTop:`2px solid ${C.amber}`,
        padding:"14px 18px 20px",
        display:"flex", alignItems:"center", gap:12,
      }}>
        <div style={{ width:36, height:36, borderRadius:8, background:C.amber,
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:18, flexShrink:0 }}>⚽</div>

        <div style={{ flex:1 }}>
          <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:13, fontWeight:700,
            color:C.text, marginBottom:2 }}>Add to Home Screen</div>
          <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:12, color:C.muted }}>
            Install for quick access — works like a native app
          </div>
        </div>

        {isIOS ? (
          <button onClick={() => { setModalStep(0); setShowModal(true); }} style={{
            padding:"6px 12px", borderRadius:5,
            border:`1px solid ${C.amber}`, background:C.amber+"18", color:C.amber,
            fontFamily:"'DM Sans', sans-serif", fontSize:12, fontWeight:700,
            cursor:"pointer", flexShrink:0,
          }}>How to</button>
        ) : deferredPrompt ? (
          <button onClick={install} style={{
            padding:"6px 12px", borderRadius:5,
            border:"none", background:C.amber, color:C.black,
            fontFamily:"'DM Sans', sans-serif", fontSize:12, fontWeight:700,
            cursor:"pointer", flexShrink:0,
          }}>Install</button>
        ) : null}

        <button onClick={dismiss} style={{
          background:"none", border:"none", color:C.muted,
          fontSize:22, cursor:"pointer", padding:0, lineHeight:1, flexShrink:0,
        }}>×</button>
      </div>

      {/* iOS install tutorial modal */}
      {showModal && (
        <div
          onClick={() => setShowModal(false)}
          style={{
            position:"fixed", inset:0, zIndex:200,
            background:"rgba(0,0,0,0.75)",
            display:"flex", alignItems:"flex-end", justifyContent:"center",
          }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position:"relative",
              width:"100%", maxWidth:430,
              background:C.surface,
              borderRadius:"16px 16px 0 0",
              borderTop:`2px solid ${C.amber}`,
              padding:"24px 24px 36px",
            }}>

            {/* Close */}
            <button onClick={() => setShowModal(false)} style={{
              position:"absolute", top:14, right:18,
              background:"none", border:"none", color:C.muted,
              fontSize:22, cursor:"pointer", padding:0, lineHeight:1,
            }}>×</button>

            {/* Step content */}
            <div style={{ textAlign:"center", padding:"4px 0 24px" }}>
              <div style={{ fontSize:52, marginBottom:12 }}>
                {IOS_STEPS[modalStep].icon}
              </div>
              <div style={{ fontFamily:"Bebas Neue,sans-serif", fontSize:22,
                color:C.amber, letterSpacing:1.5, marginBottom:10 }}>
                {IOS_STEPS[modalStep].title}
              </div>
              <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:14,
                color:C.muted, lineHeight:1.6, maxWidth:280, margin:"0 auto" }}>
                {IOS_STEPS[modalStep].desc}
              </div>
            </div>

            {/* Step dots */}
            <div style={{ display:"flex", justifyContent:"center", gap:6, marginBottom:20 }}>
              {IOS_STEPS.map((_, i) => (
                <button key={i} onClick={() => setModalStep(i)} style={{
                  width: i === modalStep ? 20 : 8,
                  height:8, borderRadius:4,
                  background: i === modalStep ? C.amber : C.border,
                  border:"none", padding:0, cursor:"pointer",
                  transition:"width 0.2s, background 0.2s",
                }}/>
              ))}
            </div>

            {/* Nav */}
            <div style={{ display:"flex", gap:8 }}>
              {modalStep > 0 && (
                <button onClick={() => setModalStep(s => s - 1)} style={{
                  flex:1, padding:"12px 0", borderRadius:6,
                  border:`1px solid ${C.border}`, background:"transparent", color:C.muted,
                  fontFamily:"'DM Sans', sans-serif", fontSize:14, fontWeight:600, cursor:"pointer",
                }}>← Back</button>
              )}
              {modalStep < IOS_STEPS.length - 1 ? (
                <button onClick={() => setModalStep(s => s + 1)} style={{
                  flex:1, padding:"12px 0", borderRadius:6,
                  border:"none", background:C.amber, color:C.black,
                  fontFamily:"'DM Sans', sans-serif", fontSize:14, fontWeight:700, cursor:"pointer",
                }}>Next →</button>
              ) : (
                <button onClick={() => setShowModal(false)} style={{
                  flex:1, padding:"12px 0", borderRadius:6,
                  border:"none", background:C.green, color:C.black,
                  fontFamily:"'DM Sans', sans-serif", fontSize:14, fontWeight:700, cursor:"pointer",
                }}>Got it ✓</button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
