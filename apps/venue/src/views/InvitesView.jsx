import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import QRCode from "react-qr-code";
import { venueEnsureInviteLink, venueListInviteLinks, venueSetInviteLinkActive } from "@platform/core/storage/supabase.js";
import { SectionHead, EmptyState } from "./atoms.jsx";
import { printPoster, printTableTalker } from "../lib/printAssets.js";
import InviteLinkForm from "./InviteLinkForm.jsx";

// QR codes — get-or-create the canonical /q/<code> for the venue (venue_landing)
// and each team (join_team) via venue_ensure_invite_link (mig 251), plus full
// link management (mig 254): create / deactivate / re-point + an all-codes list
// with scan counts. Render as scannable QR with copy + print. Slices 4-5 + 7.

const BASE = "https://app.in-or-out.com";

const ACTION_LABEL = { join_team: "Join team", venue_landing: "Venue", match_checkin: "Check-in" };

// Presentational QR + share row for a known code (no RPC call).
function QRBlock({ code, label, venueName }) {
  const holderRef = useRef(null);
  const url = `${BASE}/q/${code}`;
  return (
    <div className="card card-pad" style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <div ref={holderRef} style={{ background: "#fff", padding: 10, borderRadius: 8, flexShrink: 0 }}>
        <QRCode value={url} size={120} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
        <div className="text-mute" style={{ fontSize: 12, wordBreak: "break-all", marginBottom: 10 }}>{url}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(url)}>Copy link</button>
          <button className="btn btn-sm" onClick={() => printPoster(holderRef.current, { venueName, label, url })}>Poster</button>
          <button className="btn btn-sm" onClick={() => printTableTalker(holderRef.current, { venueName, label, url })}>Table-talker</button>
        </div>
      </div>
    </div>
  );
}

// Canonical code card — fetches the get-or-create code for an entity then renders QRBlock.
function QRCard({ label, venueName, venueToken, entityType, entityId, action }) {
  const [code, setCode] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    venueEnsureInviteLink(venueToken, entityType, entityId, action)
      .then((r) => { if (alive) setCode(r?.code || null); })
      .catch((e) => { if (alive) setError(e?.message || String(e)); });
    return () => { alive = false; };
  }, [venueToken, entityType, entityId, action]);

  if (error) return <div className="card card-pad text-mute">Couldn't create a code: {error}</div>;
  if (!code) return <div className="card card-pad text-mute">Generating…</div>;
  return <QRBlock code={code} label={label} venueName={venueName} />;
}

// One row in the all-codes management list.
function ManageRow({ row, venueName, venueToken, onChanged, onRepoint }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inactive = row.active === false;
  const url = `${BASE}/q/${row.code}`;

  async function toggle() {
    setBusy(true);
    try { await venueSetInviteLinkActive(venueToken, row.code, inactive); onChanged?.(); }
    catch (e) { console.error("[invite] toggle failed", e); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className={"card card-pad" + (inactive ? " inactive" : "")}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {row.target_name || row.entity_id}
            <span className="chip-contact">{ACTION_LABEL[row.action] || row.action}</span>
            {inactive && <span className="chip-contact">Off</span>}
          </div>
          <div className="text-mute" style={{ fontSize: 12, marginTop: 2 }}>
            {row.label ? `${row.label} · ` : ""}{row.use_count || 0} scan{(row.use_count || 0) === 1 ? "" : "s"} · {row.code}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-sm" onClick={() => setOpen((o) => !o)}>{open ? "Hide QR" : "Show QR"}</button>
          <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(url)}>Copy</button>
          <button className="btn btn-sm" onClick={() => onRepoint(row)}>Re-point</button>
          <button className="btn btn-sm" onClick={toggle} disabled={busy}>{inactive ? "Activate" : "Deactivate"}</button>
        </div>
      </div>
      {open && <QRBlock code={row.code} label={row.target_name || row.code} venueName={venueName} />}
    </div>
  );
}

export default function InvitesView({ state, venueToken }) {
  const venue = state?.venue || {};
  const venueName = venue.name || "This venue";
  const teams = useMemo(() => Object.values(state?.teams || {}), [state]);
  const [openTeam, setOpenTeam] = useState(null);

  const [links, setLinks] = useState(null);
  const [linksErr, setLinksErr] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState(null); // { mode: 'create'|'repoint', row? }

  useEffect(() => {
    let alive = true;
    venueListInviteLinks(venueToken)
      .then((r) => { if (alive) setLinks(Array.isArray(r?.links) ? r.links : []); })
      .catch((e) => { if (alive) setLinksErr(e?.message || String(e)); });
    return () => { alive = false; };
  }, [venueToken, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const activeCount = (links || []).filter((l) => l.active !== false).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SectionHead label="Venue QR" />
      <p className="text-mute" style={{ fontSize: 13, marginTop: -8 }}>
        This is the code for the reception display — scanning it opens "what's on at this venue".
      </p>
      {venue.id
        ? <QRCard label={venueName} venueName={venueName} venueToken={venueToken} entityType="venue" entityId={venue.id} action="venue_landing" />
        : <EmptyState title="No venue" body="Venue not loaded." />}

      <SectionHead label="Team QR codes" count={teams.length} />
      {teams.length === 0 ? (
        <EmptyState title="No teams yet" body="Teams appear here once they're registered in a competition." />
      ) : (
        teams.map((t) => (
          <div key={t.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="card card-pad" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600 }}>{t.name}</span>
              <button className="btn btn-sm" onClick={() => setOpenTeam(openTeam === t.id ? null : t.id)}>
                {openTeam === t.id ? "Hide QR" : "Show QR"}
              </button>
            </div>
            {openTeam === t.id && (
              <QRCard label={t.name} venueName={venueName} venueToken={venueToken} entityType="team" entityId={t.id} action="join_team" />
            )}
          </div>
        ))
      )}

      <SectionHead label="All codes" count={links == null ? "loading…" : `${activeCount} active`}>
        <button className="btn btn-sm btn-primary" onClick={() => setForm({ mode: "create" })}>New code</button>
      </SectionHead>
      <p className="text-mute" style={{ fontSize: 13, marginTop: -8 }}>
        Every code this venue owns. Make extra labelled codes, switch one off, or
        re-point it somewhere new without reprinting anything.
      </p>
      {linksErr && <EmptyState title="Couldn’t load codes" body={linksErr} />}
      {!linksErr && links != null && links.length === 0 && (
        <EmptyState title="No codes yet" body="Showing a QR above mints its code; or hit “New code” to make a labelled one." />
      )}
      {links && links.map((row) => (
        <ManageRow key={row.code} row={row} venueName={venueName} venueToken={venueToken}
          onChanged={reload} onRepoint={(r) => setForm({ mode: "repoint", row: r })} />
      ))}

      {form && (
        <InviteLinkForm
          venueToken={venueToken}
          state={state}
          mode={form.mode}
          code={form.row?.code}
          current={form.row}
          onClose={() => setForm(null)}
          onDone={reload}
        />
      )}
    </div>
  );
}
