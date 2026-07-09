// ClubAdminClubPage.jsx — Club-admin track, secondary /hub screen ("Club page"),
// opened from the More hub for a club_admin role (Club Console PR #6b). The phone
// twin of the desktop club-lens editor apps/venue/src/views/ClubPageEditor.jsx,
// scoped to the ONE club whose shell venue the caller owns.
//
// A FOCUSED mobile editor — NOT the full desktop editor. Only the two safe,
// high-value TEXT fields are editable here (tagline + about) plus the publish
// toggle. Branding colours, crest/hero images, social links and section builders
// stay on the desktop console (surfaced as an "edit on desktop" note).
//
// AUTH: a club admin passes their shell venue_id as the venue-token credential.
// resolve_venue_caller authenticates via auth.uid() against venue_admins (same
// venue-token path the operator track + desktop console use). No new backend.
//
// ── WRAPPERS (verified against packages/core/storage/supabase.js + mig 515) ──
//
// venueGetClubPage(venueToken, clubId) → RPC venue_get_club_page(p_venue_token,
//   p_club_id). Returns { page, club, safeguarding }. `page` is to_jsonb(club_pages)
//   minus created_at/updated_at (or NULL if no page yet): { club_id, slug, published,
//   primary_colour, secondary_colour, accent_colour, crest_url, hero_url, tagline,
//   about, socials, sections, links }. `club` = { id, name, short_name, discipline,
//   founded_year, contact_name, contact_email }. `safeguarding` = { min_public_age,
//   hide_public_rosters }.
//
// venueSetClubPage(venueToken, clubId, { slug, primaryColour, secondaryColour,
//   accentColour, crestUrl, heroUrl, tagline, about, socials, sections, links })
//   → RPC venue_set_club_page. camelCase option keys → p_* args. ⚠️ FULL-ROW UPSERT:
//   every column is written from the args, so any field NOT passed is WIPED. Slug is
//   REQUIRED (no default). => we ROUND-TRIP all desktop-owned fields (slug, colours,
//   images, socials, sections, links) through a ref and only change tagline + about.
//   Errors (err.message): slug_invalid, slug_taken, feature_disabled, club_not_in_venue.
//
// venuePublishClubPage(venueToken, clubId, published) → RPC venue_publish_club_page
//   (p_venue_token, p_club_id, p_published boolean). Returns { ok, published }.

import { useState, useEffect, useCallback, useRef } from "react";
import { venueGetClubPage, venueSetClubPage, venuePublishClubPage } from "@platform/core";
import MIcon from "../icons.jsx";

const slugify = (s) => (s || "").toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");

const inputStyle = {
  width: "100%", padding: "10px 12px", borderRadius: "var(--r-sm)",
  border: "1px solid var(--hair)", background: "var(--s3)", color: "var(--ink)",
  fontFamily: "var(--m-font)", fontSize: 14, marginTop: 4,
};
const btnPrimary = {
  padding: "11px 16px", borderRadius: "var(--r-sm)", background: "var(--amber)",
  color: "var(--amber-ink)", border: "none", fontFamily: "var(--m-font)", fontWeight: 700, cursor: "pointer",
};

function Header({ onBack }) {
  return (
    <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "none",
      border: 0, color: "var(--ink3)", fontFamily: "var(--m-font)", fontSize: 13, cursor: "pointer", marginBottom: 12 }}>
      <MIcon name="chevleft" size={16} color="var(--ink3)" /> Club page
    </button>
  );
}

export default function ClubAdminClubPage({ venueToken, clubId, clubName, toast, onBack }) {
  const [meta, setMeta] = useState({ loading: true, error: false, hasPage: false, published: false, slug: "" });
  const [tagline, setTagline] = useState("");
  const [about, setAbout] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const savingRef = useRef(false);
  // desktop-owned fields — round-tripped verbatim so a mobile save never wipes them
  const preserved = useRef({ slug: "", primary_colour: null, secondary_colour: null, accent_colour: null,
    crest_url: null, hero_url: null, socials: {}, sections: [], links: [] });

  const load = useCallback(async () => {
    if (!venueToken || !clubId) { setMeta({ loading: false, error: false, hasPage: false, published: false, slug: "" }); return; }
    setMeta((m) => ({ ...m, loading: true, error: false }));
    try {
      const res = await venueGetClubPage(venueToken, clubId);
      const p = res?.page || null;
      const slug = p?.slug || slugify(res?.club?.name || clubName || "");
      preserved.current = {
        slug,
        primary_colour: p?.primary_colour || null,
        secondary_colour: p?.secondary_colour || null,
        accent_colour: p?.accent_colour || null,
        crest_url: p?.crest_url || null,
        hero_url: p?.hero_url || null,
        socials: p?.socials && typeof p.socials === "object" ? p.socials : {},
        sections: Array.isArray(p?.sections) ? p.sections : [],
        links: Array.isArray(p?.links) ? p.links : [],
      };
      setTagline(p?.tagline || "");
      setAbout(p?.about || "");
      setMeta({ loading: false, error: false, hasPage: !!p, published: !!p?.published, slug });
    } catch {
      setMeta({ loading: false, error: true, hasPage: false, published: false, slug: "" });
    }
  }, [venueToken, clubId, clubName]);

  useEffect(() => { load(); }, [load]);

  const { loading, error, hasPage, published, slug } = meta;
  const publicUrl = slug ? `app.in-or-out.com/c/${slug}` : null;

  // ── Save the two text fields (round-tripping everything else) ──
  const save = useCallback(async () => {
    if (savingRef.current) return;
    const s = (preserved.current.slug || "").trim();
    if (!s) { toast?.({ icon: "alert", text: "Set your page’s web address on desktop first" }); return; }
    savingRef.current = true; setSaving(true);
    try {
      await venueSetClubPage(venueToken, clubId, {
        slug: s,
        primaryColour: preserved.current.primary_colour,
        secondaryColour: preserved.current.secondary_colour,
        accentColour: preserved.current.accent_colour,
        crestUrl: preserved.current.crest_url,
        heroUrl: preserved.current.hero_url,
        tagline: tagline.trim() || null,
        about: about.trim() || null,
        socials: preserved.current.socials,   // round-trip — never wiped
        sections: preserved.current.sections, // round-trip — never wiped
        links: preserved.current.links,       // round-trip — never wiped
      });
      setMeta((m) => ({ ...m, hasPage: true }));
      toast?.({ icon: "check", text: "Club page saved" });
    } catch (err) {
      console.error("[club-page] venue_set_club_page failed", err);
      const code = err?.message || "";
      toast?.({ icon: "alert", text:
        code.includes("slug_taken") ? "That web address is taken — change it on desktop"
        : code.includes("feature_disabled") ? "Turn on the Public page module on desktop first"
        : code.includes("club_not_in_venue") ? "You can only edit your own club’s page"
        : "Couldn’t save — your edits are kept, try again" });
    } finally {
      savingRef.current = false; setSaving(false);
    }
  }, [venueToken, clubId, tagline, about, toast]);

  // ── Publish / unpublish (guarded + confirmed) ──
  const togglePublish = useCallback(async () => {
    if (publishing) return;
    if (!hasPage) { toast?.({ icon: "alert", text: "Save your page first, then publish it" }); return; }
    const next = !published;
    const ok = window.confirm(next
      ? "Publish your club page? It becomes publicly visible at your web address."
      : "Unpublish your club page? It will no longer be publicly visible.");
    if (!ok) return;
    setPublishing(true);
    try {
      await venuePublishClubPage(venueToken, clubId, next);
      setMeta((m) => ({ ...m, published: next }));
      toast?.({ icon: next ? "globe" : "check", text: next ? "Club page is now live" : "Club page unpublished" });
    } catch (err) {
      console.error("[club-page] venue_publish_club_page failed", err);
      toast?.({ icon: "alert", text: "Couldn’t change publish state — try again" });
    } finally {
      setPublishing(false);
    }
  }, [venueToken, clubId, published, hasPage, publishing, toast]);

  if (loading) {
    return (
      <div className="m-view-enter">
        <Header onBack={onBack} />
        <div className="m-card" style={{ padding: 16 }}>
          <div className="m-eyebrow">Club page</div>
          <p style={{ color: "var(--ink3)", fontSize: 14, marginTop: 8 }}>Loading {clubName || "your club"}…</p>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="m-view-enter">
        <Header onBack={onBack} />
        <div className="m-card" style={{ padding: 16 }}>
          <div className="m-eyebrow">Club page</div>
          <p style={{ color: "var(--ink2)", fontSize: 14, margin: "8px 0 12px" }}>Couldn’t load your club page.</p>
          <button onClick={load} style={btnPrimary}>Try again</button>
        </div>
      </div>
    );
  }

  return (
    <div className="m-view-enter">
      <Header onBack={onBack} />

      {/* ── status + public URL + publish toggle ── */}
      <div className="m-card" style={{ padding: 16, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div className="m-eyebrow">{clubName || "Your club"}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 5 }}>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 5, height: 22, padding: "0 9px",
                borderRadius: "var(--r-pill)", fontSize: 11.5, fontWeight: 700,
                background: published ? "var(--ok-soft)" : "var(--s4)",
                color: published ? "var(--ok-ink)" : "var(--ink3)",
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: published ? "var(--ok)" : "var(--ink4)" }} />
                {published ? "Live" : "Draft"}
              </span>
            </div>
          </div>
          <button onClick={togglePublish} disabled={publishing || !hasPage} style={{
            flex: "none", padding: "9px 15px", borderRadius: "var(--r-pill)", fontFamily: "var(--m-font)",
            fontWeight: 700, fontSize: 13, cursor: publishing || !hasPage ? "default" : "pointer",
            opacity: publishing || !hasPage ? 0.5 : 1,
            background: published ? "var(--s3)" : "var(--amber-soft)",
            border: published ? "1px solid var(--hair2)" : "1px solid var(--amber-glow)",
            color: published ? "var(--ink2)" : "var(--amber)",
          }}>{publishing ? "…" : published ? "Unpublish" : "Publish"}</button>
        </div>

        {publicUrl && (
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 13, padding: "9px 11px",
            borderRadius: "var(--r-sm)", background: "var(--s3)", border: "1px solid var(--hair)" }}>
            <MIcon name="globe" size={15} color="var(--ink3)" />
            <span style={{ fontSize: 12.5, color: "var(--ink2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {published ? publicUrl : `${publicUrl} · goes live when published`}
            </span>
          </div>
        )}
      </div>

      {/* ── editable text fields ── */}
      <div className="m-eyebrow" style={{ margin: "0 2px 9px" }}>Page content</div>
      <div className="m-card" style={{ padding: 16, marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 12, color: "var(--ink3)" }}>
          Tagline
          <input value={tagline} onChange={(e) => setTagline(e.target.value)}
            placeholder="e.g. Grassroots football since 1998" maxLength={120} style={inputStyle} />
        </label>
        <label style={{ display: "block", fontSize: 12, color: "var(--ink3)", marginTop: 16 }}>
          About
          <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={5}
            placeholder="A short paragraph about your club." maxLength={1200}
            style={{ ...inputStyle, resize: "vertical", lineHeight: 1.45 }} />
        </label>
        <button onClick={save} disabled={saving} style={{ ...btnPrimary, width: "100%", marginTop: 16, opacity: saving ? 0.6 : 1 }}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>

      {/* ── desktop-only note ── */}
      <div className="m-card" style={{ padding: "13px 14px", display: "flex", alignItems: "flex-start", gap: 11 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, flex: "none", background: "var(--s4)",
          display: "flex", alignItems: "center", justifyContent: "center" }}>
          <MIcon name="info" size={17} color="var(--ink3)" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink2)" }}>Edit branding on desktop</div>
          <div style={{ fontSize: 12, color: "var(--ink3)", marginTop: 2, lineHeight: 1.4 }}>
            Web address, brand colours, crest &amp; hero images, social links and page sections are set on the web console.
          </div>
        </div>
      </div>
    </div>
  );
}
