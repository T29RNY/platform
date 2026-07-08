import React, { useCallback, useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { clubEnsureTeamInviteLink } from "@platform/core/storage/supabase.js";
import Modal from "../../shell/Modal.jsx";
import { useToast } from "../../shell/toast.jsx";

// Team join invite — get-or-create the canonical join code and show its QR +
// shareable link. Venue-token. Parents scan to join their child to the team.
export default function TeamInviteModal({ venueId, team, onClose }) {
  const t = useToast();
  const [state, setState] = useState({ loading: true, error: false, url: "" });

  const load = useCallback(async () => {
    setState({ loading: true, error: false, url: "" });
    try {
      const r = await clubEnsureTeamInviteLink(venueId, team.team_id);
      if (!r?.code) throw new Error("no code");
      setState({ loading: false, error: false, url: `https://app.in-or-out.com/q/${r.code}` });
    } catch (err) {
      console.error("[clubmanager] invite link failed", err);
      setState({ loading: false, error: true, url: "" });
    }
  }, [venueId, team.team_id]);

  useEffect(() => { load(); }, [load]);

  const { loading, error, url } = state;

  return (
    <Modal title={`Invite to ${team.name}`} onClose={onClose}
      footer={<button className="small" onClick={onClose}>Done</button>}>
      {loading && <div className="state">Getting the link…</div>}
      {error && (
        <div>
          <div className="state err">Couldn't get the invite link.</div>
          <button className="retry" onClick={load}>Try again</button>
        </div>
      )}
      {!loading && !error && (
        <div className="invite">
          <div className="invite-qr">
            {/* react-qr-code defaults to black-on-white; the white plate comes
                from .invite-qr (var(--white)) so scanning works on the dark shell */}
            <QRCode value={url} size={168} />
          </div>
          <p className="muted" style={{ marginTop: 12 }}>Parents scan to join their child to this team.</p>
          <div className="invite-link">
            <input readOnly value={url} onFocus={(e) => e.target.select()} />
            <button className="small" onClick={() => { navigator.clipboard?.writeText(url); t.show("Link copied."); }}>Copy</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
