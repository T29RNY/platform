import { useState, useEffect } from "react";
import { colors as C } from "@platform/core";

// LoadingScreen — the web-bundle loading view for In or Out.
//
// Fills the gap between the static native splash and the moment app data
// resolves. Pure CSS + text, zero assets, zero network — it must paint
// precisely because nothing has come back yet. NOT the native iOS
// LaunchScreen storyboard (that one is in the binary and needs an App Store
// resubmission); this lives in the JS bundle, so a redesign ships on deploy
// with no Apple review.
//
// Motif: the "IN OR OUT" wordmark with a gold light sweeping across it —
// reads as "working", sport-agnostic, a branded continuation of the splash.
//
// Renders for EVERY loading state in the app (see the call sites in App.jsx).
// Two signatures, unchanged so those sites need no edit:
//   <LoadingScreen />                    — wordmark only
//   <LoadingScreen label="Loading..." /> — wordmark + caption
// Optional, additive (no existing site passes them):
//   <LoadingScreen matchDay />           — sweep runs hot (ALT), ~17% faster
//   <LoadingScreen tips={[...]} />       — override the bundled tip list

const ACCENT     = C.accent; // In or Out signature gold — drives the sweep
const ACCENT_ALT = C.red;    // match-day sweep + slow-state "still working" dot

// Time gates — everything below the wordmark is gated so a fast load stays clean.
const TIP_AFTER  = 1200; // never flash a tip during a quick load
const TIP_EVERY  = 3200; // tip rotate cadence
const SLOW_AFTER = 4000; // honest "still working" line

// Bundled onboarding tips — hard-coded, picked client-side, no personalisation
// and no network (the data doesn't exist yet at this point). Kept generic so
// they read true across every context this loader covers (squad, club, hub).
// Override with the `tips` prop (must also be a static, bundled array).
const DEFAULT_TIPS = [
  "Tap once to mark yourself In or Out — your whole squad sees it instantly.",
  "Can't make it? Set yourself Out early so a reserve can grab your spot.",
  "Vote for your Player of the Match after every game.",
  "Your reliability score is all-time — turning up consistently pays off.",
  "Bringing a mate? Add them as a guest so the numbers stay right.",
  "After the whistle, check the stats to see how your season's shaping up.",
];

// Lighten a hex toward white → the bright core of the sweep. Returns rgb(), so
// we only need the one brand token per accent (no second "light" colour).
function lighten(hex, amt = 0.5) {
  const h = hex.replace("#", "");
  const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(f, 16);
  const r = Math.round(((n >> 16) & 255) + (255 - ((n >> 16) & 255)) * amt);
  const g = Math.round(((n >> 8) & 255) + (255 - ((n >> 8) & 255)) * amt);
  const b = Math.round((n & 255) + (255 - (n & 255)) * amt);
  return `rgb(${r},${g},${b})`;
}

const shine = (peak) =>
  `linear-gradient(100deg,${C.dim} 0%,${C.dim} 40%,${lighten(peak)} 48%,${peak} 52%,${C.dim} 62%,${C.dim} 100%)`;

const CSS = `
@keyframes ior-shine{0%{background-position:120% 0}100%{background-position:-120% 0}}
@keyframes ior-breathe{0%,100%{opacity:.4}50%{opacity:.9}}
@keyframes ior-in{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}
@keyframes ior-blink{0%,100%{opacity:.35}50%{opacity:1}}
@media (prefers-reduced-motion:reduce){
  .ior-wm{animation:ior-breathe 1.8s ease-in-out infinite!important;background:none!important;-webkit-background-clip:border-box!important;background-clip:border-box!important;color:${C.muted}!important}
  .ior-in{animation:none!important}
}
`;

function Wordmark({ matchDay }) {
  return (
    <div
      className="ior-wm"
      style={{
        fontFamily: '"Bebas Neue", Impact, sans-serif',
        fontSize: 56,
        lineHeight: 0.9,
        letterSpacing: ".04em",
        textAlign: "center",
        background: shine(matchDay ? ACCENT_ALT : ACCENT),
        backgroundSize: "260% 100%",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        animation: `ior-shine ${matchDay ? 2.0 : 2.4}s linear infinite`,
      }}
    >
      IN OR
      <br />
      OUT
    </div>
  );
}

export default function LoadingScreen({ label, matchDay = false, tips = DEFAULT_TIPS }) {
  const [elapsed, setElapsed] = useState(0);
  const [tipIdx, setTipIdx] = useState(() => Math.floor(Math.random() * tips.length));

  useEffect(() => {
    const start = Date.now();
    const clock = setInterval(() => setElapsed(Date.now() - start), 250);
    const rotate = setInterval(() => setTipIdx((i) => (i + 1) % tips.length), TIP_EVERY);
    return () => {
      clearInterval(clock);
      clearInterval(rotate);
    };
  }, [tips.length]);

  const slow = elapsed >= SLOW_AFTER;
  const tipVisible = elapsed >= TIP_AFTER;

  const cap = {
    fontFamily: '"DM Sans", system-ui, sans-serif',
    fontSize: 12.5,
    fontWeight: 400,
    letterSpacing: ".22em",
    textTransform: "uppercase",
    color: C.muted,
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: C.bg,
        color: C.white,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <style>{CSS}</style>

      <Wordmark matchDay={matchDay} />

      {/* caption slot — reserved height so nothing jumps between states */}
      <div
        style={{
          minHeight: 22,
          marginTop: 30,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "0 32px",
        }}
      >
        {slow ? (
          <span style={{ ...cap, letterSpacing: ".02em", textTransform: "none", fontSize: 13.5 }}>
            <span
              style={{
                display: "inline-block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: ACCENT_ALT,
                marginRight: 9,
                verticalAlign: "middle",
                animation: "ior-blink 1.1s ease-in-out infinite",
              }}
            />
            Still working — check your connection
          </span>
        ) : label ? (
          <span style={{ ...cap, animation: "ior-breathe 1.6s ease-in-out infinite" }}>{label}</span>
        ) : null}
      </div>

      {/* rotating tip — pinned low, fades in only once a real wait has begun */}
      {tipVisible && (
        <div
          key={tipIdx}
          className="ior-in"
          style={{
            position: "absolute",
            bottom: "9%",
            left: 0,
            right: 0,
            padding: "0 40px",
            textAlign: "center",
            animation: "ior-in .5s ease both",
          }}
        >
          <div
            style={{
              fontFamily: '"Bebas Neue", Impact, sans-serif',
              fontSize: 14,
              letterSpacing: ".16em",
              color: ACCENT,
              marginBottom: 7,
            }}
          >
            TIP
          </div>
          <div
            style={{
              fontFamily: '"DM Sans", system-ui, sans-serif',
              fontSize: 14,
              lineHeight: 1.45,
              color: C.muted,
              maxWidth: 300,
              margin: "0 auto",
              textWrap: "pretty",
            }}
          >
            {tips[tipIdx]}
          </div>
        </div>
      )}
    </div>
  );
}
