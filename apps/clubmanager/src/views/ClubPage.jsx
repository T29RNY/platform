import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  venueGetClubPage,
  venueSetClubPage,
  venuePublishClubPage,
} from "@platform/core/storage/supabase.js";
import { useToast } from "../shell/toast.jsx";

// Club page — the venue-admin edit surface for the club's public /c/<slug> page.
// Venue-token writes (venueSetClubPage / venuePublishClubPage, mig 515) — the
// venue-admin console edits the page WITHOUT a club_team_managers row, via the
// venue-token twins of club_set_page / club_publish_page. White-label theming
// (the 3 brand colours) is the headline: PA Sports navy/gold flows straight to
// the public page + the console shell.
//
// Deliberately OUT of scope (documented deferrals):
//  · crest/hero FILE upload — the club-media bucket RLS is club-manager-auth
//    (auth.uid → club_team_managers), so a pure venue admin can't upload a file.
//    URL fields work now; a venue-token signed-upload path is a follow-up PR.
//  · sections + get-involved links editing — preserved round-trip (never wiped)
//    but edited in the /hub club-settings wizard for now, not this MVP surface.
//  · safeguarding config — a separate tightening-only twin, not writable here.

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

export default function ClubPage({ venueId, clubId }) {
  const t = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const savingRef = useRef(false);

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
    if (!venueId || !clubId) return;
    setLoading(true); setError(false);
    try {
      const res = await venueGetClubPage(venueId, clubId);
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
      console.error("[clubmanager] venue_get_club_page failed", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [venueId, clubId]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async () => {
    if (savingRef.current) return;
    const s = slugify(slug);
    if (!s || !SLUG_OK.test(s)) { t.show("Pick a web address (lowercase letters, numbers, hyphens).", "error"); return; }
    for (const [c, lbl] of [[primary, "Primary"], [secondary, "Secondary"], [accent, "Accent"]]) {
      if (c && !HEX.test(c.trim())) { t.show(`${lbl} colour must be a hex code like #1A2B3C.`, "error"); return; }
    }
    savingRef.current = true; setBusy(true);
    try {
      await venueSetClubPage(venueId, clubId, {
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
      t.show("Club page saved.");
    } catch (err) {
      console.error("[clubmanager] venue_set_club_page failed", err);
      const code = err?.message || "";
      t.show(
        code.includes("slug_taken") ? "That web address is already taken — pick another."
        : code.includes("feature_disabled") ? "The public club page isn't enabled for this club."
        : code.includes("club_not_in_venue") ? "You can only edit pages for clubs at your venue."
        : "Couldn't save the club page.", "error");
    } finally {
      savingRef.current = false; setBusy(false);
    }
  }, [venueId, clubId, slug, primary, secondary, accent, crestUrl, heroUrl, tagline, about, socials, t]);

  const togglePublish = useCallback(async () => {
    if (publishing) return;
    if (!hasPage) { t.show("Save the page first, then publish it.", "error"); return; }
    const next = !published;
    setPublishing(true);
    try {
      await venuePublishClubPage(venueId, clubId, next);
      setPublished(next);
      t.show(next ? "Club page is now live." : "Club page unpublished.");
    } catch (err) {
      console.error("[clubmanager] venue_publish_club_page failed", err);
      t.show("Couldn't change the publish state.", "error");
    } finally {
      setPublishing(false);
    }
  }, [venueId, clubId, published, hasPage, publishing, t]);

  const publicUrl = slug ? `https://app.in-or-out.com/c/${slug}` : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Club page</h2>
          <p className="sub">Your public, white-label club page — branding, colours and the web address people find you at.</p>
        </div>
        {hasPage && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className={published ? "pill pill--live" : "pill"}>
              {published ? "Live" : "Draft"}
            </span>
            <button className="small" onClick={togglePublish} disabled={publishing}>
              {publishing ? "…" : published ? "Unpublish" : "Publish"}
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="state">Loading your club page…</div>
      ) : error ? (
        <div className="state">
          Couldn't load the club page. <button className="small" onClick={load}>Retry</button>
        </div>
      ) : (
        <div className="tiles tiles--2">
          <div className="tile" style={{ minHeight: 0 }}>
            <h3>Identity &amp; web address</h3>
            <label className="field"><span>Web address (slug)</span>
              <input value={slug} onChange={(e) => setSlug(e.target.value)}
                onBlur={(e) => setSlug(slugify(e.target.value))} placeholder="e.g. pa-sports" />
            </label>
            {publicUrl && (
              <div className="state" style={{ fontSize: 12, marginTop: -6 }}>
                {published
                  ? <>Live at <a href={publicUrl} target="_blank" rel="noreferrer">{publicUrl}</a></>
                  : <>Will be at {publicUrl} once published</>}
              </div>
            )}
            <label className="field"><span>Tagline</span>
              <input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="e.g. Grassroots football since 1998" />
            </label>
            <label className="field"><span>About</span>
              <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={4}
                placeholder="A short paragraph about your club." />
            </label>
            <label className="field"><span>Crest image URL</span>
              <input value={crestUrl} onChange={(e) => setCrestUrl(e.target.value)} placeholder="https://…" />
            </label>
            <label className="field"><span>Hero image URL</span>
              <input value={heroUrl} onChange={(e) => setHeroUrl(e.target.value)} placeholder="https://…" />
            </label>
            <div className="state" style={{ fontSize: 12 }}>
              Direct image upload arrives in a later release — paste an image URL for now.
            </div>
          </div>

          <div className="tile" style={{ minHeight: 0 }}>
            <h3>Brand colours</h3>
            <p className="sub" style={{ marginTop: -4 }}>White-label your public page. Hex codes like #0B1F3A.</p>
            {[["Primary", primary, setPrimary], ["Secondary", secondary, setSecondary], ["Accent", accent, setAccent]].map(([lbl, val, set]) => (
              <label className="field" key={lbl}><span>{lbl} colour</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span aria-hidden="true" style={{
                    width: 34, height: 34, borderRadius: 8, flex: "0 0 auto",
                    border: "1px solid var(--line)",
                    background: HEX.test(val) ? val : "transparent",
                  }} />
                  <input value={val} onChange={(e) => set(e.target.value)} placeholder="hex e.g. navy blue" style={{ flex: 1 }} />
                </div>
              </label>
            ))}

            <h3 style={{ marginTop: 16 }}>Social links</h3>
            {SOCIAL_KEYS.map(({ key, label }) => (
              <label className="field" key={key}><span>{label}</span>
                <input value={socials[key] || ""} onChange={(e) => setSocials((s) => ({ ...s, [key]: e.target.value }))}
                  placeholder="https://…" />
              </label>
            ))}
          </div>

          <div className="tile" style={{ minHeight: 0, gridColumn: "1 / -1" }}>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button className="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save club page"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
