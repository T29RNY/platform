import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  venueGetClubPage, venueSetClubPage, venuePublishClubPage,
} from "@platform/core/storage/supabase.js";
import { SectionHead } from "./atoms.jsx";

// Club page editor for the venue console's club lens (Club Console Consolidation
// PR #2b). The venue-admin edit surface for a club's public /c/<slug> page,
// ported from the retired clubmanager into venue's design system. Venue-token
// writes (venue_set_club_page / venue_publish_club_page twins, mig 515) — no
// club_team_managers row needed. White-label brand colours flow to the public
// page (and, from PR #3, the console shell).
//
// Deferred (carried from the clubmanager source — would need new backend):
//  · crest/hero FILE upload (club-media bucket is club-manager-auth) — URL only.
//  · sections + get-involved links editing — preserved round-trip, edited in the
//    /hub club-settings wizard, not here.

const HEX = /^#[0-9a-fA-F]{6}$/;
const SLUG_OK = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const slugify = (s) => (s || "").toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
const SOCIAL_KEYS = [
  { key: "website", label: "Website" },
  { key: "facebook", label: "Facebook" },
  { key: "instagram", label: "Instagram" },
  { key: "x", label: "X / Twitter" },
  { key: "youtube", label: "YouTube" },
];

export default function ClubPageEditor({ venueToken, clubId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const savingRef = useRef(false);
  const [feedback, setFeedback] = useState(null); // { kind: 'ok'|'error', text }

  const [published, setPublished] = useState(false);
  const [hasPage, setHasPage] = useState(false);
  const [slug, setSlug] = useState("");
  const [primary, setPrimary] = useState("");
  const [secondary, setSecondary] = useState("");
  const [accent, setAccent] = useState("");
  const [crestUrl, setCrestUrl] = useState("");
  const [heroUrl, setHeroUrl] = useState("");
  const [tagline, setTagline] = useState("");
  const [about, setAbout] = useState("");
  const [socials, setSocials] = useState({});
  // preserved round-trip (edited elsewhere) — never wiped on save
  const preserved = useRef({ sections: [], links: [] });

  const load = useCallback(async () => {
    if (!venueToken || !clubId) return;
    setLoading(true); setError(false);
    try {
      const res = await venueGetClubPage(venueToken, clubId);
      const p = res?.page || null;
      setHasPage(!!p);
      setPublished(!!p?.published);
      setSlug(p?.slug || slugify(res?.club?.name || ""));
      setPrimary(p?.primary_colour || "");
      setSecondary(p?.secondary_colour || "");
      setAccent(p?.accent_colour || "");
      setCrestUrl(p?.crest_url || "");
      setHeroUrl(p?.hero_url || "");
      setTagline(p?.tagline || "");
      setAbout(p?.about || "");
      setSocials(p?.socials && typeof p.socials === "object" ? p.socials : {});
      preserved.current = {
        sections: Array.isArray(p?.sections) ? p.sections : [],
        links: Array.isArray(p?.links) ? p.links : [],
      };
    } catch (err) {
      console.error("[club-page] venue_get_club_page failed", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [venueToken, clubId]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async () => {
    if (savingRef.current) return;
    const s = slugify(slug);
    if (!s || !SLUG_OK.test(s)) { setFeedback({ kind: "error", text: "Pick a web address (lowercase letters, numbers, hyphens)." }); return; }
    for (const [c, lbl] of [[primary, "Primary"], [secondary, "Secondary"], [accent, "Accent"]]) {
      if (c && !HEX.test(c.trim())) { setFeedback({ kind: "error", text: `${lbl} colour must be a hex code like #1A2B3C.` }); return; }
    }
    savingRef.current = true; setBusy(true); setFeedback(null);
    try {
      await venueSetClubPage(venueToken, clubId, {
        slug: s,
        primaryColour: primary.trim() || null,
        secondaryColour: secondary.trim() || null,
        accentColour: accent.trim() || null,
        crestUrl: crestUrl.trim() || null,
        heroUrl: heroUrl.trim() || null,
        tagline: tagline.trim() || null,
        about: about.trim() || null,
        socials,                              // round-trip
        sections: preserved.current.sections, // preserved — never wiped
        links: preserved.current.links,       // preserved — never wiped
      });
      setSlug(s); setHasPage(true);
      setFeedback({ kind: "ok", text: "Club page saved." });
    } catch (err) {
      console.error("[club-page] venue_set_club_page failed", err);
      const code = err?.message || "";
      setFeedback({ kind: "error", text:
        code.includes("slug_taken") ? "That web address is already taken — pick another."
        : code.includes("feature_disabled") ? "The public club page isn't enabled for this club (turn on the Public page module in Features)."
        : code.includes("club_not_in_venue") ? "You can only edit pages for clubs at your venue."
        : "Couldn't save the club page." });
    } finally {
      savingRef.current = false; setBusy(false);
    }
  }, [venueToken, clubId, slug, primary, secondary, accent, crestUrl, heroUrl, tagline, about, socials]);

  const togglePublish = useCallback(async () => {
    if (publishing) return;
    if (!hasPage) { setFeedback({ kind: "error", text: "Save the page first, then publish it." }); return; }
    const next = !published;
    setPublishing(true);
    try {
      await venuePublishClubPage(venueToken, clubId, next);
      setPublished(next);
      setFeedback({ kind: "ok", text: next ? "Club page is now live." : "Club page unpublished." });
    } catch (err) {
      console.error("[club-page] venue_publish_club_page failed", err);
      setFeedback({ kind: "error", text: "Couldn't change the publish state." });
    } finally {
      setPublishing(false);
    }
  }, [venueToken, clubId, published, hasPage, publishing]);

  const publicUrl = slug ? `https://app.in-or-out.com/c/${slug}` : null;

  return (
    <div>
      <SectionHead label="Public page">
        {hasPage && (
          <>
            <span className={published ? "pill pill-live" : "pill pill-muted"}>
              <span className="pill-dot" /> {published ? "Live" : "Draft"}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={togglePublish} disabled={publishing}>
              {publishing ? "…" : published ? "Unpublish" : "Publish"}
            </button>
          </>
        )}
      </SectionHead>

      {feedback && (
        <div className={feedback.kind === "ok" ? "banner banner-info" : "banner banner-warn"} style={{ marginBottom: "var(--gap)" }}>
          {feedback.text}
        </div>
      )}

      {loading ? (
        <p style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading your club page…</p>
      ) : error ? (
        <p style={{ color: "var(--live)", fontSize: 13 }}>
          Couldn’t load the club page. <button className="btn btn-ghost btn-xs" onClick={load}>Retry</button>
        </p>
      ) : (
        <div className="card-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
          <div className="card card-pad">
            <h3 style={{ marginTop: 0, fontSize: 15 }}>Identity &amp; web address</h3>
            <label className="field-label">Web address (slug)</label>
            <input className="input" value={slug} onChange={(e) => setSlug(e.target.value)}
              onBlur={(e) => setSlug(slugify(e.target.value))} placeholder="e.g. pa-sports" />
            {publicUrl && (
              <p style={{ fontSize: 12, color: "var(--ink-3)", margin: "6px 0 0" }}>
                {published
                  ? <>Live at <a href={publicUrl} target="_blank" rel="noreferrer">{publicUrl}</a></>
                  : <>Will be at {publicUrl} once published</>}
              </p>
            )}
            <label className="field-label" style={{ marginTop: 14 }}>Tagline</label>
            <input className="input" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="e.g. Grassroots football since 1998" />
            <label className="field-label" style={{ marginTop: 14 }}>About</label>
            <textarea className="input" value={about} onChange={(e) => setAbout(e.target.value)} rows={4}
              placeholder="A short paragraph about your club." style={{ height: "auto", padding: "10px 14px" }} />
            <label className="field-label" style={{ marginTop: 14 }}>Crest image URL</label>
            <input className="input" value={crestUrl} onChange={(e) => setCrestUrl(e.target.value)} placeholder="https://…" />
            <label className="field-label" style={{ marginTop: 14 }}>Hero image URL</label>
            <input className="input" value={heroUrl} onChange={(e) => setHeroUrl(e.target.value)} placeholder="https://…" />
            <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 8 }}>
              Direct image upload arrives in a later release — paste an image URL for now.
            </p>
          </div>

          <div className="card card-pad">
            <h3 style={{ marginTop: 0, fontSize: 15 }}>Brand colours</h3>
            <p style={{ fontSize: 12, color: "var(--ink-3)", margin: "0 0 10px" }}>White-label your public page. Hex codes like #0B1F3A.</p>
            {[["Primary", primary, setPrimary], ["Secondary", secondary, setSecondary], ["Accent", accent, setAccent]].map(([lbl, val, set]) => (
              <div key={lbl} style={{ marginBottom: 12 }}>
                <label className="field-label">{lbl} colour</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span aria-hidden="true" style={{
                    width: 34, height: 34, borderRadius: 8, flex: "0 0 auto",
                    border: "1px solid var(--border)",
                    background: HEX.test(val) ? val : "transparent",
                  }} />
                  <input className="input" value={val} onChange={(e) => set(e.target.value)} placeholder="hex e.g. #0B1F3A" style={{ flex: 1 }} />
                </div>
              </div>
            ))}

            <h3 style={{ marginTop: 16, fontSize: 15 }}>Social links</h3>
            {SOCIAL_KEYS.map(({ key, label }) => (
              <div key={key} style={{ marginBottom: 10 }}>
                <label className="field-label">{label}</label>
                <input className="input" value={socials[key] || ""} onChange={(e) => setSocials((so) => ({ ...so, [key]: e.target.value }))}
                  placeholder="https://…" />
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && !error && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--gap-2)" }}>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save club page"}</button>
        </div>
      )}
    </div>
  );
}
