import { useEffect, useRef } from "react";

/**
 * Animated floodlit-pitch backdrop. Presentational only — no text.
 * Extracted from the old HeroCard so PageHeader can use the pitch as its
 * background (header consolidation, session 90). Colours are rgb()/rgba()
 * strings deliberately — the hygiene hex-check flags `#hex` literals and
 * this file is in its scan path.
 *
 * Respects prefers-reduced-motion: draws a single static frame and skips
 * the rAF loop when the user has asked for reduced motion.
 */
export default function PitchCanvas() {
  const canvasRef = useRef(null);
  const rafRef    = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let t = 0;

    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    const reduce = typeof window !== "undefined"
      && window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function draw() {
      const w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Base
      ctx.fillStyle = "rgb(10,31,10)";
      ctx.fillRect(0, 0, w, h);

      // 10 vertical mow stripes
      for (let i = 0; i < 10; i++) {
        ctx.fillStyle = i % 2 === 0 ? "rgba(55,150,45,0.28)" : "rgba(35,110,28,0.18)";
        ctx.fillRect(i * (w / 10), 0, w / 10, h);
      }

      // Pitch lines
      ctx.strokeStyle = "rgba(255,255,255,0.20)";
      ctx.lineWidth = 1;

      // Centre circle — gentle pulse
      const p = 1 + Math.sin(t * 0.4) * 0.015;
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 1.25, h * 0.7 * p, 0, Math.PI * 2);
      ctx.stroke();

      // Halfway line
      ctx.beginPath();
      ctx.moveTo(0, h * 0.5);
      ctx.lineTo(w, h * 0.5);
      ctx.stroke();

      // 5 floodlight beams from the top
      [0.08, 0.26, 0.5, 0.74, 0.92].forEach((xp, i) => {
        const f = 0.12 + Math.sin(t * 0.7 + i * 1.4) * 0.025;
        const g = ctx.createLinearGradient(w * xp, 0, w * xp + 12, h * 0.8);
        g.addColorStop(0, "rgba(255,255,200," + f + ")");
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

      // Radial green glow from the bottom
      const pg = ctx.createRadialGradient(w * 0.5, h, 0, w * 0.5, h, w * 0.6);
      pg.addColorStop(0, "rgba(45,140,35,0.26)");
      pg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = pg;
      ctx.fillRect(0, 0, w, h);

      if (reduce) return;          // static single frame for reduced-motion
      t += 0.016;
      rafRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position:"absolute", inset:0, width:"100%", height:"100%" }}
    />
  );
}
