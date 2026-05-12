import { useEffect, useRef } from "react";

const ARC_LEN = 150.8; // π × 48 (semicircle radius 48)

export default function GaugeArc({ inCount, squadSize }) {
  const sharpRef = useRef(null);
  const haloRef  = useRef(null);
  const rafRef   = useRef(null);

  useEffect(() => {
    const pct = squadSize > 0 ? Math.min(inCount / squadSize, 1) : 0;
    const dur  = 1000;
    const t0   = performance.now();

    function animate(now) {
      const el   = Math.min((now - t0) / dur, 1);
      const ease = el < 0.5 ? 2 * el * el : 1 - Math.pow(-2 * el + 2, 2) / 2;
      const off  = ARC_LEN * (1 - pct * ease);
      sharpRef.current?.setAttribute("stroke-dashoffset", off);
      haloRef.current?.setAttribute("stroke-dashoffset", off);
      if (el < 1) rafRef.current = requestAnimationFrame(animate);
    }

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [inCount, squadSize]);

  const spotsLeft = Math.max((squadSize || 0) - inCount, 0);

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0 }}>

      {/* SVG area */}
      <div style={{ position:"relative", width:110, height:70 }}>
        {/* Gold radial splash */}
        <div style={{
          position:"absolute", top:8, left:"50%", transform:"translateX(-50%)",
          width:90, height:45,
          background:"radial-gradient(ellipse at center,rgba(232,160,32,0.2) 0%,transparent 70%)",
          pointerEvents:"none",
        }} />

        <svg width="110" height="68" viewBox="0 0 110 68"
          style={{ overflow:"visible", position:"relative", zIndex:1 }}>
          <defs>
            <linearGradient id="ioo-gg" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="var(--red)"   />
              <stop offset="45%"  stopColor="var(--amber)" />
              <stop offset="100%" stopColor="var(--green)" />
            </linearGradient>
            {/* Sharp glow: stdDeviation 2.5 */}
            <filter id="ioo-gsharp" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            {/* Soft halo: stdDeviation 5 */}
            <filter id="ioo-ghalo" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Track */}
          <path d="M 7 64 A 48 48 0 0 1 103 64"
            fill="none" stroke="rgba(255,255,255,0.07)"
            strokeWidth="3.5" strokeLinecap="round" />

          {/* Halo layer (soft, 50% opacity) */}
          <path ref={haloRef}
            d="M 7 64 A 48 48 0 0 1 103 64"
            fill="none" stroke="url(#ioo-gg)"
            strokeWidth="3.5" strokeLinecap="round"
            strokeDasharray={ARC_LEN} strokeDashoffset={ARC_LEN}
            filter="url(#ioo-ghalo)" opacity="0.5" />

          {/* Sharp layer */}
          <path ref={sharpRef}
            d="M 7 64 A 48 48 0 0 1 103 64"
            fill="none" stroke="url(#ioo-gg)"
            strokeWidth="3.5" strokeLinecap="round"
            strokeDasharray={ARC_LEN} strokeDashoffset={ARC_LEN}
            filter="url(#ioo-gsharp)" />
        </svg>

        {/* Count — inside arc, absolute bottom */}
        <div style={{
          position:"absolute", bottom:0, left:"50%", transform:"translateX(-50%)",
          fontFamily:"var(--font-display)", fontSize:38, lineHeight:1,
          color:"var(--t1)", textAlign:"center", letterSpacing:"0.02em",
          whiteSpace:"nowrap",
          textShadow:"0 0 16px rgba(232,160,32,0.5),0 0 35px rgba(232,160,32,0.2)",
        }}>
          {inCount}
        </div>
      </div>

      {/* Below-arc text */}
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", marginTop:2 }}>
        <div style={{ fontSize:11, fontWeight:400, letterSpacing:"0.04em", color:"var(--t1)", textAlign:"center" }}>
          of {squadSize}
        </div>
        <div style={{ fontSize:9, fontWeight:300, letterSpacing:"0.1em", textTransform:"uppercase", color:"var(--t2)", textAlign:"center" }}>
          confirmed
        </div>
      </div>

      {/* Spots pill */}
      <div style={{
        background:"var(--s2)",
        border:"0.5px solid rgba(255,255,255,0.12)",
        borderRadius:"var(--r-pill)",
        padding:"3px 10px",
        fontSize:11, fontWeight:400, color:"var(--gold)",
        marginTop:5,
      }}>
        {spotsLeft} spot{spotsLeft !== 1 ? "s" : ""} left
      </div>
    </div>
  );
}
