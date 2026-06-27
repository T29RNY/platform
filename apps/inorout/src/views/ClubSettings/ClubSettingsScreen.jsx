import { useEffect, useRef, useState } from "react";
import {
  clubGetPage, clubSetPage, clubPublishPage,
  clubListSponsors, clubAddSponsor, clubUpdateSponsor, clubRemoveSponsor,
  clubListPosts, clubCreatePost, clubDeletePost, clubPublishPost,
  clubSetSafeguarding, uploadClubMedia, removeClubMedia,
} from "@platform/core/storage/supabase.js";
import {
  ArrowLeft, ArrowRight, Check, X, CaretUp, CaretDown, Eye, Globe, ShieldCheck,
  UploadSimple, Trash, Plus, ArrowSquareOut, PencilSimple, Warning, Sparkle,
} from "@phosphor-icons/react";
import {
  isValidHex, NEUTRAL_HEX, contrastVerdict, dominantColourFromImage,
  compressImage, IMG_TARGETS, slugify, SLUG_RE, SECTION_DEFS, normaliseSections,
  repackOrder, SOCIAL_FIELDS, TIERS,
} from "./clubSettingsHelpers.js";
import "./clubSettings.css";

// Modular Platform Epic B — Phase 5a. Club setup wizard + always-on edit dashboard.
// Club-manager surface for the public page at /c/<slug>. Writes go through the P3
// (mig 446) + P5a (mig 448) RPCs; reads via club_get_page (admin, any published
// state). Theming/type stay platform (Bebas / DM Sans / Phosphor thin); the only
// hex on this screen is the club's OWN colour data (entered via <input type=color>).

const PUBLIC_ORIGIN = "https://app.in-or-out.com"; // canonical; share step shows /c/<slug>

const STEPS = [
  { key: "identity",     label: "Club identity" },
  { key: "crest",        label: "Crest" },
  { key: "colours",      label: "Club colours" },
  { key: "hero",         label: "Hero image" },
  { key: "sections",     label: "Page sections" },
  { key: "teams",        label: "Teams" },
  { key: "sponsors",     label: "Sponsors" },
  { key: "news",         label: "First news post" },
  { key: "getInvolved",  label: "Get involved" },
  { key: "safeguarding", label: "Safeguarding" },
  { key: "publish",      label: "Preview & publish" },
];

const SETPAGE_ERRORS = {
  slug_invalid:   "That web address isn’t valid — use lowercase letters, numbers and hyphens.",
  slug_taken:     "That web address is already taken — try another.",
  invalid_colour: "One of the colours isn’t a valid hex value.",
  feature_disabled: "The public page feature isn’t enabled for this club.",
  not_authorised: "You don’t have permission to edit this club’s page.",
};
function friendlyErr(e, map = SETPAGE_ERRORS) {
  const code = (e?.message || "").replace(/^.*?:\s*/, "").trim();
  return map[code] || "Something went wrong — please try again.";
}

const EMPTY_FORM = {
  slug: "", primaryColour: "", secondaryColour: "", accentColour: "",
  crestUrl: "", heroUrl: "", tagline: "", about: "",
  socials: {}, sections: normaliseSections([]), links: [],
};

export default function ClubSettingsScreen({ clubId, clubName, managedTeams = [], onClose }) {
  const [loading, setLoading]   = useState(true);
  const [loadErr, setLoadErr]   = useState(false);
  const [mode, setMode]         = useState("wizard");      // wizard | dashboard
  const [step, setStep]         = useState(0);
  const [editKey, setEditKey]   = useState(null);          // dashboard: single-step editor
  const [form, setForm]         = useState(EMPTY_FORM);
  const [club, setClub]         = useState(null);
  const [safeguard, setSafeguard] = useState({ min_public_age: 18, hide_public_rosters: false });
  const [published, setPublished] = useState(false);
  const [sponsors, setSponsors] = useState([]);
  const [posts, setPosts]       = useState([]);
  const [banner, setBanner]     = useState(null);          // {kind:'err'|'ok', text}
  const savingRef = useRef(false);

  // ── load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setLoadErr(false);
      try {
        const [pageRes, sp, ps] = await Promise.all([
          clubGetPage(clubId),
          clubListSponsors(clubId).catch(() => []),
          clubListPosts(clubId).catch(() => []),
        ]);
        if (!alive) return;
        const c = pageRes?.club || null;
        setClub(c);
        if (pageRes?.safeguarding) setSafeguard(pageRes.safeguarding);
        setSponsors(Array.isArray(sp) ? sp : []);
        setPosts(Array.isArray(ps) ? ps : []);
        const p = pageRes?.page;
        if (p && p.slug) {
          setForm({
            slug: p.slug || "",
            primaryColour: p.primary_colour || "", secondaryColour: p.secondary_colour || "",
            accentColour: p.accent_colour || "", crestUrl: p.crest_url || "", heroUrl: p.hero_url || "",
            tagline: p.tagline || "", about: p.about || "",
            socials: p.socials || {}, sections: normaliseSections(p.sections),
            links: Array.isArray(p.links) ? p.links : [],
          });
          setPublished(!!p.published);
          setMode("dashboard");
        } else {
          // first run — prefill identity from the club record
          setForm({ ...EMPTY_FORM, slug: slugify(c?.name || clubName || ""), sections: normaliseSections([]) });
          setMode("wizard"); setStep(0);
        }
      } catch (e) {
        console.error("[club-settings] load failed", e);
        if (alive) setLoadErr(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [clubId, clubName]);

  const patch = (p) => setForm((f) => ({ ...f, ...p }));
  const patchSocial = (k, v) => setForm((f) => ({ ...f, socials: { ...f.socials, [k]: v } }));
  const flash = (kind, text) => { setBanner({ kind, text }); if (kind === "ok") setTimeout(() => setBanner(null), 2500); };

  // ── persist the whole page row (club_set_page is a full UPSERT) ─────────────
  const savePage = async () => {
    if (savingRef.current) return false;
    if (!SLUG_RE.test((form.slug || "").trim())) { flash("err", SETPAGE_ERRORS.slug_invalid); return false; }
    savingRef.current = true;
    try {
      await clubSetPage(clubId, {
        slug: form.slug.trim(),
        primaryColour: form.primaryColour.trim() || null,
        secondaryColour: form.secondaryColour.trim() || null,
        accentColour: form.accentColour.trim() || null,
        crestUrl: form.crestUrl || null, heroUrl: form.heroUrl || null,
        tagline: form.tagline.trim() || null, about: form.about.trim() || null,
        socials: cleanSocials(form.socials), sections: form.sections, links: cleanLinks(form.links),
      });
      setBanner(null);
      return true;
    } catch (e) {
      console.error("[club-settings] savePage failed", e);
      flash("err", friendlyErr(e));
      return false;
    } finally {
      savingRef.current = false;
    }
  };

  // ── image upload (compress → club-media → orphan-cleanup the replaced one) ───
  const uploadImage = async (file, kind, currentUrl) => {
    if (!file) return null;
    try {
      const compressed = await compressImage(file, IMG_TARGETS[kind] || {});
      const url = await uploadClubMedia(clubId, compressed, kind);
      if (url && currentUrl && currentUrl !== url) removeClubMedia(currentUrl);
      return url;
    } catch (e) {
      console.error("[club-settings] image upload failed", e);
      flash("err", "Image upload failed — please try a smaller file.");
      return null;
    }
  };

  // ── publish toggle ──────────────────────────────────────────────────────────
  const togglePublish = async (next) => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      // ensure the page row exists before publishing
      if (next) { const ok = await savePageInline(); if (!ok) return; }
      await clubPublishPage(clubId, next);
      setPublished(next);
      flash("ok", next ? "Your page is live." : "Your page is now a private draft.");
    } catch (e) {
      console.error("[club-settings] publish toggle failed", e);
      flash("err", friendlyErr(e));
    } finally {
      savingRef.current = false;
    }
  };
  // savePage without the savingRef guard (called from inside togglePublish)
  const savePageInline = async () => {
    try {
      await clubSetPage(clubId, {
        slug: form.slug.trim(),
        primaryColour: form.primaryColour.trim() || null, secondaryColour: form.secondaryColour.trim() || null,
        accentColour: form.accentColour.trim() || null, crestUrl: form.crestUrl || null, heroUrl: form.heroUrl || null,
        tagline: form.tagline.trim() || null, about: form.about.trim() || null,
        socials: cleanSocials(form.socials), sections: form.sections, links: cleanLinks(form.links),
      });
      return true;
    } catch (e) { console.error("[club-settings] savePageInline failed", e); flash("err", friendlyErr(e)); return false; }
  };

  if (loading) return <Shell onClose={onClose} title="Public page"><div className="cs-loading">Loading…</div></Shell>;
  if (loadErr) return <Shell onClose={onClose} title="Public page"><div className="cs-loading">Couldn’t load your page settings. Please try again.</div></Shell>;

  const stepProps = {
    form, patch, patchSocial, club, clubId, safeguard, setSafeguard, sponsors, setSponsors,
    posts, setPosts, managedTeams, uploadImage, flash, savePage,
  };

  // ── DASHBOARD ────────────────────────────────────────────────────────────────
  if (mode === "dashboard") {
    if (editKey) {
      const meta = STEPS.find((s) => s.key === editKey);
      return (
        <Shell onClose={onClose} title={meta?.label || "Edit"}>
          <div className="cs-editpanel">
            <button className="cs-back" onClick={() => setEditKey(null)}><ArrowLeft size={16} weight="thin" /> All settings</button>
            <h2 className="cs-step-title">{meta?.label}</h2>
            <StepBody stepKey={editKey} {...stepProps} />
            <div className="cs-editfoot">
              <button className="cs-btn cs-btn--primary" onClick={async () => {
                const pageStep = ["identity","crest","colours","hero","sections","getInvolved"].includes(editKey);
                if (pageStep) { const ok = await savePage(); if (!ok) return; }
                flash("ok", "Saved."); setEditKey(null);
              }}>
                <Check size={16} weight="thin" /> Done
              </button>
            </div>
          </div>
          {banner && <Banner banner={banner} />}
        </Shell>
      );
    }
    return (
      <Shell onClose={onClose} title="Manage public page">
        <DashboardHome
          club={club} form={form} published={published}
          onEdit={setEditKey} onTogglePublish={togglePublish}
          publicUrl={`${PUBLIC_ORIGIN}/c/${form.slug}`} slug={form.slug}
        />
        {banner && <Banner banner={banner} />}
      </Shell>
    );
  }

  // ── WIZARD ───────────────────────────────────────────────────────────────────
  const cur = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const goNext = async () => {
    const pageStep = ["identity","crest","colours","hero","sections","getInvolved"].includes(cur.key);
    if (pageStep) { const ok = await savePage(); if (!ok) return; }
    if (isLast) { setMode("dashboard"); return; }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  return (
    <Shell onClose={onClose} title="Set up your club page">
      <div className="cs-wizard">
        <nav className="cs-rail">
          <div className="cs-rail-head">SET UP · {STEPS.length} STEPS</div>
          {STEPS.map((s, i) => (
            <button key={s.key} className={`cs-rail-item${i === step ? " is-active" : ""}${i < step ? " is-done" : ""}`}
              onClick={() => setStep(i)}>
              <span className="cs-rail-num">{i < step ? <Check size={13} weight="thin" /> : i + 1}</span>
              <span className="cs-rail-label">{s.label}</span>
            </button>
          ))}
        </nav>
        <div className="cs-panel">
          <div className="cs-step-kicker">STEP {step + 1} OF {STEPS.length}</div>
          <h2 className="cs-step-title">{cur.label.toUpperCase()}</h2>
          <StepBody stepKey={cur.key} {...stepProps} publicUrl={`${PUBLIC_ORIGIN}/c/${form.slug}`}
            published={published} onTogglePublish={togglePublish} />
          <div className="cs-foot">
            {step > 0 && <button className="cs-btn cs-btn--ghost" onClick={() => setStep((s) => s - 1)}><ArrowLeft size={16} weight="thin" /> Back</button>}
            <div className="cs-foot-spacer" />
            <button className="cs-btn cs-btn--primary" onClick={goNext}>
              {isLast ? "Finish" : "Continue"} <ArrowRight size={16} weight="thin" />
            </button>
          </div>
        </div>
      </div>
      {banner && <Banner banner={banner} />}
    </Shell>
  );
}

// ── shell + chrome ──────────────────────────────────────────────────────────────
function Shell({ title, onClose, children }) {
  return (
    <div className="club-settings">
      <header className="cs-topbar">
        <span className="cs-topbar-title">{title}</span>
        <button className="cs-close" onClick={onClose} aria-label="Close"><X size={20} weight="thin" /></button>
      </header>
      <div className="cs-scroll">{children}</div>
    </div>
  );
}

function Banner({ banner }) {
  return (
    <div className={`cs-banner cs-banner--${banner.kind}`}>
      {banner.kind === "err" ? <Warning size={16} weight="thin" /> : <Check size={16} weight="thin" />}
      <span>{banner.text}</span>
    </div>
  );
}

// ── dashboard home ──────────────────────────────────────────────────────────────
function DashboardHome({ club, form, published, onEdit, onTogglePublish, publicUrl, slug }) {
  return (
    <div className="cs-dash">
      <div className="cs-dash-head">
        <div className="cs-dash-brand">
          <span className="cs-dash-crest">{form.crestUrl ? <img src={form.crestUrl} alt="" /> : (club?.short_name || club?.name || "?").slice(0, 3).toUpperCase()}</span>
          <div>
            <div className="cs-dash-name">{club?.name}</div>
            <div className={`cs-status cs-status--${published ? "live" : "draft"}`}>
              {published ? "● Published · live" : "● Draft · not public"}
            </div>
          </div>
        </div>
        <div className="cs-dash-actions">
          {published && <a className="cs-btn cs-btn--ghost" href={publicUrl} target="_blank" rel="noopener noreferrer"><Eye size={16} weight="thin" /> View</a>}
          <button className={`cs-btn ${published ? "cs-btn--ghost" : "cs-btn--primary"}`} onClick={() => onTogglePublish(!published)}>
            {published ? "Unpublish" : "Publish"}
          </button>
        </div>
      </div>

      <div className="cs-url-row">
        <Globe size={15} weight="thin" />
        <span className="cs-url">in-or-out.com/c/{slug || "…"}</span>
      </div>

      <div className="cs-dash-grid-label">EDIT ANY SECTION</div>
      <div className="cs-dash-grid">
        {STEPS.filter((s) => s.key !== "publish").map((s) => (
          <button key={s.key} className="cs-dash-card" onClick={() => onEdit(s.key)}>
            <span className="cs-dash-card-label">{s.label}</span>
            <PencilSimple size={15} weight="thin" />
          </button>
        ))}
      </div>

      <div className="cs-domain-soon">
        <Globe size={15} weight="thin" />
        <div>
          <div className="cs-domain-soon-t">Custom domain</div>
          <div className="cs-domain-soon-s">Use your own web address — coming soon.</div>
        </div>
      </div>
    </div>
  );
}

// ── step router ─────────────────────────────────────────────────────────────────
function StepBody(props) {
  switch (props.stepKey) {
    case "identity":     return <IdentityStep {...props} />;
    case "crest":        return <CrestStep {...props} />;
    case "colours":      return <ColoursStep {...props} />;
    case "hero":         return <HeroStep {...props} />;
    case "sections":     return <SectionsStep {...props} />;
    case "teams":        return <TeamsStep {...props} />;
    case "sponsors":     return <SponsorsStep {...props} />;
    case "news":         return <NewsStep {...props} />;
    case "getInvolved":  return <GetInvolvedStep {...props} />;
    case "safeguarding": return <SafeguardingStep {...props} />;
    case "publish":      return <PublishStep {...props} />;
    default:             return null;
  }
}

// ── shared field bits ─────────────────────────────────────────────────────────
function Field({ label, hint, children }) {
  return (
    <label className="cs-field">
      <span className="cs-field-label">{label}</span>
      {children}
      {hint && <span className="cs-field-hint">{hint}</span>}
    </label>
  );
}

function ImageField({ label, hint, kind, value, onUpload, onClear, aspect }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="cs-field">
      <span className="cs-field-label">{label}</span>
      <div className={`cs-img cs-img--${aspect || "wide"}`}>
        {value ? <img src={value} alt="" /> : <span className="cs-img-empty">No image yet</span>}
      </div>
      <div className="cs-img-actions">
        <button className="cs-btn cs-btn--ghost" disabled={busy} onClick={() => inputRef.current?.click()}>
          <UploadSimple size={15} weight="thin" /> {busy ? "Uploading…" : value ? "Replace" : "Upload"}
        </button>
        {value && <button className="cs-btn cs-btn--ghost" onClick={onClear}><Trash size={15} weight="thin" /> Remove</button>}
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden
          onChange={async (e) => {
            const file = e.target.files?.[0]; e.target.value = "";
            if (!file) return;
            setBusy(true);
            await onUpload(file);
            setBusy(false);
          }} />
      </div>
      {hint && <span className="cs-field-hint">{hint}</span>}
    </div>
  );
}

// ── 1. identity ───────────────────────────────────────────────────────────────
function IdentityStep({ form, patch, club }) {
  return (
    <div className="cs-body">
      <p className="cs-lead">The basics every visitor sees first. Pre-filled from your club — tweak anything.</p>
      <Field label="Club name" hint="Shown in the hero, nav and share card.">
        <input className="cs-input" value={club?.name || ""} disabled />
      </Field>
      <Field label="Web address" hint="Your permanent public link — lowercase letters, numbers and hyphens.">
        <div className="cs-slug">
          <span className="cs-slug-prefix">in-or-out.com/c/</span>
          <input className="cs-input" value={form.slug}
            onChange={(e) => patch({ slug: e.target.value.toLowerCase() })}
            onBlur={(e) => patch({ slug: slugify(e.target.value) })} placeholder="your-club" />
        </div>
      </Field>
      <Field label="Tagline" hint="One short line under your name. Optional.">
        <input className="cs-input" value={form.tagline} maxLength={80}
          onChange={(e) => patch({ tagline: e.target.value })} placeholder="Community since 1989" />
      </Field>
      <Field label="About" hint="A short paragraph about the club. Optional.">
        <textarea className="cs-input cs-textarea" rows={4} value={form.about}
          onChange={(e) => patch({ about: e.target.value })} placeholder="Who you are, where you play, who's welcome." />
      </Field>
      <div className="cs-sub-label">Social links</div>
      {SOCIAL_FIELDS.map((s) => (
        <Field key={s.key} label={s.label}>
          <input className="cs-input" value={form.socials?.[s.key] || ""} inputMode="url"
            onChange={(e) => patch({ socials: { ...form.socials, [s.key]: e.target.value } })}
            placeholder="https://…" />
        </Field>
      ))}
    </div>
  );
}

// ── 2. crest ────────────────────────────────────────────────────────────────────
function CrestStep({ form, patch, uploadImage }) {
  return (
    <div className="cs-body">
      <p className="cs-lead">Your badge. A square PNG or SVG with a transparent background works best.</p>
      <ImageField label="Club crest" aspect="square" value={form.crestUrl} kind="crest"
        hint="Square (512×512). PNG or SVG with transparency."
        onUpload={async (file) => { const url = await uploadImage(file, "crest", form.crestUrl); if (url) patch({ crestUrl: url }); return url; }}
        onClear={() => { removeClubMedia(form.crestUrl); patch({ crestUrl: "" }); }} />
    </div>
  );
}

// ── 3. colours ──────────────────────────────────────────────────────────────────
function Swatch({ label, value, onChange, suggest }) {
  const v = isValidHex(value) ? value : NEUTRAL_HEX;
  const verdict = isValidHex(value) ? contrastVerdict(value) : null;
  return (
    <Field label={label}>
      <div className="cs-swatch-row">
        <input type="color" className="cs-color" value={v} onChange={(e) => onChange(e.target.value)} />
        <input className="cs-input cs-input--hex" value={value} placeholder="hex e.g. 1a2b3c"
          onChange={(e) => onChange(e.target.value)} maxLength={7} />
        {suggest && <button className="cs-suggest" onClick={suggest} title="Suggest from crest"><Sparkle size={15} weight="thin" /></button>}
      </div>
      {verdict && (
        <span className={`cs-contrast cs-contrast--${verdict.level === "low" ? "bad" : "ok"}`}>
          {verdict.label}
        </span>
      )}
    </Field>
  );
}
function ColoursStep({ form, patch }) {
  const suggestFromCrest = async () => {
    if (!form.crestUrl) return;
    const hex = await dominantColourFromImage(form.crestUrl);
    if (hex) patch({ primaryColour: hex });
  };
  return (
    <div className="cs-body">
      <p className="cs-lead">Three colours skin the accents, headers and rails — the type and icons stay consistent. Contrast guidance is advisory.</p>
      <Swatch label="Primary" value={form.primaryColour} onChange={(v) => patch({ primaryColour: v })} suggest={form.crestUrl ? suggestFromCrest : null} />
      <Swatch label="Secondary" value={form.secondaryColour} onChange={(v) => patch({ secondaryColour: v })} />
      <Swatch label="Accent" value={form.accentColour} onChange={(v) => patch({ accentColour: v })} />
      <div className="cs-note">Leave any blank to use the platform default. Accent falls back to primary.</div>
    </div>
  );
}

// ── 4. hero ─────────────────────────────────────────────────────────────────────
function HeroStep({ form, patch, uploadImage }) {
  return (
    <div className="cs-body">
      <p className="cs-lead">A wide action shot behind your next fixture / latest result. Optional — a zero-config club still looks deliberate.</p>
      <ImageField label="Hero image" aspect="wide" value={form.heroUrl} kind="hero"
        hint="Landscape 16:9 (1920×1080). JPEG or WebP."
        onUpload={async (file) => { const url = await uploadImage(file, "hero", form.heroUrl); if (url) patch({ heroUrl: url }); return url; }}
        onClear={() => { removeClubMedia(form.heroUrl); patch({ heroUrl: "" }); }} />
    </div>
  );
}

// ── 5. sections ─────────────────────────────────────────────────────────────────
function SectionsStep({ form, patch }) {
  const secs = form.sections;
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= secs.length) return;
    const next = secs.slice();
    [next[i], next[j]] = [next[j], next[i]];
    patch({ sections: repackOrder(next) });
  };
  const toggle = (i) => {
    const next = secs.slice();
    next[i] = { ...next[i], enabled: !next[i].enabled };
    patch({ sections: next });
  };
  const defByKey = Object.fromEntries(SECTION_DEFS.map((d) => [d.key, d]));
  return (
    <div className="cs-body">
      <p className="cs-lead">Choose and order the blocks on your page. Each block hides itself when it has nothing to show.</p>
      <div className="cs-sections">
        {secs.map((s, i) => {
          const d = defByKey[s.key] || { label: s.key, desc: "", tag: "live" };
          return (
            <div key={s.key} className={`cs-sec-row${s.enabled ? "" : " is-off"}`}>
              <div className="cs-sec-move">
                <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><CaretUp size={14} weight="thin" /></button>
                <button onClick={() => move(i, 1)} disabled={i === secs.length - 1} aria-label="Move down"><CaretDown size={14} weight="thin" /></button>
              </div>
              <div className="cs-sec-main">
                <div className="cs-sec-title">{d.label}{d.tag === "soon" && <span className="cs-tag">setup soon</span>}</div>
                <div className="cs-sec-desc">{d.desc}</div>
              </div>
              <button className={`cs-switch${s.enabled ? " is-on" : ""}`} onClick={() => toggle(i)} aria-label="Toggle section">
                <span className="cs-switch-knob" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 6. teams (read-only confirm) ─────────────────────────────────────────────────
function TeamsStep({ managedTeams }) {
  const teams = managedTeams || [];
  return (
    <div className="cs-body">
      <p className="cs-lead">Your teams appear automatically — with under-18 squads safeguarded server-side. Nothing to set here.</p>
      {teams.length === 0 ? (
        <div className="cs-empty-box">No teams yet — they’ll be listed here as you add them.</div>
      ) : (
        <div className="cs-team-list">
          {teams.map((t) => (
            <div key={t.team_id} className="cs-team-chip">{t.team_name || t.name || "Team"}</div>
          ))}
        </div>
      )}
      <div className="cs-note">Squad rosters follow your safeguarding policy. Manage that in the Safeguarding step.</div>
    </div>
  );
}

// ── 7. sponsors ──────────────────────────────────────────────────────────────────
function SponsorsStep({ clubId, sponsors, setSponsors, uploadImage, flash }) {
  const [form, setForm] = useState({ name: "", websiteUrl: "", logoUrl: "", tier: "" });
  const [busy, setBusy] = useState(false);
  const reload = async () => { try { const list = await clubListSponsors(clubId); setSponsors(Array.isArray(list) ? list : []); } catch (e) { console.error("[club-settings] reload sponsors", e); } };
  const add = async () => {
    if (busy || !form.name.trim()) return;
    setBusy(true);
    try {
      await clubAddSponsor(clubId, form.name.trim(), form.logoUrl || null, form.websiteUrl.trim() || null, sponsors.length, form.tier || null);
      setForm({ name: "", websiteUrl: "", logoUrl: "", tier: "" });
      await reload();
    } catch (e) { console.error("[club-settings] add sponsor", e); flash("err", friendlyErr(e, { name_required: "A sponsor name is required.", invalid_tier: "Pick a valid tier." })); }
    finally { setBusy(false); }
  };
  const remove = async (id) => { try { await clubRemoveSponsor(id); await reload(); } catch (e) { console.error("[club-settings] remove sponsor", e); } };
  const setTier = async (id, tier) => { try { await clubUpdateSponsor(id, { tier: tier || "" }); await reload(); } catch (e) { console.error("[club-settings] sponsor tier", e); } };

  return (
    <div className="cs-body">
      <p className="cs-lead">Your backers, in tiers. Headline sponsors get hero billing; supporters sit in a grid.</p>
      {sponsors.length > 0 && (
        <div className="cs-list">
          {sponsors.map((s) => (
            <div key={s.sponsor_id} className="cs-list-row">
              <span className="cs-list-logo">{s.logo_url ? <img src={s.logo_url} alt="" /> : "—"}</span>
              <div className="cs-list-main"><div className="cs-list-title">{s.name}</div><div className="cs-list-sub">{s.website_url || "no link"}</div></div>
              <select className="cs-mini-select" value={s.tier || ""} onChange={(e) => setTier(s.sponsor_id, e.target.value)}>
                <option value="">Untiered</option>
                {TIERS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <button className="cs-icon-btn" onClick={() => remove(s.sponsor_id)} aria-label="Remove"><Trash size={15} weight="thin" /></button>
            </div>
          ))}
        </div>
      )}
      <div className="cs-addbox">
        <div className="cs-addbox-title">Add a sponsor</div>
        <Field label="Name"><input className="cs-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
        <Field label="Website"><input className="cs-input" value={form.websiteUrl} inputMode="url" onChange={(e) => setForm((f) => ({ ...f, websiteUrl: e.target.value }))} placeholder="https://…" /></Field>
        <Field label="Tier">
          <select className="cs-input" value={form.tier} onChange={(e) => setForm((f) => ({ ...f, tier: e.target.value }))}>
            <option value="">Untiered</option>
            {TIERS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </Field>
        <ImageField label="Logo" aspect="logo" value={form.logoUrl} kind="sponsor"
          hint="Bounded box (~400×200). PNG or SVG with transparency."
          onUpload={async (file) => { const url = await uploadImage(file, "sponsor", form.logoUrl); if (url) setForm((f) => ({ ...f, logoUrl: url })); return url; }}
          onClear={() => { removeClubMedia(form.logoUrl); setForm((f) => ({ ...f, logoUrl: "" })); }} />
        <button className="cs-btn cs-btn--primary" disabled={busy || !form.name.trim()} onClick={add}><Plus size={15} weight="thin" /> Add sponsor</button>
      </div>
    </div>
  );
}

// ── 8. news (first post) ──────────────────────────────────────────────────────────
function NewsStep({ clubId, posts, setPosts, uploadImage, flash }) {
  const [form, setForm] = useState({ title: "", body: "", heroUrl: "" });
  const [busy, setBusy] = useState(false);
  const reload = async () => { try { const list = await clubListPosts(clubId); setPosts(Array.isArray(list) ? list : []); } catch (e) { console.error("[club-settings] reload posts", e); } };
  const create = async () => {
    if (busy || !form.title.trim()) return;
    setBusy(true);
    try {
      const slug = slugify(form.title) + "-" + Math.random().toString(36).slice(2, 6);
      await clubCreatePost(clubId, { slug, title: form.title.trim(), body: form.body.trim() || null, heroUrl: form.heroUrl || null });
      setForm({ title: "", body: "", heroUrl: "" });
      await reload();
      flash("ok", "Draft saved. Publish it from the list below.");
    } catch (e) { console.error("[club-settings] create post", e); flash("err", friendlyErr(e, { title_required: "A title is required.", post_slug_taken: "A post with that title already exists." })); }
    finally { setBusy(false); }
  };
  const setLive = async (id, pub) => { try { await clubPublishPost(id, pub); await reload(); } catch (e) { console.error("[club-settings] publish post", e); } };
  const del = async (id) => { try { await clubDeletePost(id); await reload(); } catch (e) { console.error("[club-settings] delete post", e); } };

  return (
    <div className="cs-body">
      <p className="cs-lead">Your first match report or club update. Save as a draft, then publish when ready.</p>
      {posts.length > 0 && (
        <div className="cs-list">
          {posts.map((p) => (
            <div key={p.post_id} className="cs-list-row">
              <div className="cs-list-main"><div className="cs-list-title">{p.title}</div><div className="cs-list-sub">{p.status === "published" ? "Published" : "Draft"}</div></div>
              <button className="cs-btn cs-btn--ghost cs-btn--sm" onClick={() => setLive(p.post_id, p.status !== "published")}>{p.status === "published" ? "Unpublish" : "Publish"}</button>
              <button className="cs-icon-btn" onClick={() => del(p.post_id)} aria-label="Delete"><Trash size={15} weight="thin" /></button>
            </div>
          ))}
        </div>
      )}
      <div className="cs-addbox">
        <div className="cs-addbox-title">New post</div>
        <Field label="Title"><input className="cs-input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></Field>
        <Field label="Body"><textarea className="cs-input cs-textarea" rows={5} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} /></Field>
        <ImageField label="Header image" aspect="wide" value={form.heroUrl} kind="post"
          hint="Landscape 16:9 (1200×675). Optional."
          onUpload={async (file) => { const url = await uploadImage(file, "post", form.heroUrl); if (url) setForm((f) => ({ ...f, heroUrl: url })); return url; }}
          onClear={() => { removeClubMedia(form.heroUrl); setForm((f) => ({ ...f, heroUrl: "" })); }} />
        <button className="cs-btn cs-btn--primary" disabled={busy || !form.title.trim()} onClick={create}><Plus size={15} weight="thin" /> Save draft</button>
      </div>
    </div>
  );
}

// ── 9. get involved (links) ───────────────────────────────────────────────────────
function GetInvolvedStep({ form, patch }) {
  const links = form.links || [];
  const set = (i, key, val) => { const next = links.slice(); next[i] = { ...next[i], [key]: val }; patch({ links: next }); };
  const add = () => patch({ links: [...links, { label: "", url: "" }] });
  const remove = (i) => patch({ links: links.filter((_, j) => j !== i) });
  return (
    <div className="cs-body">
      <p className="cs-lead">Calls to action beyond joining — volunteer, club shop, lottery, donate. The Join button is always shown.</p>
      {links.map((l, i) => (
        <div key={i} className="cs-link-row">
          <input className="cs-input" value={l.label} placeholder="Label (e.g. Club shop)" onChange={(e) => set(i, "label", e.target.value)} />
          <input className="cs-input" value={l.url} placeholder="https://…" inputMode="url" onChange={(e) => set(i, "url", e.target.value)} />
          <button className="cs-icon-btn" onClick={() => remove(i)} aria-label="Remove"><Trash size={15} weight="thin" /></button>
        </div>
      ))}
      <button className="cs-btn cs-btn--ghost" onClick={add}><Plus size={15} weight="thin" /> Add link</button>
    </div>
  );
}

// ── 10. safeguarding (tightening-only) ──────────────────────────────────────────────
function SafeguardingStep({ clubId, safeguard, setSafeguard, flash }) {
  const [busy, setBusy] = useState(false);
  const save = async (next) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await clubSetSafeguarding(clubId, { minPublicAge: next.min_public_age, hidePublicRosters: next.hide_public_rosters });
      setSafeguard({ min_public_age: res.min_public_age, hide_public_rosters: res.hide_public_rosters });
      flash("ok", "Safeguarding updated.");
    } catch (e) {
      console.error("[club-settings] safeguarding", e);
      flash("err", friendlyErr(e, { safeguarding_cannot_weaken: "You can only strengthen safeguarding here — loosening is set by the venue.", invalid_min_age: "Enter an age between 0 and 99." }));
    } finally { setBusy(false); }
  };
  return (
    <div className="cs-body">
      <div className="cs-sg-banner"><ShieldCheck size={18} weight="thin" /> Tightening only — you can make safeguarding stronger, never weaker. Loosening is the venue’s call.</div>
      <Field label="Minimum public age" hint="Players under this age show as first name + initial, with no photo.">
        <input className="cs-input" type="number" min={0} max={99} value={safeguard.min_public_age}
          onChange={(e) => setSafeguard((s) => ({ ...s, min_public_age: Number(e.target.value) }))} />
      </Field>
      <label className="cs-checkrow">
        <input type="checkbox" checked={!!safeguard.hide_public_rosters}
          onChange={(e) => setSafeguard((s) => ({ ...s, hide_public_rosters: e.target.checked }))} />
        <span>Hide squad lists entirely</span>
      </label>
      <button className="cs-btn cs-btn--primary" disabled={busy} onClick={() => save(safeguard)}><Check size={15} weight="thin" /> Save safeguarding</button>
    </div>
  );
}

// ── 11. preview & publish ────────────────────────────────────────────────────────
function PublishStep({ form, published, onTogglePublish, publicUrl }) {
  return (
    <div className="cs-body">
      <p className="cs-lead">Preview your page exactly as the public sees it. Nothing is public until you publish.</p>
      <div className="cs-url-row"><Globe size={15} weight="thin" /><span className="cs-url">in-or-out.com/c/{form.slug || "…"}</span></div>
      {published && <a className="cs-btn cs-btn--ghost" href={publicUrl} target="_blank" rel="noopener noreferrer"><ArrowSquareOut size={15} weight="thin" /> Open live preview</a>}
      <div className="cs-publish-box">
        <div className={`cs-status cs-status--${published ? "live" : "draft"}`}>{published ? "● Published · live" : "● Draft · not public"}</div>
        <button className={`cs-btn ${published ? "cs-btn--ghost" : "cs-btn--primary"}`} onClick={() => onTogglePublish(!published)}>
          {published ? "Unpublish" : "Publish now"}
        </button>
      </div>
      <div className="cs-domain-soon">
        <Globe size={15} weight="thin" />
        <div><div className="cs-domain-soon-t">Custom domain</div><div className="cs-domain-soon-s">Use your own web address — coming soon.</div></div>
      </div>
    </div>
  );
}

// ── jsonb cleaners ──────────────────────────────────────────────────────────────
function cleanSocials(socials) {
  const out = {};
  Object.entries(socials || {}).forEach(([k, v]) => { const t = (v || "").trim(); if (t) out[k] = t; });
  return out;
}
function cleanLinks(links) {
  return (links || []).map((l) => ({ label: (l.label || "").trim(), url: (l.url || "").trim() }))
    .filter((l) => l.label && l.url);
}
