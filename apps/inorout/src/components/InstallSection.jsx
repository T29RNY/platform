import { useState, useRef } from "react";
import { Info } from "@phosphor-icons/react";

// Platform detection — also exported so parents can short-circuit (e.g.
// JoinSuccess redirects standalone users straight past install).
export function detectPlatform() {
  if (window.matchMedia("(display-mode: standalone)").matches) return "installed";
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua) && !window.MSStream) return "ios";
  if (/android/i.test(ua)) return "android";
  return "desktop";
}

const IOS_STEPS = [
  { img: "/ios-install-step1.png", text: "Tap the ··· menu in the bottom bar" },
  { img: "/ios-install-step2.png", text: "Tap Share" },
  { img: "/ios-install-step3.png", text: "Scroll down and tap Add to Home Screen" },
  { img: "/ios-install-step4.png", text: "Tap Add — make sure Open as Web App is on." },
];

function IOSCarousel() {
  const [step, setStep] = useState(0);
  const touchStartX = useRef(null);

  const prev = () => setStep(s => Math.max(0, s - 1));
  const next = () => setStep(s => Math.min(IOS_STEPS.length - 1, s + 1));

  const onTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (dx < -40) next();
    else if (dx > 40) prev();
    touchStartX.current = null;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{
        fontSize: 12, color: "var(--gold)", fontFamily: "'DM Sans', sans-serif",
        fontWeight: 300, textAlign: "center", opacity: 0.85,
        maxWidth: 280, lineHeight: 1.5, marginBottom: 16,
      }}>
        This will enable important notifications for match alerts, teamsheets, POTM voting and more.
      </div>

      <div
        style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <button
          onClick={prev}
          style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 28, color: "var(--t2)", lineHeight: 1,
            visibility: step === 0 ? "hidden" : "visible",
            padding: "0 4px",
          }}
        >
          ‹
        </button>

        <div style={{
          width: 260, height: 220, flexShrink: 0,
          borderRadius: 12, border: "3px solid var(--gold)",
          background: "var(--s1)",
          display: "flex", alignItems: "center", justifyContent: "center",
          overflow: "hidden",
        }}>
          <img
            src={IOS_STEPS[step].img}
            alt={`Step ${step + 1}`}
            style={{ maxWidth: 260, maxHeight: 220, objectFit: "contain", display: "block" }}
          />
        </div>

        <button
          onClick={next}
          style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 28, color: "var(--t2)", lineHeight: 1,
            visibility: step === IOS_STEPS.length - 1 ? "hidden" : "visible",
            padding: "0 4px",
          }}
        >
          ›
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        {IOS_STEPS.map((_, i) => (
          <div key={i} style={{
            width: i === step ? 8 : 6,
            height: i === step ? 8 : 6,
            borderRadius: "50%",
            background: i === step ? "var(--gold)" : "var(--s3)",
            border: i === step ? "none" : "1px solid var(--t2)",
            transition: "all 0.2s ease",
          }} />
        ))}
      </div>

      <div style={{
        fontSize: 11, color: "var(--t2)", fontFamily: "'DM Sans', sans-serif",
        fontWeight: 300, marginBottom: 8,
      }}>
        {step + 1} of {IOS_STEPS.length}
      </div>

      <div style={{
        fontSize: 13, color: "var(--t1)", fontWeight: 300,
        fontFamily: "'DM Sans', sans-serif",
        textAlign: "center", maxWidth: 280, lineHeight: 1.5,
      }}>
        {IOS_STEPS[step].text}
      </div>
    </div>
  );
}

function PlaceholderScreenshot({ width = 140, height = 240 }) {
  return (
    <div style={{
      width, height, borderRadius: 10,
      background: "var(--s2)",
      border: "0.5px dashed rgba(255,255,255,0.12)",
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    }}>
      <span style={{ fontSize: 10, color: "var(--t2)", textAlign: "center", padding: "0 10px", lineHeight: 1.4 }}>
        Add screenshot here
      </span>
    </div>
  );
}

function InstallStep({ num, text }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
        <div style={{
          width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
          background: "var(--gold)", color: "var(--bg)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 700, marginTop: 2,
        }}>
          {num}
        </div>
        <span style={{ fontSize: 14, color: "var(--t1)", fontWeight: 300, lineHeight: 1.4 }}>
          {text}
        </span>
      </div>
      <div style={{ paddingLeft: 36 }}>
        <PlaceholderScreenshot width={140} height={240} />
      </div>
    </div>
  );
}

function NotifInfoRow({ text }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 10,
      background: "rgba(232,160,32,0.06)",
      border: "0.5px solid rgba(232,160,32,0.15)",
      borderRadius: 10, padding: "12px 14px", marginBottom: 8,
    }}>
      <Info size={16} weight="thin" color="var(--gold)" style={{ flexShrink: 0, marginTop: 1 }} />
      <span style={{ fontSize: 11, color: "var(--t2)", fontWeight: 300, lineHeight: 1.4 }}>
        {text}
      </span>
    </div>
  );
}

function AndroidInstructions() {
  return (
    <>
      <InstallStep num={1} text="Tap the menu (⋮) in the top right of Chrome" />
      <InstallStep num={2} text="Tap Install app or Add to Home screen" />
      <NotifInfoRow text="You must open from the installed app icon — not Chrome — to receive notifications" />
    </>
  );
}

function DesktopInstructions({ targetUrl }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(targetUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <>
      <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300, lineHeight: 1.5, marginBottom: 16, textAlign: "center" }}>
        In or Out is designed for mobile — open this link on your phone to install
      </div>

      <button
        onClick={copy}
        style={{
          width: "100%", background: "var(--s2)",
          border: copied ? "0.5px solid var(--green)" : "0.5px solid rgba(255,255,255,0.12)",
          borderRadius: 10, padding: "14px 16px", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, textAlign: "left",
        }}
      >
        <span style={{ fontSize: 12, color: "var(--t1)", fontWeight: 300, wordBreak: "break-all", lineHeight: 1.4 }}>
          {targetUrl}
        </span>
        <span style={{
          fontSize: 11, color: copied ? "var(--green)" : "var(--t2)",
          fontWeight: 500, flexShrink: 0, letterSpacing: "0.05em", textTransform: "uppercase",
        }}>
          {copied ? "Copied!" : "Copy"}
        </span>
      </button>
    </>
  );
}

// Inline install block — no outer shell, no CTA, no skip. Parent screens
// supply their own page chrome and sticky CTA. Returns null when running
// as an installed PWA so the parent can collapse the section cleanly.
export default function InstallSection({ installTargetUrl }) {
  const platform = detectPlatform();
  if (platform === "installed") return null;

  return (
    <section style={{
      width: "100%",
      display: "flex", flexDirection: "column", alignItems: "center",
    }}>
      <div style={{
        fontFamily: "'Bebas Neue', sans-serif", fontSize: 24,
        letterSpacing: "0.05em", color: "var(--gold)", marginBottom: 4,
      }}>
        ADD TO HOME SCREEN
      </div>
      <div style={{
        fontSize: 13, color: "var(--t2)", fontWeight: 300, lineHeight: 1.4,
        textAlign: "center", marginBottom: 20,
      }}>
        So you don't lose your team
      </div>

      {platform === "ios" && <IOSCarousel />}
      {platform === "android" && <AndroidInstructions />}
      {platform === "desktop" && <DesktopInstructions targetUrl={installTargetUrl} />}
    </section>
  );
}
