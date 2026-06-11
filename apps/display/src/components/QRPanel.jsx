import React from "react";
import QRCode from "react-qr-code";

// Reception-display QR panel — the demo money-moment. Encodes the venue's
// canonical venue_landing /q/<code> (fetched once via get_display_landing_code,
// mig 252). Shown only when the venue has provisioned a landing code (its
// existence is the opt-in). Scan → "what's on at this venue" → join. Slice 4b.
export default function QRPanel({ url, venue }) {
  if (!url) return null;
  return (
    <article className="panel qr-panel">
      <header className="panel-head">
        <div className="panel-title">Join in</div>
        <div className="panel-sub">{venue?.name || ""}</div>
      </header>
      <div className="qr-body">
        <div className="qr-card">
          <QRCode value={url} size={200} bgColor="#FFFFFF" fgColor="#04060B" />
        </div>
        <div className="qr-caption">SCAN TO JOIN</div>
      </div>
      <style>{`
        .qr-panel { display: flex; flex-direction: column; }
        .qr-body {
          flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 22px;
        }
        .qr-card { background: #FFFFFF; padding: 18px; border-radius: 18px;
                   box-shadow: var(--shadow-card); }
        .qr-caption {
          font-family: var(--font-mono); font-weight: 700; letter-spacing: 3px;
          font-size: 20px; color: var(--gold);
        }
      `}</style>
    </article>
  );
}
