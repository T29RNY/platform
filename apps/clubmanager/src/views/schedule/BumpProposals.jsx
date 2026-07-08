import React, { useCallback, useEffect, useRef, useState } from "react";
import { venueListBumpProposals, venueResolveBump } from "@platform/core/storage/supabase.js";
import { useToast } from "../../shell/toast.jsx";

// Bump proposals — when a higher-priority club event takes a pitch, the incumbent
// is offered a suggested alternative slot. The admin accepts the move or keeps the
// original. Venue-token (resolve needs the manage_facility cap). Renders nothing
// when there are none, so it stays out of the way on a clash-free schedule.
function fmt(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function BumpProposals({ venueId, onResolved }) {
  const t = useToast();
  const [state, setState] = useState({ loading: true, error: false, proposals: [] });
  const busyRef = useRef(new Set());
  const [busy, setBusy] = useState({});

  const load = useCallback(async () => {
    if (!venueId) { setState({ loading: false, error: false, proposals: [] }); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const res = await venueListBumpProposals(venueId);
      setState({ loading: false, error: false, proposals: res?.proposals || [] });
    } catch (err) {
      console.error("[clubmanager] bump proposals load failed", err);
      setState({ loading: false, error: true, proposals: [] });
    }
  }, [venueId]);

  useEffect(() => { load(); }, [load]);

  const resolve = async (p, action) => {
    if (busyRef.current.has(p.id)) return;
    busyRef.current.add(p.id);
    setBusy((b) => ({ ...b, [p.id]: true }));
    try {
      await venueResolveBump(venueId, p.id, action);
      t.show(action === "accept" ? "Moved to the new slot." : "Kept the original slot.");
      await load();
      onResolved?.();
    } catch (err) {
      console.error("[clubmanager] resolve bump failed", err);
      t.show("Couldn't resolve the clash.", "error");
    } finally {
      busyRef.current.delete(p.id);
      setBusy((b) => ({ ...b, [p.id]: false }));
    }
  };

  const { loading, error, proposals } = state;
  if (loading || error || proposals.length === 0) return null;  // quiet unless there's action to take

  return (
    <div className="tile" style={{ borderColor: "var(--amberb)", marginBottom: 16 }}>
      <h3>Pitch clashes to resolve</h3>
      {proposals.map((p) => (
        <div key={p.id} className="bump-row">
          <div>
            <strong>{p.club_team_name || "A team"}</strong> was bumped from{" "}
            <span className="muted">{fmt(p.original_start)}</span>. Move to{" "}
            <strong>{p.suggested_pitch_name || "another pitch"}</strong>
            {p.suggested_venue_name ? ` at ${p.suggested_venue_name}` : ""}{" "}
            <span className="muted">{fmt(p.suggested_start)}</span>?
          </div>
          <div className="bump-ctl">
            <button className="small" onClick={() => resolve(p, "accept")} disabled={busy[p.id]}>Accept move</button>
            <button className="small" onClick={() => resolve(p, "decline")} disabled={busy[p.id]}>Keep original</button>
          </div>
        </div>
      ))}
    </div>
  );
}
