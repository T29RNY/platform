// Shared colour palette — used by all products
// Override per product by importing and spreading with custom values

export const colors = {
  bg:       "#0c0c0c",
  surface:  "#161616",
  surface2: "#1e1e1e",
  border:   "#2a2a2a",
  amber:    "#F59E0B",
  green:    "#10B981",
  red:      "#EF4444",
  blue:     "#3B82F6",
  purple:   "#8B5CF6",
  teamA:    "#3B82F6",
  teamB:    "#EF4444",
  text:     "#F3F0EA",
  muted:    "#737373",
  // In or Out signature brand accent — gold on near-black. Mirrors the
  // --gold CSS var in apps/inorout theme/tokens.css. The one true brand
  // accent (the functional amber/green/etc above are semantic, not brand).
  accent:   "#E8A020",
  // A dimmed step of the near-black ramp, between border (#2a2a2a) and
  // muted (#737373). Used for un-lit / low-emphasis chrome (e.g. the
  // unlit portion of the loading wordmark sweep).
  dim:      "#3a3a40",
  faint:    "#333",
  black:    "#000",
  white:    "#fff",
  // Native shell chrome — status bar + splash background. Matches the
  // index.html theme-color and offline.html so the native app, the PWA
  // and the offline fallback share one near-black. Consumed by the
  // Capacitor native bridge (apps/inorout/src/native/native-shell.js).
  appShell: "#0A0A08",
};
