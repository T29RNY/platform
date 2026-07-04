// MatchRouteHeatmap — self-contained SVG renderer for an Apple Watch GPS route
// (Match Workout Tracking PR #3). No external map library. Outdoor games only:
// the caller only mounts this when a route exists (has_route + outdoor). Indoor
// games have no GPS, so there is nothing to draw — the caller shows "no route"
// text instead of mounting this.
//
// `track` is the jsonb stored by save_match_health_summary (mig 456) and read back
// by getMatchRoute(): we parse defensively because the native ingestion (PR #6) and
// the watch app (Phase 2) may shape it slightly differently. Accepted shapes:
//   { points: [{ lat, lon }, …] }  |  { points: [{ latitude, longitude }, …] }
//   { points: [[lat, lon], …] }    (bare coordinate-pair arrays — the compact GPS
//                                    encoding some producers/the demo seed emit)
//   [{ lat, lon }, …]  |  [[lat, lon], …]  (a bare top-level array of either shape)
//
// House rules: CSS-var colours can't be used directly in SVG stroke/fill attributes,
// so we drive colour via `currentColor` (set with a CSS var on the <svg> style) and
// inline `style={{ fill: 'var(--…)' }}` on the dots — never a raw hex (hygiene check).

function parsePoints(track) {
  const raw = Array.isArray(track) ? track : (track && Array.isArray(track.points) ? track.points : []);
  const pts = [];
  for (const p of raw) {
    // Two point encodings: an object ({lat,lon} / {latitude,longitude}) or a bare
    // [lat, lon] coordinate-pair array. Read whichever this point is.
    const lat = Array.isArray(p) ? Number(p[0]) : Number(p?.lat ?? p?.latitude);
    const lon = Array.isArray(p) ? Number(p[1]) : Number(p?.lon ?? p?.lng ?? p?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push({ lat, lon });
  }
  return pts;
}

export default function MatchRouteHeatmap({ track, height = 140 }) {
  const pts = parsePoints(track);
  if (pts.length < 2) return null; // nothing meaningful to draw

  // Bounding box → normalised viewBox coords. Independent per-axis normalise into a
  // padded 100×60 box (a thumbnail; precise geo-aspect is unnecessary at this size).
  const lats = pts.map((p) => p.lat);
  const lons = pts.map((p) => p.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const latRange = (maxLat - minLat) || 1e-9;
  const lonRange = (maxLon - minLon) || 1e-9;

  const W = 100, H = 60, PAD = 6;
  const x = (lon) => PAD + ((lon - minLon) / lonRange) * (W - 2 * PAD);
  // Flip lat: north (max) is up, but SVG y grows downward.
  const y = (lat) => PAD + ((maxLat - lat) / latRange) * (H - 2 * PAD);

  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.lon).toFixed(2)},${y(p.lat).toFixed(2)}`).join(" ");
  const start = pts[0], end = pts[pts.length - 1];

  return (
    <div style={{ borderRadius: 10, overflow: "hidden", background: "var(--s1)", border: "0.5px solid var(--b2)" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={height}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: "block", color: "var(--gold)" }}
        role="img"
        aria-label="Match route"
      >
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
        <circle cx={x(start.lon)} cy={y(start.lat)} r="2.4" style={{ fill: "var(--green)" }} />
        <circle cx={x(end.lon)} cy={y(end.lat)} r="2.4" style={{ fill: "var(--gold)" }} />
      </svg>
    </div>
  );
}
