import { useEffect, useRef } from "react";

export default function HeroCard({ dayOfWeek, pricePerPlayer, squad = [] }) {
  const canvasRef = useRef(null);
  const rafRef    = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let t = 0;

    function resize() {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    }
    resize();

    function draw() {
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Base
      ctx.fillStyle = "#0a1f0a";
      ctx.fillRect(0, 0, w, h);

      // 10 vertical stripes
      for (let i = 0; i < 10; i++) {
        ctx.fillStyle = i % 2 === 0 ? "rgba(55,150,45,0.28)" : "rgba(35,110,28,0.18)";
        ctx.fillRect(i * (w / 10), 0, w / 10, h);
      }

      // Pitch lines
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 1;

      // Centre circle — animated pulse
      const p = 1 + Math.sin(t * 0.4) * 0.015;
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 1.2, h * 0.65 * p, 0, Math.PI * 2);
      ctx.stroke();

      // Halfway line
      ctx.beginPath();
      ctx.moveTo(0, h * 0.5);
      ctx.lineTo(w, h * 0.5);
      ctx.stroke();

      // Penalty box
      ctx.strokeRect(w * 0.12, 0, w * 0.76, h * 0.42);

      // 6-yard box
      ctx.strokeRect(w * 0.26, 0, w * 0.48, h * 0.22);

      // 5 floodlight beams from top
      [0.08, 0.26, 0.5, 0.74, 0.92].forEach((xp, i) => {
        const f = 0.12 + Math.sin(t * 0.7 + i * 1.4) * 0.025;
        const g = ctx.createLinearGradient(w * xp, 0, w * xp + 12, h * 0.8);
        g.addColorStop(0, `rgba(255,255,200,${f})`);
        g.addColorStop(1, "rgba(255,255,200,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(w * xp - 1, 0);
        ctx.lineTo(w * xp + 1, 0);
        ctx.lineTo(w * xp + 30, h * 0.8);
        ctx.lineTo(w * xp - 30, h * 0.8);
        ctx.closePath();
        ctx.fill();
      });

      // Radial green glow from bottom
      const pg = ctx.createRadialGradient(w * 0.5, h, 0, w * 0.5, h, w * 0.6);
      pg.addColorStop(0, "rgba(45,140,35,0.26)");
      pg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = pg;
      ctx.fillRect(0, 0, w, h);

      t += 0.016;
      rafRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const dayName = dayOfWeek ? `${dayOfWeek} Night` : "Match Night";
  const vcs = [...squad.filter(p => p.isViceCaptain === true && !p.disabled)]
    .sort((a, b) => (a.nickname || a.name).localeCompare(b.nickname || b.name))
    .slice(0, 4);

  return (
    <div style={{
      position:"relative",
      borderRadius:"var(--r)",
      overflow:"hidden",
      marginBottom:8,
      height:110,
      background:"#061006",
    }}>
      <canvas ref={canvasRef}
        style={{ position:"absolute", inset:0, width:"100%", height:"100%" }} />

      {/* Dark overlay */}
      <div style={{
        position:"absolute", inset:0,
        background:"linear-gradient(180deg,rgba(6,16,6,0.05) 0%,rgba(6,6,4,0.6) 100%)",
      }} />

      {/* Text overlay */}
      <div style={{ position:"absolute", bottom:0, left:0, right:0, padding:"8px 16px 10px",
        display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
        {/* Left: existing content — unchanged */}
        <div>
          <div style={{
            fontSize:9, fontWeight:400, letterSpacing:"0.14em",
            textTransform:"uppercase", color:"var(--gold)",
          }}>
            This Week
          </div>
          <span style={{
            display:"block",
            fontFamily:"var(--font-display)", fontSize:24, lineHeight:1,
            letterSpacing:"0.04em", color:"var(--t1)", fontStyle:"italic",
            textShadow:"0 0 30px rgba(0,0,0,1)",
          }}>
            {dayName}
          </span>
          <span style={{
            display:"block",
            fontFamily:"var(--font-display)", fontSize:36, lineHeight:1,
            letterSpacing:"0.04em", color:"var(--green)", fontStyle:"italic",
            textShadow:"0 0 18px rgba(61,220,106,0.7),0 0 45px rgba(61,220,106,0.3)",
          }}>
            Football
          </span>
          {pricePerPlayer && (
            <div style={{ fontSize:11, color:"rgba(242,240,234,0.6)", marginTop:2, fontWeight:300 }}>
              £{pricePerPlayer} per player
            </div>
          )}
        </div>

        {/* Right: ADMINS block — only when VCs exist */}
        {vcs.length > 0 && (
          <div style={{ textAlign:"right", paddingBottom:2 }}>
            <div style={{
              fontFamily:"'Bebas Neue', sans-serif", fontSize:9,
              letterSpacing:"0.1em", textTransform:"uppercase", color:"var(--t2)",
              marginBottom:3,
            }}>
              Admins
            </div>
            {vcs.map(p => (
              <div key={p.id} style={{
                fontFamily:"'DM Sans', sans-serif", fontWeight:400, fontSize:12,
                color:"var(--t1)", lineHeight:1.4,
              }}>
                {p.nickname || p.name}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
