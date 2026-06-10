import React, { useState, useEffect, useRef } from "react";
import Modal from "./Modal.jsx";
import { venueUpdateDisplayConfig, uploadVenueMedia } from "@platform/core/storage/supabase.js";

// All selectable display zones, with operator-friendly labels.
const ZONE_LABELS = {
  live_scores: "Live scores",
  standings: "League table",
  top_scorers: "Top scorers",
  upcoming: "Upcoming fixtures",
  recent: "Recent results",
  goals_ticker: "Goals ticker",
  custom_message: "Custom message",
};
const ALL_ZONES = Object.keys(ZONE_LABELS);
const DEFAULT_ZONES = ["live_scores", "standings", "top_scorers", "goals_ticker"];

// Build the ordered enable/disable list: enabled (in saved order) first, then the rest off.
function buildZoneList(cfg) {
  const enabled = Array.isArray(cfg?.zones) && cfg.zones.length ? cfg.zones : DEFAULT_ZONES;
  const seen = new Set();
  const list = [];
  for (const k of enabled) if (ALL_ZONES.includes(k) && !seen.has(k)) { list.push({ key: k, on: true }); seen.add(k); }
  for (const k of ALL_ZONES) if (!seen.has(k)) list.push({ key: k, on: false });
  return list;
}

// Featured-pin expiry presets → ISO timestamp (or null = until unpinned).
const EXPIRY_OPTIONS = [
  { key: "none", label: "Until unpinned" },
  { key: "1h", label: "1 hour" },
  { key: "3h", label: "3 hours" },
  { key: "tonight", label: "End of tonight" },
];
function expiryToIso(key) {
  if (key === "1h") return new Date(Date.now() + 3600e3).toISOString();
  if (key === "3h") return new Date(Date.now() + 3 * 3600e3).toISOString();
  if (key === "tonight") { const d = new Date(); d.setHours(23, 59, 0, 0); return d.toISOString(); }
  return null;
}

const SAVE_ERRORS = {
  pin_invalid: "PIN must be 4–8 digits.",
  interval_out_of_range: "Cycle time must be 10–60 seconds.",
  fixture_not_in_venue: "That fixture isn't part of this venue's competitions.",
  featured_fixture_invalid: "Couldn't read the pinned fixture — unpin and try again.",
  featured_expiry_invalid: "Couldn't read the pin expiry — try a different option.",
  sponsor_ratio_invalid: "Sponsor share must be a number.",
  config_field_invalid: "One of the sponsor fields couldn't be saved — check for unusual characters.",
  insufficient_role: "Your role can't change display settings — ask a manager.",
};

export default function DisplaySettings({ open, onClose, venueToken, venue, fixtures = [], teams = {}, onSaved }) {
  const [zones, setZones] = useState([]);
  const [mode, setMode] = useState("smart");
  const [interval, setIntervalSecs] = useState(15);
  const [message, setMessage] = useState("");
  const [pin, setPin] = useState("");
  const [removePin, setRemovePin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  // sponsor creative
  const [sponsorLabel, setSponsorLabel] = useState("");
  const [sponsorTitle, setSponsorTitle] = useState("");
  const [sponsorBody, setSponsorBody] = useState("");
  const [sponsorUrl, setSponsorUrl] = useState("");
  const [sponsorImageUrl, setSponsorImageUrl] = useState("");
  const [sponsorShare, setSponsorShare] = useState(70); // slider 0–100
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const fileRef = useRef(null);
  // featured pin
  const [featuredId, setFeaturedId] = useState("");
  const [expiryKey, setExpiryKey] = useState("none");
  const [storyTag, setStoryTag] = useState("");

  useEffect(() => {
    if (!open) return;
    const cfg = venue?.display_config || {};
    setZones(buildZoneList(cfg));
    setMode(["fixed", "cycle", "smart"].includes(cfg.mode) ? cfg.mode : "smart");
    setIntervalSecs(Number.isFinite(cfg.interval_secs) ? cfg.interval_secs : 15);
    setMessage(typeof cfg.custom_message === "string" ? cfg.custom_message : "");
    setSponsorLabel(typeof cfg.sponsor_label === "string" ? cfg.sponsor_label : "");
    setSponsorTitle(typeof cfg.sponsor_title === "string" ? cfg.sponsor_title : "");
    setSponsorBody(typeof cfg.sponsor_body === "string" ? cfg.sponsor_body : "");
    setSponsorUrl(typeof cfg.sponsor_url === "string" ? cfg.sponsor_url : "");
    setSponsorImageUrl(typeof cfg.sponsor_image_url === "string" ? cfg.sponsor_image_url : "");
    setSponsorShare(Number.isFinite(Number(cfg.sponsor_ratio)) ? Math.round(Math.max(0, Math.min(1, Number(cfg.sponsor_ratio))) * 100) : 70);
    setFeaturedId(typeof cfg.featured_fixture_id === "string" ? cfg.featured_fixture_id : "");
    setStoryTag(typeof cfg.featured_pin_story_tag === "string" ? cfg.featured_pin_story_tag : "");
    setExpiryKey("none");
    setPin(""); setRemovePin(false); setSaved(false); setError(null); setCopied(false); setUploadError(null);
  }, [open, venue]);

  const base = import.meta.env.VITE_DISPLAY_APP_URL || "";
  const displayUrl = `${base}/display/${venue?.display_token || ""}`;
  const hasPin = !!venue?.display_pin;

  // pinnable = today's fixtures that aren't finished
  const pinnable = (fixtures || []).filter((f) => !["completed", "walkover", "forfeit", "void", "postponed"].includes(f.status));
  const teamName = (id) => teams?.[id]?.name || "TBC";

  const move = (i, dir) => setZones((z) => {
    const j = i + dir;
    if (j < 0 || j >= z.length) return z;
    const next = z.slice();
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const toggle = (i) => setZones((z) => z.map((zz, k) => (k === i ? { ...zz, on: !zz.on } : zz)));

  const copy = async () => {
    try { await navigator.clipboard.writeText(displayUrl); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch {}
  };

  const pickImage = () => fileRef.current?.click();
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setUploadError("Image must be under 5 MB."); return; }
    setUploading(true); setUploadError(null);
    try {
      const url = await uploadVenueMedia(venue?.id, file);
      setSponsorImageUrl(url || "");
    } catch (err) {
      console.error("[venue] sponsor upload failed", err);
      const msg = String(err?.message || "");
      setUploadError(
        /row-level security|not authorized|403|Unauthorized/i.test(msg)
          ? "Uploads need a venue staff login — sign in with your account and try again."
          : "Upload failed — try a different image."
      );
    } finally { setUploading(false); }
  };

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const config = {
        zones: zones.filter((z) => z.on).map((z) => z.key),
        mode,
        interval_secs: Math.max(10, Math.min(60, Number(interval) || 15)),
        custom_message: message.trim(),
        sponsor_image_url: sponsorImageUrl.trim() || null,
        sponsor_label: sponsorLabel.trim() || null,
        sponsor_title: sponsorTitle.trim() || null,
        sponsor_body: sponsorBody.trim() || null,
        sponsor_url: sponsorUrl.trim() || null,
        sponsor_ratio: Math.max(0, Math.min(1, sponsorShare / 100)),
        featured_fixture_id: featuredId || null,
        featured_pin_expires_at: featuredId ? expiryToIso(expiryKey) : null,
        featured_pin_story_tag: featuredId ? (storyTag.trim() || null) : null,
      };
      const pinArg = removePin ? "" : pin.trim() ? pin.trim() : null;
      await venueUpdateDisplayConfig(venueToken, config, pinArg);
      setSaved(true);
      onSaved?.();
    } catch (e) {
      setError(SAVE_ERRORS[e?.message] || "Couldn't save — try again.");
    } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Reception display" wide>
      <div className="bk-set-section">
        <label>Display screen link</label>
        <p className="bk-modal-note">
          Open this on the reception TV (full-screen browser). It's view-only — it can never change anything here.
        </p>
        <div className="bk-win" style={{ gridTemplateColumns: "1fr auto" }}>
          <input type="text" readOnly value={displayUrl} onFocus={(e) => e.target.select()} />
          <button onClick={copy}>{copied ? "Copied ✓" : "Copy link"}</button>
        </div>
        {!base && <p className="muted bk-set-empty">Tip: once the display app is deployed, prepend its web address to this link.</p>}
      </div>

      <div className="bk-set-divider" />

      <div className="bk-set-section">
        <label>Screen PIN</label>
        <p className="bk-modal-note">
          {hasPin ? "A PIN is set. Staff enter it once per screen." : "No PIN — anyone with the link can open the screen."}
          {" "}Leave blank to keep the current PIN.
        </p>
        <div className="bk-win" style={{ gridTemplateColumns: "1fr auto" }}>
          <input
            type="text" inputMode="numeric" placeholder={hasPin ? "Enter a new PIN (4–8 digits)" : "Set a PIN (4–8 digits)"}
            value={pin} disabled={removePin}
            onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, "").slice(0, 8))}
          />
          {hasPin && (
            <label className="bk-switch" style={{ whiteSpace: "nowrap" }}>
              <input type="checkbox" checked={removePin} onChange={(e) => setRemovePin(e.target.checked)} />
              <span className="bk-switch-track"><span className="bk-switch-knob" /></span>
              <span className="bk-switch-label">Remove PIN</span>
            </label>
          )}
        </div>
      </div>

      <div className="bk-set-divider" />

      <h3 className="bk-set-h3">Panels</h3>
      <p className="bk-modal-note">Choose which panels show, and drag them into order with the arrows. The screen shows several at once.</p>
      {zones.map((z, i) => (
        <div className="bk-win" key={z.key} style={{ gridTemplateColumns: "auto 1fr auto auto" }}>
          <label className="bk-switch">
            <input type="checkbox" checked={z.on} onChange={() => toggle(i)} />
            <span className="bk-switch-track"><span className="bk-switch-knob" /></span>
          </label>
          <span className="bk-switch-label" style={{ opacity: z.on ? 1 : 0.5 }}>{ZONE_LABELS[z.key]}</span>
          <button className="btn-link" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">▲</button>
          <button className="btn-link" onClick={() => move(i, 1)} disabled={i === zones.length - 1} aria-label="Move down">▼</button>
        </div>
      ))}

      <div className="bk-set-divider" />

      <div className="bk-set-section">
        <label>Auto-cycling</label>
        <p className="bk-modal-note">
          <b>Smart</b>: big live scores during games, switches to fixtures/results between them.{" "}
          <b>Cycle</b>: rotate panels on a timer. <b>Fixed</b>: never rotate.
        </p>
        <div className="bk-win" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="smart">Smart</option>
            <option value="cycle">Cycle</option>
            <option value="fixed">Fixed</option>
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span className="muted" style={{ whiteSpace: "nowrap" }}>Cycle every</span>
            <input type="number" min={10} max={60} value={interval}
              onChange={(e) => setIntervalSecs(e.target.value)} style={{ width: "5rem" }} />
            <span className="muted">sec</span>
          </label>
        </div>

        <label>Custom message</label>
        <textarea value={message} placeholder="e.g. Welcome to the Sports Centre — bar open till 11pm"
          onChange={(e) => setMessage(e.target.value)} />
      </div>

      <div className="bk-set-divider" />

      <div className="bk-set-section">
        <label>Sponsor panel</label>
        <p className="bk-modal-note">
          The tall panel on the screen rotates between your sponsor and the In or Out promo.
          Upload a portrait image and set the copy below.
        </p>
        <div className="bk-win" style={{ gridTemplateColumns: "auto 1fr" }}>
          <button onClick={pickImage} disabled={uploading}>
            {uploading ? "Uploading…" : sponsorImageUrl ? "Replace image" : "Upload image"}
          </button>
          <span className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", alignSelf: "center" }}>
            {sponsorImageUrl ? sponsorImageUrl.split("/").pop() : "No image yet — the screen shows the In or Out promo only."}
          </span>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            style={{ display: "none" }} onChange={onFile} />
        </div>
        {sponsorImageUrl && (
          <div className="bk-win" style={{ gridTemplateColumns: "auto 1fr auto" }}>
            <img src={sponsorImageUrl} alt="Sponsor" style={{ width: "4.5rem", height: "5.5rem", objectFit: "cover", borderRadius: "0.5rem" }} />
            <span className="muted" style={{ alignSelf: "center" }}>Shown at the top of the sponsor panel.</span>
            <button className="btn-link" onClick={() => setSponsorImageUrl("")}>Remove</button>
          </div>
        )}
        {uploadError && <div className="bk-inbox-error">{uploadError}</div>}
        <div className="bk-win" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <input type="text" placeholder="Tag, e.g. Sponsor · Greenway Tap" value={sponsorLabel}
            onChange={(e) => setSponsorLabel(e.target.value)} />
          <input type="text" placeholder="Link text, e.g. greenwaysp.co.uk/tap" value={sponsorUrl}
            onChange={(e) => setSponsorUrl(e.target.value)} />
        </div>
        <div className="bk-win" style={{ gridTemplateColumns: "1fr" }}>
          <input type="text" placeholder="Headline, e.g. Post-match pint? £4 til 10pm." value={sponsorTitle}
            onChange={(e) => setSponsorTitle(e.target.value)} />
        </div>
        <div className="bk-win" style={{ gridTemplateColumns: "1fr" }}>
          <input type="text" placeholder="Detail line, e.g. Show your matchday wristband." value={sponsorBody}
            onChange={(e) => setSponsorBody(e.target.value)} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: "0.7rem" }}>
          <span className="muted" style={{ whiteSpace: "nowrap" }}>Sponsor share</span>
          <input type="range" min={0} max={100} step={10} value={sponsorShare}
            onChange={(e) => setSponsorShare(Number(e.target.value))} style={{ flex: 1 }} />
          <span className="muted" style={{ whiteSpace: "nowrap", minWidth: "7.5rem", textAlign: "right" }}>
            {sponsorShare}% sponsor · {100 - sponsorShare}% IoO
          </span>
        </label>
      </div>

      <div className="bk-set-divider" />

      <div className="bk-set-section">
        <label>Featured match pin</label>
        <p className="bk-modal-note">
          The screen normally picks the most exciting live match automatically.
          Pin one of tonight's fixtures to force it into the big spot.
        </p>
        <div className="bk-win" style={{ gridTemplateColumns: "1fr auto" }}>
          <select value={featuredId} onChange={(e) => setFeaturedId(e.target.value)}>
            <option value="">No pin — automatic</option>
            {pinnable.map((f) => (
              <option key={f.id} value={f.id}>
                {String(f.kickoff_time || "").slice(0, 5)} · {teamName(f.home_team_id)} v {teamName(f.away_team_id)}
              </option>
            ))}
            {featuredId && !pinnable.some((f) => f.id === featuredId) && (
              <option value={featuredId}>Currently pinned fixture</option>
            )}
          </select>
          {featuredId && <button className="btn-link" onClick={() => setFeaturedId("")}>Unpin</button>}
        </div>
        {featuredId && (
          <div className="bk-win" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <select value={expiryKey} onChange={(e) => setExpiryKey(e.target.value)}>
              {EXPIRY_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <input type="text" placeholder="Story tag, e.g. Local derby" maxLength={24}
              value={storyTag} onChange={(e) => setStoryTag(e.target.value)} />
          </div>
        )}
      </div>

      {error && <div className="bk-inbox-error">{error}</div>}

      <div className="bk-set-save">
        <button className="btn-accent" disabled={saving} onClick={save}>
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save display settings"}
        </button>
      </div>
    </Modal>
  );
}
