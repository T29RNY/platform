import { CalendarCheck, MapPinLine, Clock } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "framer-motion";
import GaugeArc from "./GaugeArc.jsx";
import PitchCanvas from "./PitchCanvas.jsx";

// Inject blink animation once
if (typeof document !== "undefined" && !document.getElementById("ioo-ph-styles")) {
  const el = document.createElement("style");
  el.id = "ioo-ph-styles";
  el.textContent = `
    @keyframes ioo-blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
  `;
  document.head.appendChild(el);
}

function initials(name) {
  const parts = (name || "").trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (name || "?").slice(0, 2).toUpperCase();
}

export default function PageHeader({
  teamName, dayOfWeek, venue, kickoff,
  inCount, squadSize, gameIsLive,
  pricePerPlayer = null,
  squad = [],
  me = null, onAvatarTap = null,
  opponentLabel = null,
}) {
  const showAvatar = !!(me && onAvatarTap);
  const reduce = useReducedMotion();

  // Admins = vice-captains, mirrors the old HeroCard logic.
  const admins = [...squad.filter(p => p.isViceCaptain === true && !p.disabled)]
    .sort((a, b) => (a.nickname || a.name).localeCompare(b.nickname || b.name))
    .slice(0, 4)
    .map(p => p.nickname || p.name);

  // Staggered entrance — disabled under reduced-motion.
  const container = {
    hidden: {},
    show: { transition: { staggerChildren: reduce ? 0 : 0.06, delayChildren: 0.04 } },
  };
  const rise = reduce
    ? { hidden: { opacity: 1, y: 0 }, show: { opacity: 1, y: 0 } }
    : {
        hidden: { opacity: 0, y: 8 },
        show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 420, damping: 30 } },
      };

  const metaItem = (icon, text) => (
    <div style={{ display:"flex", alignItems:"center", gap:4, fontSize:12, color:"var(--t1)", fontWeight:300 }}>
      {icon}{text}
    </div>
  );

  return (
    <div style={{ padding:"calc(8px + env(safe-area-inset-top)) 12px 10px" }}>
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        style={{
          position:"relative",
          borderRadius:"var(--r)",
          overflow:"hidden",
          border:"0.5px solid var(--border-subtle)",
        }}
      >
        {/* Animated pitch backdrop */}
        <PitchCanvas />
        {/* Legibility scrim over the pitch */}
        <div style={{
          position:"absolute", inset:0,
          background:"linear-gradient(180deg,rgba(6,12,8,0.74) 0%,rgba(6,8,6,0.62) 55%,rgba(6,8,6,0.82) 100%)",
        }} />

        {/* Content */}
        <div style={{ position:"relative", padding:"13px 15px 13px", display:"flex", gap:12 }}>
          <div style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", gap:7 }}>

            {/* Row 1 — avatar + team name + live status */}
            <motion.div variants={rise} style={{ display:"flex", alignItems:"center", gap:10, minWidth:0 }}>
              {showAvatar && (
                <motion.div
                  layoutId="me-avatar"
                  data-tour="header-avatar"
                  onClick={onAvatarTap}
                  role="button"
                  aria-label="Open profile"
                  whileTap={{ scale: 0.94 }}
                  transition={{ type:"spring", stiffness:380, damping:30 }}
                  style={{
                    width:32, height:32, borderRadius:"50%",
                    background:"rgba(255,255,255,0.08)",
                    border:"1px solid rgba(255,255,255,0.20)",
                    boxShadow:"0 0 12px rgba(0,0,0,0.45)",
                    display:"flex", alignItems:"center", justifyContent:"center",
                    cursor:"pointer", WebkitTapHighlightColor:"transparent",
                    fontFamily:"'Bebas Neue', sans-serif", fontSize:12,
                    letterSpacing:"0.04em", color:"var(--t1)",
                    backdropFilter:"blur(6px)", WebkitBackdropFilter:"blur(6px)",
                    flexShrink:0,
                  }}
                >
                  {initials(me?.nickname || me?.name)}
                </motion.div>
              )}
              <div style={{
                fontSize:10.5, fontWeight:300,
                letterSpacing:"0.20em", textTransform:"uppercase",
                color:"var(--t2)",
                overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
              }}>
                {teamName}
              </div>
              {gameIsLive && (
                <div style={{
                  display:"inline-flex", alignItems:"center", gap:5, flexShrink:0,
                  fontSize:10, fontWeight:400, letterSpacing:"0.12em", textTransform:"uppercase",
                  color:"var(--green)",
                }}>
                  <span style={{
                    display:"inline-block", width:5, height:5, borderRadius:"50%",
                    background:"var(--green)", boxShadow:"0 0 6px var(--green)",
                    animation: reduce ? "none" : "ioo-blink 2s infinite", flexShrink:0,
                  }} />
                  Open
                </div>
              )}
            </motion.div>

            {/* Row 2 — IN OR OUT wordmark (staggered letters) */}
            <motion.div variants={rise} style={{
              fontFamily:"var(--font-display)", fontSize:46,
              lineHeight:0.88, letterSpacing:"0.02em", fontStyle:"italic",
            }}>
              <motion.span
                initial={reduce ? false : { scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type:"spring", stiffness:500, damping:24, delay: reduce ? 0 : 0.10 }}
                style={{ color:"var(--green)", display:"inline-block" }}
              >IN</motion.span>
              <span style={{ color:"var(--t1)" }}> OR </span>
              <motion.span
                initial={reduce ? false : { scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type:"spring", stiffness:500, damping:24, delay: reduce ? 0 : 0.18 }}
                style={{ color:"var(--red)", display:"inline-block" }}
              >OUT</motion.span>
            </motion.div>

            {/* Row 3 — single fixture line: day · venue · time · £price */}
            <motion.div variants={rise} style={{ display:"flex", alignItems:"center", gap:9, flexWrap:"wrap" }}>
              {opponentLabel && (
                <div style={{
                  fontSize:13, fontWeight:500, color:"var(--t1)",
                  maxWidth:"100%", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                }}>
                  {opponentLabel}
                </div>
              )}
              {dayOfWeek && metaItem(<CalendarCheck size={14} weight="thin" color="var(--t2)" />, dayOfWeek)}
              {venue && metaItem(<MapPinLine size={14} weight="thin" color="var(--t2)" />, venue)}
              {kickoff && metaItem(<Clock size={14} weight="thin" color="var(--t2)" />, kickoff)}
              {pricePerPlayer && (
                <div style={{
                  fontSize:11, fontWeight:700, color:"var(--gold)",
                  background:"var(--gold2)", border:"1px solid var(--goldb)",
                  padding:"2px 8px", borderRadius:"var(--r-pill)",
                }}>
                  £{pricePerPlayer}
                </div>
              )}
            </motion.div>

            {/* Row 4 — thin admins line */}
            {admins.length > 0 && (
              <motion.div variants={rise} style={{
                display:"flex", gap:7, alignItems:"center",
                marginTop:2, paddingTop:9,
                borderTop:"0.5px solid rgba(255,255,255,0.10)",
              }}>
                <span style={{ fontSize:9.5, letterSpacing:"0.10em", textTransform:"uppercase", color:"var(--t2)", opacity:0.7 }}>
                  Admins
                </span>
                <span style={{ fontSize:11.5, color:"var(--t2)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {admins.join(" · ")}
                </span>
              </motion.div>
            )}
          </div>

          {/* Right: squad gauge */}
          <motion.div variants={rise} style={{ flexShrink:0 }}>
            <GaugeArc inCount={inCount} squadSize={squadSize} />
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}
