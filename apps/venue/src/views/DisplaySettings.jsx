import React, { useState, useEffect } from "react";
import Modal from "./Modal.jsx";
import { venueUpdateDisplayConfig } from "@platform/core/storage/supabase.js";

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

export default function DisplaySettings({ open, onClose, venueToken, venue, onSaved }) {
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

  useEffect(() => {
    if (!open) return;
    const cfg = venue?.display_config || {};
    setZones(buildZoneList(cfg));
    setMode(["fixed", "cycle", "smart"].includes(cfg.mode) ? cfg.mode : "smart");
    setIntervalSecs(Number.isFinite(cfg.interval_secs) ? cfg.interval_secs : 15);
    setMessage(typeof cfg.custom_message === "string" ? cfg.custom_message : "");
    setPin(""); setRemovePin(false); setSaved(false); setError(null); setCopied(false);
  }, [open, venue]);

  const base = import.meta.env.VITE_DISPLAY_APP_URL || "";
  const displayUrl = `${base}/display/${venue?.display_token || ""}`;
  const hasPin = !!venue?.display_pin;

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

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const config = {
        zones: zones.filter((z) => z.on).map((z) => z.key),
        mode,
        interval_secs: Math.max(10, Math.min(60, Number(interval) || 15)),
        custom_message: message.trim(),
      };
      const pinArg = removePin ? "" : pin.trim() ? pin.trim() : null;
      await venueUpdateDisplayConfig(venueToken, config, pinArg);
      setSaved(true);
      onSaved?.();
    } catch (e) {
      const m = e?.message || "";
      setError(
        m === "pin_invalid" ? "PIN must be 4–8 digits." :
        m === "interval_out_of_range" ? "Cycle time must be 10–60 seconds." :
        "Couldn't save — try again."
      );
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

      {error && <div className="bk-inbox-error">{error}</div>}

      <div className="bk-set-save">
        <button className="btn-accent" disabled={saving} onClick={save}>
          {saving ? "Saving…" : saved ? "Saved ✓" : "Save display settings"}
        </button>
      </div>
    </Modal>
  );
}
