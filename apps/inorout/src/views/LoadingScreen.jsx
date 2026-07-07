import { colors as C } from "@platform/core";

// Single source of truth for the in-app loading state (the football splash the
// web bundle paints while auth / route data resolves). NOT the native iOS
// LaunchScreen storyboard — that one is baked into the binary and needs an App
// Store resubmission to change. This one ships in the JS bundle, so a redesign
// here goes live on the next deploy with no Apple review.
//
// Pass `label` for the variant that shows text under the ball (e.g. "Loading...");
// omit it for the bare-ball variant. Redesign this file and every loading state
// across the app follows.
export default function LoadingScreen({ label }) {
  return (
    <div style={{ background:C.bg, minHeight:"100dvh", display:"flex",
      flexDirection:"column", alignItems:"center", justifyContent:"center",
      gap: label ? 16 : 0 }}>
      <div style={{ fontSize:48 }}>⚽</div>
      {label && (
        <div style={{ fontFamily:"'DM Sans', sans-serif", fontSize:14, color:C.muted }}>{label}</div>
      )}
    </div>
  );
}
