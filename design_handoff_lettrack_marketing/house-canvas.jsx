// HouseCanvas — rebuilt 3D wireframe→point-cloud house.
// Idles with a slow auto-rotation; scroll position nudges the morph progress
// from wireframe (start) → point cloud + detection chips (end).
// Cleaner geometry: a proper gabled house with windows, door, chimney.

const { useEffect, useRef } = React;

function HouseCanvas({ phaseRef }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const smooth = (e0, e1, x) => {
      const t = clamp((x - e0) / (e1 - e0), 0, 1);
      return t * t * (3 - 2 * t);
    };
    const lerp = (a, b, t) => a + (b - a) * t;
    const hash = (i) => {
      const x = Math.sin(i * 127.1) * 43758.5453;
      return x - Math.floor(x);
    };

    // ---- Geometry (origin-centred, y up) ----
    // A house with: rectangular body, gabled roof, chimney box, door, 4 windows
    const V = [
      // body (8 corners)
      [-1.15, -0.95, -0.85], [1.15, -0.95, -0.85], [1.15, -0.95, 0.85], [-1.15, -0.95, 0.85],   // 0-3 floor
      [-1.15,  0.35, -0.85], [1.15,  0.35, -0.85], [1.15,  0.35, 0.85], [-1.15,  0.35, 0.85],   // 4-7 eaves
      // roof apex (ridge line)
      [0,  1.1, -0.85], [0, 1.1, 0.85],                                                          // 8-9
      // chimney
      [0.55, 1.05, -0.15], [0.85, 1.05, -0.15], [0.85, 1.05, 0.15], [0.55, 1.05, 0.15],        // 10-13 base
      [0.55, 1.45, -0.15], [0.85, 1.45, -0.15], [0.85, 1.45, 0.15], [0.55, 1.45, 0.15],        // 14-17 top
      // door (front wall, z = -0.85)
      [-0.3, -0.95, -0.85], [0.05, -0.95, -0.85], [0.05, -0.25, -0.85], [-0.3, -0.25, -0.85], // 18-21
      // front window (right of door)
      [0.35, -0.4, -0.85], [0.85, -0.4, -0.85], [0.85,  0.05, -0.85], [0.35, 0.05, -0.85],   // 22-25
      // side window (right wall, x = 1.15)
      [1.15, -0.35,  0.15], [1.15, -0.35, 0.55], [1.15,  0.05, 0.55], [1.15,  0.05, 0.15],   // 26-29
      // gable window (back, z = 0.85)
      [-0.25, 0.55, 0.85], [0.25, 0.55, 0.85], [0.25, 0.9, 0.85], [-0.25, 0.9, 0.85],         // 30-33
    ];

    const E = [
      // body
      [0,1],[1,2],[2,3],[3,0],
      [0,4],[1,5],[2,6],[3,7],
      [4,5],[5,6],[6,7],[7,4],
      // roof
      [4,8],[5,8],[7,9],[6,9],[8,9],
      // chimney
      [10,11],[11,12],[12,13],[13,10],
      [10,14],[11,15],[12,16],[13,17],
      [14,15],[15,16],[16,17],[17,14],
      // door
      [18,19],[19,20],[20,21],[21,18],
      // front window
      [22,23],[23,24],[24,25],[25,22],
      // side window
      [26,27],[27,28],[28,29],[29,26],
      // gable window
      [30,31],[31,32],[32,33],[33,30],
    ];

    // Detection chips anchored to vertices
    const DET = [
      { v: 8,  t: "EPC · DUE 28d",        c: [251, 191, 36], offset: [-100, -30] },
      { v: 25, t: "RIGHT TO RENT · OK",   c: [61, 220, 151], offset: [70, 10] },
      { v: 15, t: "GAS FLUE · CHECK",     c: [251, 191, 36], offset: [90, -10] },
      { v: 19, t: "SMOKE · ACTION",       c: [248, 113, 113], offset: [-90, 40] },
    ];

    let W = 0, H = 0, cx = 0, cy = 0, scale = 0;
    let rafId = 0;
    let startTime = performance.now();
    let scrollMorph = 0; // 0..1, set externally if we want scroll-driven
    let detReveal = 0;   // 0..1, animated in over first 4s

    function resize() {
      const r = cv.getBoundingClientRect();
      const DPR = Math.min(2, window.devicePixelRatio || 1);
      W = r.width; H = r.height;
      cv.width = W * DPR; cv.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      cx = W / 2; cy = H / 2 + H * 0.04;
      scale = Math.min(W * 0.32, H * 0.36);
    }

    function project(p, sinY, cosY, sinX, cosX) {
      const x = p[0] * cosY + p[2] * sinY;
      const z = -p[0] * sinY + p[2] * cosY;
      const y = p[1];
      const y2 = y * cosX - z * sinX;
      const z2 = y * sinX + z * cosX;
      const f = 4.6, persp = f / (f + z2);
      return { x: cx + x * scale * persp, y: cy - y2 * scale * persp, z: z2, s: persp };
    }

    function draw(time) {
      const elapsed = (time - startTime) / 1000;

      // Idle slow rotation
      const ay = -0.55 + elapsed * 0.18 + scrollMorph * 0.6;
      const ax = -0.17;
      const sinY = Math.sin(ay), cosY = Math.cos(ay);
      const sinX = Math.sin(ax), cosX = Math.cos(ax);

      // Morph progress: cycle every ~14s, but biased by scroll position
      // 0..0.4: wireframe draws in
      // 0.4..0.7: hold wireframe
      // 0.7..1.0: morph into points
      const cycle = (elapsed % 14) / 14;
      const morph = reduce ? 0.65 : smooth(0.7, 1.0, cycle) * 0.9 + scrollMorph * 0.1;

      const P = V.map((v) => project(v, sinY, cosY, sinX, cosX));
      let zmin = Infinity, zmax = -Infinity;
      P.forEach((q) => { if (q.z < zmin) zmin = q.z; if (q.z > zmax) zmax = q.z; });
      const depth = (q) => 1 - clamp((q.z - zmin) / (zmax - zmin || 1), 0, 1);

      ctx.clearRect(0, 0, W, H);
      ctx.lineCap = "round";

      // 1) Wireframe (fades as morph rises)
      const wireOpacity = (1 - morph);
      if (wireOpacity > 0.02) {
        for (const e of E) {
          const a = P[e[0]], b = P[e[1]];
          const dd = (depth(a) + depth(b)) / 2;
          const alpha = wireOpacity * (0.35 + 0.55 * dd);
          // color shifts from cool blue at start to violet
          ctx.strokeStyle = `rgba(60, 80, 160, ${alpha.toFixed(3)})`;
          ctx.lineWidth = lerp(0.6, 1.4, dd);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      // 2) Point cloud along edges
      if (morph > 0.05) {
        for (let k = 0; k < E.length; k++) {
          const va = V[E[k][0]], vb = V[E[k][1]];
          const len = Math.hypot(vb[0] - va[0], vb[1] - va[1], vb[2] - va[2]);
          const n = Math.max(2, Math.round(len / 0.11));
          for (let i = 0; i <= n; i++) {
            const tt = i / n;
            const wp = [
              va[0] + (vb[0] - va[0]) * tt,
              va[1] + (vb[1] - va[1]) * tt,
              va[2] + (vb[2] - va[2]) * tt
            ];
            const pp = project(wp, sinY, cosY, sinX, cosX);
            const dep = depth(pp);
            const seed = k * 53 + i;
            const jitter = morph * 6;
            const jx = jitter * (hash(seed) - 0.5);
            const jy = jitter * (hash(seed + 9) - 0.5);
            const x = pp.x + jx, y = pp.y + jy;
            const r = lerp(0.6, 2.2, dep) * (0.7 + 0.4 * morph);
            const alpha = morph * lerp(0.25, 1.0, dep);
            if (alpha < 0.02) continue;
            // color lerps from blue → violet → mint as morph completes
            const tg = clamp(morph * 1.2, 0, 1);
            const cr = Math.round(lerp(140, 189, tg));
            const cg = Math.round(lerp(70, 95, tg));
            const cb = Math.round(lerp(160, 200, tg));
            ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`;
            ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
          }
        }
      }

      // 3) Vertex dots (always visible, brightest at end)
      for (const q of P) {
        const dep = depth(q);
        const a = lerp(0.35, 0.95, dep) * (0.5 + 0.5 * (1 - morph * 0.4));
        ctx.fillStyle = `rgba(35, 50, 90, ${a.toFixed(3)})`;
        ctx.beginPath(); ctx.arc(q.x, q.y, lerp(1.0, 2.4, dep), 0, 6.283); ctx.fill();
      }

      // 4) A horizon line under the house
      ctx.strokeStyle = "rgba(60,80,160,.18)";
      ctx.setLineDash([4, 8]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      const groundY = cy + scale * 0.78;
      ctx.moveTo(20, groundY); ctx.lineTo(W - 20, groundY);
      ctx.stroke();
      ctx.setLineDash([]);

      // 5) Detection chips lock on at end of morph cycle, fade in over detReveal
      if (!reduce) {
        detReveal = clamp(detReveal + 0.005, 0, 1);
      } else {
        detReveal = 1;
      }
      const chipFade = detReveal * (0.4 + 0.6 * morph);
      if (chipFade > 0.05) {
        ctx.font = "600 10.5px 'Inter', system-ui, sans-serif";
        ctx.textBaseline = "middle";
        for (let m = 0; m < DET.length; m++) {
          const det = DET[m];
          const q = P[det.v];
          const dep = depth(q);
          const indiv = chipFade * smooth(m * 0.18, m * 0.18 + 0.4, ((elapsed * 0.5) % 2));
          const a = clamp(chipFade * (0.5 + 0.5 * dep), 0, 1);
          const [r, g, b] = det.c;

          // chip position offset from vertex
          const lx = q.x + det.offset[0];
          const ly = q.y + det.offset[1];

          // Crosshair / leader line
          ctx.strokeStyle = `rgba(${r},${g},${b},${(a*0.8).toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(q.x, q.y);
          ctx.lineTo(lx, ly);
          ctx.stroke();
          ctx.setLineDash([]);

          // Vertex marker (small circle)
          ctx.strokeStyle = `rgba(${r},${g},${b},${a.toFixed(3)})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, 6.283); ctx.stroke();
          ctx.fillStyle = `rgba(${r},${g},${b},${(a*0.3).toFixed(3)})`;
          ctx.beginPath(); ctx.arc(q.x, q.y, 5, 0, 6.283); ctx.fill();

          // Chip box
          const tw = ctx.measureText(det.t).width;
          const padX = 8, padY = 5;
          const bx = det.offset[0] < 0 ? lx - tw - padX * 2 : lx;
          const by = ly - 9;
          // bg
          ctx.fillStyle = `rgba(255,255,255,${(0.95 * a).toFixed(3)})`;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(bx, by, tw + padX * 2, 18, 4);
          else ctx.rect(bx, by, tw + padX * 2, 18);
          ctx.fill();
          // border
          ctx.strokeStyle = `rgba(${r},${g},${b},${a.toFixed(3)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(bx + 0.5, by + 0.5, tw + padX * 2 - 1, 17, 4);
          else ctx.rect(bx + 0.5, by + 0.5, tw + padX * 2 - 1, 17);
          ctx.stroke();
          // dot
          ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(3)})`;
          ctx.beginPath(); ctx.arc(bx + 6, ly, 2.5, 0, 6.283); ctx.fill();
          // text
          ctx.fillStyle = `rgba(${Math.max(0,r-40)},${Math.max(0,g-40)},${Math.max(0,b-40)},${a.toFixed(3)})`;
          ctx.fillText(det.t, bx + 14, ly);
        }
      }

      // Phase label update
      if (phaseRef && phaseRef.current) {
        const phase =
          cycle < 0.4 ? "▸ MODELLING" :
          cycle < 0.7 ? "▸ SCANNING" :
                        "✓ 14 OBLIGATIONS";
        if (phaseRef.current.textContent !== phase) {
          phaseRef.current.textContent = phase;
        }
      }
    }

    function loop(time) {
      draw(time);
      rafId = requestAnimationFrame(loop);
    }

    function onScroll() {
      const r = wrap.getBoundingClientRect();
      const vp = window.innerHeight;
      const center = r.top + r.height / 2;
      const norm = clamp(1 - (center / vp), 0, 1);
      scrollMorph = norm;
    }

    resize();
    const onResize = () => { resize(); };
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, { passive: true });

    // Draw an immediate first frame so the canvas isn't blank if rAF is throttled
    draw(performance.now());

    if (reduce) {
      // single static frame already drawn
    } else {
      rafId = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <div className="house3d" ref={wrapRef}>
      <canvas ref={canvasRef}></canvas>
      <div className="corners">
        <span className="tl"></span>
        <span className="tr"></span>
        <span className="bl"></span>
        <span className="br"></span>
      </div>
      <div className="axis-label bl">14 MAPLE RD · LEEDS</div>
      <div className="axis-label br">UPRN 100023336956</div>
    </div>
  );
}

window.HouseCanvas = HouseCanvas;
