import { useState, useEffect, useRef } from "react";
import { Info } from "@phosphor-icons/react";

// ── Platform detection ────────────────────────────────────────────────────────
function detectPlatform() {
  if (window.matchMedia("(display-mode: standalone)").matches) return "installed";
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua) && !window.MSStream) return "ios";
  if (/android/i.test(ua)) return "android";
  return "desktop";
}

// ── iOS carousel data ─────────────────────────────────────────────────────────
const IOS_STEPS = [
  {
    img: "/ios-install-step1.png",
    text: "Tap the ··· menu in the bottom bar",
  },
  {
    img: "/ios-install-step2.png",
    text: "Tap Share",
  },
  {
    img: "/ios-install-step3.png",
    text: "Scroll down and tap Add to Home Screen",
  },
  {
    img: "/ios-install-step4.png",
    text: "Tap Add — make sure Open as Web App is on.",
  },
];

// ── iOS install carousel ──────────────────────────────────────────────────────
function IOSCarousel({ playerUrl }) {
  const [step, setStep] = useState(0);
  const touchStartX = useRef(null);

  const prev = () => setStep(s => Math.max(0, s - 1));
  const next = () => setStep(s => Math.min(3, s + 1));

  const onTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (dx < -40) next();
    else if (dx > 40) prev();
    touchStartX.current = null;
  };

  const handleCta = () => {
    window.posthog?.capture("install_screen_cta_tapped", { platform: "ios" });
    window.location.href = playerUrl;
  };

  const handleSkip = () => {
    window.posthog?.capture("install_screen_skipped", { platform: "ios" });
    window.location.href = playerUrl;
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: "100vh",
      background: "var(--bg)", padding: 24, boxSizing: "border-box",
    }}>

      {/* Header */}
      <div style={{
        fontFamily: "'Bebas Neue', sans-serif", fontSize: 28,
        letterSpacing: "0.08em", color: "var(--gold)", marginBottom: 8,
      }}>
        ADD TO HOME SCREEN
      </div>

      {/* Notifications subtitle */}
      <div style={{
        fontSize: 12, color: "var(--gold)", fontFamily: "'DM Sans', sans-serif",
        fontWeight: 300, textAlign: "center", opacity: 0.85,
        maxWidth: 280, lineHeight: 1.5, marginBottom: 16,
      }}>
        This will enable important notifications for match alerts, teamsheets, POTM voting and more.
      </div>

      {/* Carousel row */}
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

        {/* Fixed 280×220 image container — no height jump between steps */}
        <div style={{
          width: 280, height: 220, flexShrink: 0,
          borderRadius: 12, border: "3px solid var(--gold)",
          background: "var(--s1)",
          display: "flex", alignItems: "center", justifyContent: "center",
          overflow: "hidden",
        }}>
          <img
            src={IOS_STEPS[step].img}
            alt={`Step ${step + 1}`}
            style={{ maxWidth: 280, maxHeight: 220, objectFit: "contain", display: "block" }}
          />
        </div>

        <button
          onClick={next}
          style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 28, color: "var(--t2)", lineHeight: 1,
            visibility: step === 3 ? "hidden" : "visible",
            padding: "0 4px",
          }}
        >
          ›
        </button>
      </div>

      {/* Dot indicators */}
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

      {/* Step counter */}
      <div style={{
        fontSize: 11, color: "var(--t2)", fontFamily: "'DM Sans', sans-serif",
        fontWeight: 300, marginBottom: 8,
      }}>
        {step + 1} of 4
      </div>

      {/* Step text */}
      <div style={{
        fontSize: 13, color: "var(--t1)", fontWeight: 300,
        fontFamily: "'DM Sans', sans-serif",
        textAlign: "center", maxWidth: 280, lineHeight: 1.5,
        marginBottom: 20,
      }}>
        {IOS_STEPS[step].text}
      </div>

      {/* CTA button — step 4 only */}
      <button
        onClick={handleCta}
        style={{
          display: step === 3 ? "block" : "none",
          width: "100%", maxWidth: 280,
          background: "var(--green)", color: "#000",
          fontFamily: "'Bebas Neue', sans-serif", fontSize: 18,
          borderRadius: 12, padding: 14, border: "none", cursor: "pointer",
          marginBottom: 12, boxSizing: "border-box",
        }}
      >
        Open the App
      </button>

      {/* Skip link */}
      <button
        onClick={handleSkip}
        style={{
          background: "none", border: "none", cursor: "pointer",
          fontSize: 12, color: "var(--t2)", fontWeight: 300, padding: "4px 8px",
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        skip for now
      </button>
    </div>
  );
}

// ── Placeholder screenshot slot ───────────────────────────────────────────────
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

// ── Numbered install step ─────────────────────────────────────────────────────
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

// ── Notification info row ─────────────────────────────────────────────────────
function NotifInfoRow({ text }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 10,
      background: "rgba(232,160,32,0.06)",
      border: "0.5px solid rgba(232,160,32,0.15)",
      borderRadius: 10, padding: "12px 14px", marginBottom: 28,
    }}>
      <Info size={16} weight="thin" color="var(--gold)" style={{ flexShrink: 0, marginTop: 1 }} />
      <span style={{ fontSize: 11, color: "var(--t2)", fontWeight: 300, lineHeight: 1.4 }}>
        {text}
      </span>
    </div>
  );
}

// ── CTA + skip buttons ────────────────────────────────────────────────────────
function NavButtons({ onCta, onSkip }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, paddingBottom: 40 }}>
      <button
        onClick={onCta}
        style={{
          width: "100%", height: 52, borderRadius: 12, border: "none", cursor: "pointer",
          background: "var(--green)", color: "var(--bg)",
          fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 600,
        }}
      >
        Open In or Out
      </button>
      <button
        onClick={onSkip}
        style={{
          background: "none", border: "none", cursor: "pointer",
          fontSize: 11, color: "var(--t2)", fontWeight: 300, padding: "4px 8px",
        }}
      >
        skip for now
      </button>
    </div>
  );
}

// ── Android instructions ──────────────────────────────────────────────────────
function AndroidInstructions() {
  return (
    <>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--t1)", letterSpacing: "0.05em", marginBottom: 6 }}>
        Install In or Out
      </div>
      <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300, lineHeight: 1.5, marginBottom: 24 }}>
        To get match reminders, POTM votes and squad updates
      </div>

      <InstallStep num={1} text="Tap the menu (⋮) in the top right of Chrome" />
      <InstallStep num={2} text="Tap Install app or Add to Home screen" />

      <NotifInfoRow text="You must open from the installed app icon — not Chrome — to receive notifications" />
    </>
  );
}

// ── Desktop instructions ──────────────────────────────────────────────────────
function DesktopInstructions({ joinUrl }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(joinUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 22, color: "var(--t1)", letterSpacing: "0.05em", marginBottom: 6 }}>
        Open on your phone
      </div>
      <div style={{ fontSize: 13, color: "var(--t2)", fontWeight: 300, lineHeight: 1.5, marginBottom: 24 }}>
        In or Out is designed for mobile — open it on your phone to install
      </div>

      <button
        onClick={copy}
        style={{
          width: "100%", background: "var(--s2)",
          border: copied ? "0.5px solid var(--green)" : "0.5px solid rgba(255,255,255,0.12)",
          borderRadius: 10, padding: "14px 16px", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, marginBottom: 28, textAlign: "left",
        }}
      >
        <span style={{ fontSize: 12, color: "var(--t1)", fontWeight: 300, wordBreak: "break-all", lineHeight: 1.4 }}>
          {joinUrl}
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

// ── Main component ────────────────────────────────────────────────────────────
export default function JoinSuccess({ player, team }) {
  const playerUrl  = player?.token ? `/p/${player.token}` : "/";
  const joinUrl    = `https://www.in-or-out.com/join/${team?.join_code || team?.id || ""}`;
  const platform   = detectPlatform();

  // Already installed — skip this screen
  useEffect(() => {
    if (platform === "installed") {
      window.location.href = playerUrl;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const navigate = (url) => { window.location.href = url; };

  const handleCta = () => {
    window.posthog?.capture("install_screen_cta_tapped", { platform });
    navigate(playerUrl);
  };

  const handleSkip = () => {
    window.posthog?.capture("install_screen_skipped", { platform });
    navigate(playerUrl);
  };

  if (platform === "installed") return null;

  // iOS — full-page centred carousel
  if (platform === "ios") {
    return <IOSCarousel playerUrl={playerUrl} />;
  }

  return (
    <div style={{
      minHeight: "100dvh", background: "var(--bg)",
      color: "var(--t1)", fontFamily: "var(--font-body)",
      display: "flex", flexDirection: "column",
      maxWidth: 430, margin: "0 auto",
    }}>
      <div style={{ flex: 1, padding: "40px 20px 0", overflowY: "auto" }}>

        {/* App icon + team name */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 32 }}>
          <img
            src="/icons/web-app-manifest-192x192.png"
            alt="In or Out"
            style={{ width: 72, height: 72, borderRadius: 16, marginBottom: 10, display: "block" }}
          />
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: "0.05em", lineHeight: 1 }}>
            <span style={{ color: "var(--green)" }}>I</span>
            <span style={{ color: "var(--t1)" }}>n or </span>
            <span style={{ color: "var(--red)" }}>O</span>
            <span style={{ color: "var(--t1)" }}>ut</span>
          </div>
          {team?.name && (
            <div style={{ fontSize: 14, color: "var(--t2)", fontWeight: 300, marginTop: 6, textAlign: "center" }}>
              You've joined {team.name}
            </div>
          )}
        </div>

        {/* Platform-specific instructions */}
        {platform === "android" && <AndroidInstructions />}
        {platform === "desktop" && <DesktopInstructions joinUrl={joinUrl} />}

      </div>

      {/* Sticky footer buttons */}
      <div style={{ padding: "16px 20px 0", background: "var(--bg)" }}>
        <NavButtons onCta={handleCta} onSkip={handleSkip} />
      </div>
    </div>
  );
}
