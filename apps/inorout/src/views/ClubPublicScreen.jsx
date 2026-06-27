import { useEffect, useState } from "react";
import { getClubPublic } from "@platform/core/storage/supabase.js";

// Modular Epic B — Phase 2 STUB. The public club home page lives at /c/<slug>.
// This is a deliberately minimal placeholder that proves the route + anon read
// end-to-end (get_club_public, mig 445). The real branded, themed, modular-section
// ClubPublicScreen is built in Phase 4 from the Claude Design wireframes — replace
// this whole file then. For now: fetch and dump the payload so the read is visible.

export default function ClubPublicScreen({ slug }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let alive = true;
    getClubPublic(slug)
      .then((r) => { if (!alive) return; if (!r?.found) setNotFound(true); else setData(r); })
      .catch((e) => { if (alive) { console.error("[club-page] fetch failed", e); setNotFound(true); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [slug]);

  const shell = (body) => (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--txt)", padding: 24, fontFamily: "var(--font-body, sans-serif)" }}>
      {body}
    </div>
  );

  if (loading) return shell(<div>Loading…</div>);
  if (notFound || !data) return shell(<div>This club page isn’t available.</div>);

  return shell(
    <div>
      <h1 style={{ fontFamily: "var(--font-display, sans-serif)" }}>{data.club?.name}</h1>
      {data.branding?.tagline ? <p>{data.branding.tagline}</p> : null}
      <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, opacity: 0.75 }}>
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
