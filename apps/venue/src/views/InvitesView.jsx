import React, { useState, useEffect, useRef, useMemo } from "react";
import QRCode from "react-qr-code";
import { venueEnsureInviteLink } from "@platform/core/storage/supabase.js";
import { SectionHead, EmptyState } from "./atoms.jsx";
import { printPoster, printTableTalker } from "../lib/printAssets.js";

// QR codes view — get-or-create the canonical /q/<code> for the venue
// (venue_landing) and each team (join_team) via venue_ensure_invite_link
// (mig 251), render as scannable QR with copy + print (poster / table-talker,
// slice 5). The reception display scans the venue code; team codes are for a
// team admin to share/print. Slices 4-5. (Link management = slice 7.)

const BASE = "https://in-or-out.com";

function QRCard({ label, venueName, venueToken, entityType, entityId, action }) {
  const [code, setCode] = useState(null);
  const [error, setError] = useState(null);
  const holderRef = useRef(null);

  useEffect(() => {
    let alive = true;
    venueEnsureInviteLink(venueToken, entityType, entityId, action)
      .then((r) => { if (alive) setCode(r?.code || null); })
      .catch((e) => { if (alive) setError(e?.message || String(e)); });
    return () => { alive = false; };
  }, [venueToken, entityType, entityId, action]);

  if (error) return <div className="card card-pad text-mute">Couldn't create a code: {error}</div>;
  if (!code) return <div className="card card-pad text-mute">Generating…</div>;

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

export default function InvitesView({ state, venueToken }) {
  const venue = state?.venue || {};
  const teams = useMemo(() => Object.values(state?.teams || {}), [state]);
  const [openTeam, setOpenTeam] = useState(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SectionHead label="Venue QR" />
      <p className="text-mute" style={{ fontSize: 13, marginTop: -8 }}>
        This is the code for the reception display — scanning it opens "what's on at this venue".
      </p>
      {venue.id
        ? <QRCard label={venue.name || "This venue"} venueName={venue.name || "This venue"} venueToken={venueToken} entityType="venue" entityId={venue.id} action="venue_landing" />
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
              <QRCard label={t.name} venueName={venue.name || "This venue"} venueToken={venueToken} entityType="team" entityId={t.id} action="join_team" />
            )}
          </div>
        ))
      )}
    </div>
  );
}
