import React, { useState, useEffect, useRef, useMemo } from "react";
import QRCode from "react-qr-code";
import { venueEnsureInviteLink } from "@platform/core/storage/supabase.js";
import { SectionHead, EmptyState } from "./atoms.jsx";

// QR codes view — get-or-create the canonical /q/<code> for the venue
// (venue_landing) and each team (join_team) via venue_ensure_invite_link
// (mig 251), render as scannable QR with copy + print. The reception display
// scans the venue code; team codes are for a team admin to share/print.
// Slice 4. (Dedicated printable poster = slice 5; link management = slice 7.)

const BASE = "https://in-or-out.com";

function printQR(svgHolder, label, url) {
  const svg = svgHolder?.querySelector("svg");
  if (!svg) return;
  const w = window.open("", "_blank", "width=460,height=620");
  if (!w) return;
  w.document.write(
    `<!doctype html><html><head><title>${label}</title>` +
    `<style>body{font-family:system-ui,sans-serif;text-align:center;padding:48px 24px}` +
    `h1{font-size:24px;margin:0 0 6px}p.sub{color:#666;font-size:14px;margin:0 0 28px}` +
    `svg{width:320px;height:320px}p.url{color:#888;font-size:12px;word-break:break-all;margin-top:24px}</style>` +
    `</head><body><h1>${label}</h1><p class="sub">Scan to join on In or Out</p>` +
    svg.outerHTML +
    `<p class="url">${url}</p>` +
    `<script>window.onload=function(){window.print()}</script></body></html>`
  );
  w.document.close();
}

function QRCard({ label, venueToken, entityType, entityId, action }) {
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
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(url)}>Copy link</button>
          <button className="btn btn-sm" onClick={() => printQR(holderRef.current, label, url)}>Print</button>
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
        ? <QRCard label={venue.name || "This venue"} venueToken={venueToken} entityType="venue" entityId={venue.id} action="venue_landing" />
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
              <QRCard label={t.name} venueToken={venueToken} entityType="team" entityId={t.id} action="join_team" />
            )}
          </div>
        ))
      )}
    </div>
  );
}
