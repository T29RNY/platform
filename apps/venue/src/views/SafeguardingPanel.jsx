import React, { useState, useEffect, useCallback } from "react";
import { venueListSafeguardingIncidents, venueUnflagSafeguarding } from "@platform/core/storage/supabase.js";
import Icon from "./Icon.jsx";
import { EmptyState } from "./atoms.jsx";
import { relativeFrom } from "../lib/format.js";

// Lead-ONLY safeguarding panel (mig 466–469). The server withholds the rows — a
// non-lead's list call throws `not_a_safeguarding_lead` — and this component
// additionally gates rendering on the client isLead signal AND hides on that
// error, so a non-lead never sees the panel. v1 surfaces no free-text disclosure
// beyond the operator-entered incident description. The only Lead write here is
// UNFLAG (return to the operational queue): a still-flagged incident cannot be
// resolved by anyone (server-enforced), so true resolution flows through the
// normal queue after unflagging.
export default function SafeguardingPanel({ venueToken, isLead, onRefresh, refreshTick = 0 }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await venueListSafeguardingIncidents(venueToken);
      setRows(r?.incidents || []);
      setDenied(false);
    } catch (e) {
      if ((e?.message || "").includes("not_a_safeguarding_lead")) { setDenied(true); setRows([]); }
      else { setError("Couldn't load safeguarding items — try again."); setRows([]); }
    }
  }, [venueToken]);

  useEffect(() => { if (isLead) load(); }, [isLead, load, refreshTick]);

  // Server withholds rows from non-leads; belt-and-braces client gate so the
  // panel is invisible (not merely empty) to anyone who isn't a designated lead.
  if (!isLead || denied) return null;

  const onUnflag = async (inc) => {
    if (!window.confirm(
      "Return this to the operational queue? It becomes visible to all venue staff again. " +
      "Only do this once you've actioned it through your safeguarding procedure."
    )) return;
    setBusy(inc.id); setError(null);
    try {
      await venueUnflagSafeguarding(venueToken, inc.id);
      await load();
      onRefresh?.();
    } catch (e) { setError("Couldn't update — try again."); } finally { setBusy(null); }
  };

  const count = rows?.length || 0;

  return (
    <section className="issues" style={{ borderColor: "var(--train)", marginTop: "var(--gap-3)" }}>
      <header className="issues-head">
        <h3 style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--train)" }}>
          <Icon name="shield" size={16} /> Safeguarding
        </h3>
        {count > 0 && <span className="count" style={{ background: "var(--train)" }}>{count}</span>}
      </header>

      {rows === null ? (
        <div className="issues-empty">Loading…</div>
      ) : (
        <>
          {error && <div className="banner banner-warn" style={{ marginBottom: 8 }}>{error}</div>}
          {count === 0 ? (
            <EmptyState title="Nothing flagged" body="Welfare concerns flagged by staff appear here — visible only to you." />
          ) : (
            rows.map((i) => (
              <div className="issues-row" key={`sg-${i.id}`}>
                <span className="sev" style={{ color: "var(--train)" }}><Icon name="shield" size={16} /></span>
                <div>
                  <div className="label">{i.description}</div>
                  <div className="meta">
                    Flagged{i.safeguarding_flagged_at ? ` ${relativeFrom(i.safeguarding_flagged_at)}` : ""}
                    {i.severity ? ` · ${i.severity}` : ""}
                  </div>
                </div>
                <div className="actions">
                  <button className="btn btn-xs" disabled={busy === i.id} onClick={() => onUnflag(i)}>
                    {busy === i.id ? "…" : "Return to queue"}
                  </button>
                </div>
              </div>
            ))
          )}
        </>
      )}
    </section>
  );
}
