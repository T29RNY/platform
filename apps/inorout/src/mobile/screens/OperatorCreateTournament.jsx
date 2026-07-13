// OperatorCreateTournament.jsx — create a venue- or club-OWNED tournament from inside the app.
//
// Reuses the existing owned-create RPC chain (NO new backend, no migration):
//   operator: venue_create_tournament   → venue_add_competition   → venue_update_tournament_status('open')
//   manager:  club_admin_create_tournament → club_admin_add_competition → club_admin_update_tournament_status('open')
//
// Deliberately NOT the self-serve wizard (onboarding/steps/CreateTournament.jsx): that one calls
// self_serve_create_tournament, which mints a HIDDEN personal-host venue — so it would never appear
// in the operator's venue console. Owning it to role.entityId (venue) / role.clubId keeps the new
// tournament in sync with the desktop venue console + the public page. Casual wizard left untouched
// (casual-regression safety).
//
// context = { kind: "operator", venueToken } | { kind: "manager", venueToken, clubId }

import { useRef, useState } from "react";
import {
  venueCreateTournament, venueAddCompetition, venueUpdateTournamentStatus,
  clubAdminCreateTournament, clubAdminAddCompetition, clubAdminUpdateTournamentStatus,
} from "@platform/core/storage/supabase.js";
import MIcon from "../icons.jsx";

// Mirrors the casual wizard's FORMATS (CreateTournament.jsx), mapped to the competition
// (type, format) the desktop manage UI + seeders already understand. Values match the
// live-proven seed configs: cup/single_elimination, league, cup/group_stage.
const FORMATS = [
  { code: "knockout",    label: "Knockout",                              type: "cup",    format: "single_elimination" },
  { code: "round_robin", label: "Round robin (everyone plays everyone)", type: "league", format: null },
  { code: "groups",      label: "Groups, then knockout",                 type: "cup",    format: "group_stage" },
];

// Same slug rule as the desktop create modal (apps/venue TournamentsView).
function slugify(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

const inputStyle = { width: "100%", background: "var(--s3)", border: "1px solid var(--hair)", borderRadius: "var(--r-md)", padding: "11px 12px", fontSize: 15, color: "var(--ink)", fontFamily: "var(--m-font)", boxSizing: "border-box" };
const labelStyle = { fontSize: 11.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--ink3)", margin: "0 0 7px" };

export default function OperatorCreateTournament({ context, onCancel, onCreated, toast }) {
  const [name, setName]     = useState("");
  const [format, setFormat] = useState("knockout");
  const [date, setDate]     = useState("");
  const [fee, setFee]       = useState("");   // £ per team, optional (informational)
  const [busy, setBusy]     = useState(false);
  const savingRef = useRef(false);

  const isManager = context?.kind === "manager";
  const nameOk = name.trim().length >= 2;

  // venue_create_tournament / club_admin_create_tournament REQUIRE an event date (unlike the
  // self-serve RPC, which defaults to today server-side). Keep the field optional in the UI and
  // fall back to today (local date) so "leave it blank" still works — matching the casual wizard.
  const create = (slug) => {
    const eventDate = date || new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local tz
    const parsed = parseFloat(fee);
    const opts = { entryFeePence: fee.trim() && Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0 };
    return isManager
      ? clubAdminCreateTournament(context.clubId, context.venueToken, name.trim(), slug, eventDate, opts)
      : venueCreateTournament(context.venueToken, name.trim(), slug, eventDate, opts);
  };

  const addCompetition = (tid) => {
    const f = FORMATS.find((x) => x.code === format) || FORMATS[0];
    return isManager
      ? clubAdminAddCompetition(tid, "Main Draw", f.type, f.format)
      : venueAddCompetition(context.venueToken, tid, "Main Draw", f.type, f.format);
  };

  const publish = (slug) =>
    isManager
      ? clubAdminUpdateTournamentStatus(slug, "open")
      : venueUpdateTournamentStatus(context.venueToken, slug, "open");

  const submit = async () => {
    if (savingRef.current || !nameOk) return;
    savingRef.current = true; setBusy(true);
    try {
      let slug = slugify(name) || "cup";
      if (slug.length < 2) slug = `${slug}-cup`;

      // Create — retry once with a suffix if the slug is already taken (global UNIQUE).
      let res;
      try {
        res = await create(slug);
      } catch (e) {
        if (/slug|duplicate|unique|already|exists/i.test(e?.message || "")) {
          slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
          res = await create(slug);
        } else throw e;
      }

      const tid = res?.tournament_id;
      const finalSlug = res?.slug || slug;

      // Best-effort: the tournament already exists after create(). If a follow-up step
      // fails it still lands on the desktop console as a draft to finish there — never
      // strand the operator with a half-made tournament and a hard error.
      try {
        if (tid) await addCompetition(tid);
        await publish(finalSlug);
      } catch (e2) {
        console.error("[cups-create] post-create step failed", e2);
      }

      toast?.({ icon: "check", text: "Tournament created", sub: "Share the link to add teams" });
      onCreated?.(finalSlug, tid);
    } catch (e) {
      console.error("[cups-create] create failed", e);
      const m = e?.message || "";
      const msg = /auth|not_author|permission|denied/i.test(m)
        ? "You don't have permission to create a tournament here."
        : /cap|feature|not_enabled/i.test(m)
          ? "Tournaments aren't enabled for this venue yet."
          : "Couldn't create the tournament — please try again.";
      toast?.({ icon: "alert", text: msg });
      setBusy(false); savingRef.current = false;
    }
  };

  return (
    <div className="m-view-enter">
      <button onClick={onCancel} disabled={busy} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: busy ? "default" : "pointer", color: "var(--ink3)", fontFamily: "var(--m-font)", fontSize: 13, fontWeight: 600, padding: "2px 2px 14px" }}>
        <MIcon name="chevleft" size={16} color="var(--ink3)" /> Cups
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, flex: "none", background: "var(--amber-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <MIcon name="cup" size={21} color="var(--amber)" />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: "var(--ink)" }}>New tournament</div>
          <div style={{ fontSize: 12.5, color: "var(--ink3)", marginTop: 1 }}>It opens for entries straight away — manage it here or on the desktop console.</div>
        </div>
      </div>

      <div className="m-card" style={{ padding: "15px 15px", display: "flex", flexDirection: "column", gap: 15 }}>
        <div>
          <div style={labelStyle}>Tournament name</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sunday 6-a-side Cup" maxLength={120} style={inputStyle} />
        </div>
        <div>
          <div style={labelStyle}>Format</div>
          <select value={format} onChange={(e) => setFormat(e.target.value)} style={inputStyle}>
            {FORMATS.map((f) => <option key={f.code} value={f.code}>{f.label}</option>)}
          </select>
        </div>
        <div>
          <div style={labelStyle}>Date <span style={{ textTransform: "none", fontWeight: 500 }}>· optional</span></div>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <div style={labelStyle}>Entry fee per team <span style={{ textTransform: "none", fontWeight: 500 }}>· optional (£)</span></div>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0.00" style={inputStyle} />
          <div style={{ fontSize: 11.5, color: "var(--ink3)", marginTop: 6 }}>Shown to teams on the entry page. Collect it your own way — registering doesn't take payment.</div>
        </div>
        <button onClick={submit} disabled={!nameOk || busy}
          style={{ border: "none", borderRadius: "var(--r-md)", padding: "13px", fontSize: 15, fontWeight: 700, fontFamily: "var(--m-font)", color: nameOk ? "var(--amber-ink)" : "var(--ink3)", background: nameOk ? "var(--amber)" : "var(--s4)", cursor: (!nameOk || busy) ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
          {busy ? "Creating…" : "Create tournament"}
        </button>
      </div>
    </div>
  );
}
