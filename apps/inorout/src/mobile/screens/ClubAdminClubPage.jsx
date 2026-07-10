// ClubAdminClubPage.jsx — Club-admin track, secondary /hub screen ("Club page"),
// opened from the More hub for a club_admin role (Club Console PR #6b). The phone
// twin of the desktop club-lens editor apps/venue/src/views/ClubPageEditor.jsx,
// scoped to the ONE club whose shell venue the caller owns.
//
// Mirrors the DESKTOP editor's field set 1:1 (walk round-2): web address (slug),
// tagline, about, crest + hero image URLs, three brand colours, and the five social
// links — plus the publish toggle and an "Open public page" button. sections[] and
// get-involved links[] stay preserved-round-trip (the desktop editor defers them to
// the /hub club-settings wizard too), so a mobile save never wipes them.
//
// AUTH: a club admin passes their shell venue_id as the venue-token credential.
// resolve_venue_caller authenticates via auth.uid() against venue_admins (same
// venue-token path the operator track + desktop console use). No new backend.
//
// ── WRAPPERS (verified against packages/core/storage/supabase.js + mig 515) ──
// venueGetClubPage(venueToken, clubId) → { page, club, safeguarding }. `page` (or
//   NULL) = { slug, published, primary_colour, secondary_colour, accent_colour,
//   crest_url, hero_url, tagline, about, socials, sections, links }.
// venueSetClubPage(venueToken, clubId, { slug, primaryColour, secondaryColour,
//   accentColour, crestUrl, heroUrl, tagline, about, socials, sections, links })
//   → RPC venue_set_club_page. ⚠️ FULL-ROW UPSERT — every column is written from the
//   args, so sections[]/links[] MUST be round-tripped or they wipe. Errors
//   (err.message): slug_invalid, slug_taken, feature_disabled, club_not_in_venue.
// venuePublishClubPage(venueToken, clubId, published) → { ok, published }.

import { useState, useEffect, useCallback, useRef } from "react";
import { venueGetClubPage, venueSetClubPage, venuePublishClubPage } from "@platform/core";
import MIcon from "../icons.jsx";

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

function FieldLabel({ children, style }) {
  return <div style={{ fontSize: 12, color: "var(--ink3)", ...style }}>{children}</div>;
}

export default function ClubAdminClubPage({ venueToken, clubId, clubName, toast, onBack }) {
  const [meta, setMeta] = useState({ loading: true, error: false, hasPage: false, published: false });
  const [slug, setSlug] = useState("");
  const [tagline, setTagline] = useState("");
  const [about, setAbout] = useState("");
  const [crestUrl, setCrestUrl] = useState("");
  const [heroUrl, setHeroUrl] = useState("");
  const [primary, setPrimary] = useState("");
  const [secondary, setSecondary] = useState("");
  const [accent, setAccent] = useState("");
  const [socials, setSocials] = useState({});
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const savingRef = useRef(false);
  // sections[] + get-involved links[] are edited in the desktop /hub wizard — round-trip
  // them verbatim so a mobile save (full-row upsert) never wipes them.
  const preserved = useRef({ sections: [], links: [] });

  const load = useCallback(async () => {
    if (!venueToken || !clubId) { setMeta({ loading: false, error: false, hasPage: false, published: false }); return; }
    setMeta((m) => ({ ...m, loading: true, error: false }));
    try {
      const res = await venueGetClubPage(venueToken, clubId);
      const p = res?.page || null;
      setSlug(p?.slug || slugify(res?.club?.name || clubName || ""));
      setTagline(p?.tagline || "");
      setAbout(p?.about || "");
      setCrestUrl(p?.crest_url || "");
      setHeroUrl(p?.hero_url || "");
      setPrimary(p?.primary_colour || "");
      setSecondary(p?.secondary_colour || "");
      setAccent(p?.accent_colour || "");
      setSocials(p?.socials && typeof p.socials === "object" ? p.socials : {});
      preserved.current = {
        sections: Array.isArray(p?.sections) ? p.sections : [],
        links: Array.isArray(p?.links) ? p.links : [],
      };
      setMeta({ loading: false, error: false, hasPage: !!p, published: !!p?.published });
    } catch {
      setMeta({ loading: false, error: true, hasPage: false, published: false });
    }
  }, [venueToken, clubId, clubName]);

  useEffect(() => { load(); }, [load]);

  const { loading, error, hasPage, published } = meta;
  const cleanSlug = slugify(slug);
  const publicUrl = cleanSlug ? `https://app.in-or-out.com/c/${cleanSlug}` : null;

  // ── Save every editable field (round-tripping sections + links) ──
  const save = useCallback(async () => {
    if (savingRef.current) return;
    const s = slugify(slug);
    if (!s || !SLUG_OK.test(s)) { toast?.({ icon: "alert", text: "Pick a web address (lowercase letters, numbers, hyphens)" }); return; }
    for (const [c, lbl] of [[primary, "Primary"], [secondary, "Secondary"], [accent, "Accent"]]) {
      if (c && !HEX.test(c.trim())) { toast?.({ icon: "alert", text: `${lbl} colour must be a hex code like #1A2B3C` }); return; }
    }
    savingRef.current = true; setSaving(true);
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
        socials,                               // round-trip
        sections: preserved.current.sections,  // preserved — never wiped
        links: preserved.current.links,        // preserved — never wiped
      });
      setSlug(s);
      setMeta((m) => ({ ...m, hasPage: true }));
      toast?.({ icon: "check", text: "Club page saved" });
    } catch (err) {
      console.error("[club-page] venue_set_club_page failed", err);
      const code = err?.message || "";
      toast?.({ icon: "alert", text:
        code.includes("slug_taken") ? "That web address is taken — pick another"
        : code.includes("feature_disabled") ? "Turn on the Public page module on desktop first"
        : code.includes("club_not_in_venue") ? "You can only edit your own club’s page"
        : "Couldn’t save — your edits are kept, try again" });
    } finally {
      savingRef.current = false; setSaving(false);
    }
  }, [venueToken, clubId, slug, primary, secondary, accent, crestUrl, heroUrl, tagline, about, socials, toast]);

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

      {/* ── status + public URL + publish + open ── */}
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
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 13, padding: "9px 11px",
            borderRadius: "var(--r-sm)", background: "var(--s3)", border: "1px solid var(--hair)" }}>
            <MIcon name="globe" size={15} color="var(--ink3)" />
            <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--ink2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {published ? `app.in-or-out.com/c/${cleanSlug}` : `${`app.in-or-out.com/c/${cleanSlug}`} · goes live when published`}
            </span>
            {published && (
              <a href={publicUrl} target="_blank" rel="noreferrer" style={{
                flex: "none", display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: "var(--r-pill)",
                background: "var(--amber-soft)", border: "1px solid var(--amber-glow)", color: "var(--amber)",
                fontFamily: "var(--m-font)", fontWeight: 700, fontSize: 12, textDecoration: "none",
              }}><MIcon name="arrow" size={13} color="var(--amber)" /> Open</a>
            )}
          </div>
        )}
      </div>

      {/* ── identity + content ── */}
      <div className="m-eyebrow" style={{ margin: "0 2px 9px" }}>Identity &amp; content</div>
      <div className="m-card" style={{ padding: 16, marginBottom: 12 }}>
        <FieldLabel>Web address</FieldLabel>
        <input value={slug} onChange={(e) => setSlug(e.target.value)} onBlur={(e) => setSlug(slugify(e.target.value))}
          placeholder="e.g. pa-sports" style={inputStyle} />
        <FieldLabel style={{ marginTop: 16 }}>Tagline</FieldLabel>
        <input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="e.g. Grassroots football since 1998" maxLength={120} style={inputStyle} />
        <FieldLabel style={{ marginTop: 16 }}>About</FieldLabel>
        <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={5} placeholder="A short paragraph about your club." maxLength={1200}
          style={{ ...inputStyle, resize: "vertical", lineHeight: 1.45 }} />
        <FieldLabel style={{ marginTop: 16 }}>Crest image URL</FieldLabel>
        <input value={crestUrl} onChange={(e) => setCrestUrl(e.target.value)} placeholder="https://…" style={inputStyle} />
        <FieldLabel style={{ marginTop: 16 }}>Hero image URL</FieldLabel>
        <input value={heroUrl} onChange={(e) => setHeroUrl(e.target.value)} placeholder="https://…" style={inputStyle} />
        <div style={{ fontSize: 11.5, color: "var(--ink4)", marginTop: 8, lineHeight: 1.4 }}>
          Paste an image URL for now — direct upload arrives in a later release.
        </div>
      </div>

      {/* ── brand colours ── */}
      <div className="m-eyebrow" style={{ margin: "0 2px 9px" }}>Brand colours</div>
      <div className="m-card" style={{ padding: 16, marginBottom: 12 }}>
        {[["Primary", primary, setPrimary], ["Secondary", secondary, setSecondary], ["Accent", accent, setAccent]].map(([lbl, val, set], i) => (
          <div key={lbl} style={{ marginTop: i ? 14 : 0 }}>
            <FieldLabel>{lbl}</FieldLabel>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
              <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 9, flex: "none", border: "1px solid var(--hair)", background: HEX.test(val) ? val : "var(--s3)" }} />
              <input value={val} onChange={(e) => set(e.target.value)} placeholder="hex e.g. #0B1F3A" style={{ ...inputStyle, marginTop: 0, flex: 1 }} />
            </div>
          </div>
        ))}
      </div>

      {/* ── social links ── */}
      <div className="m-eyebrow" style={{ margin: "0 2px 9px" }}>Social links</div>
      <div className="m-card" style={{ padding: 16, marginBottom: 12 }}>
        {SOCIAL_KEYS.map(({ key, label }, i) => (
          <div key={key} style={{ marginTop: i ? 14 : 0 }}>
            <FieldLabel>{label}</FieldLabel>
            <input value={socials[key] || ""} onChange={(e) => setSocials((so) => ({ ...so, [key]: e.target.value }))} placeholder="https://…" style={inputStyle} />
          </div>
        ))}
      </div>

      <button onClick={save} disabled={saving} style={{ ...btnPrimary, width: "100%", marginBottom: 4, opacity: saving ? 0.6 : 1 }}>
        {saving ? "Saving…" : "Save club page"}
      </button>
      <div style={{ fontSize: 11.5, color: "var(--ink4)", margin: "10px 2px 0", lineHeight: 1.4 }}>
        Page sections and get-involved links are built in the desktop console; they’re kept intact when you save here.
      </div>
    </div>
  );
}
