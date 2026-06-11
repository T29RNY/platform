import { useState, useEffect } from "react";
import { resolveInviteLink } from "@platform/core/storage/supabase.js";

// /q/<code> — resolves a scanned invite_links code (mig 248) and dispatches
// on its action. Slice 1: full resolution + error states + dispatch skeleton.
// join_team works now by reusing the existing /join flow (its getTeamByJoinCode
// fallback accepts a team_id). venue_landing (slice 3) + match_checkin (slice 6)
// render a neutral resolved placeholder until their screens land. Redeem-
// counting for join_team is wired in slice 2 (fires post-join, not on scan).

const STATUS_COPY = {
  not_found: { title: "Invite not found", body: "This code doesn't match an active invite. Check the link or ask whoever shared it." },
  inactive:  { title: "Invite switched off", body: "This invite has been turned off by the venue or team." },
  expired:   { title: "Invite expired", body: "This invite is past its expiry date." },
  exhausted: { title: "Invite full", body: "This invite has reached its maximum number of uses." },
};

function Shell({ children }) {
  return (
    <div className="q-shell">
      <style>{`
        .q-shell {
          min-height: 100dvh; width: 100%;
          display: flex; align-items: center; justify-content: center;
          padding: max(28px, env(safe-area-inset-top)) 20px max(28px, env(safe-area-inset-bottom));
          background: var(--bg); color: var(--t1);
          font-family: "DM Sans", sans-serif; text-align: center;
        }
        .q-card { max-width: 360px; width: 100%; display: flex; flex-direction: column; gap: 14px; }
        .q-title { font-family: "Bebas Neue", sans-serif; font-size: 34px; letter-spacing: 0.5px; margin: 0; }
        .q-body { color: var(--t2); font-size: 15px; line-height: 1.5; margin: 0; }
        .q-cta {
          margin-top: 8px; padding: 14px 20px; border: none; border-radius: 12px;
          background: var(--t1); color: var(--bg); font-family: "DM Sans", sans-serif;
          font-size: 16px; font-weight: 600; cursor: pointer;
        }
        .q-muted { color: var(--t3); font-size: 13px; }
      `}</style>
      <div className="q-card">{children}</div>
    </div>
  );
}

export default function InviteResolve({ code }) {
  const [state, setState] = useState({ phase: "loading" });

  useEffect(() => {
    let alive = true;
    resolveInviteLink(code)
      .then((data) => { if (alive) setState({ phase: "done", data }); })
      .catch((e) => {
        console.error("[invite] resolve threw", e);
        if (alive) setState({ phase: "done", data: null });
      });
    return () => { alive = false; };
  }, [code]);

  if (state.phase === "loading") {
    return <Shell><p className="q-body">Checking your invite…</p></Shell>;
  }

  const data = state.data;

  // Network failure or null → treat as not found.
  if (!data || data.status !== "ok") {
    const copy = STATUS_COPY[data?.status] || STATUS_COPY.not_found;
    return (
      <Shell>
        <h1 className="q-title">{copy.title}</h1>
        <p className="q-body">{copy.body}</p>
      </Shell>
    );
  }

  const dest = data.destination || {};

  if (data.action === "join_team") {
    // Reuse the existing, battle-tested join flow — no changes to it here.
    return (
      <Shell>
        <h1 className="q-title">{dest.team_name || "Join the team"}</h1>
        <p className="q-body">You've been invited to join this team on In or Out.</p>
        <button className="q-cta" onClick={() => {
          // Reuse the existing /join flow; carry the code so the join counts
          // a use (redeem fires post-join in App.jsx doJoin, not on scan).
          window.location.href = `/join/${data.entity_id}?invite=${encodeURIComponent(data.code)}`;
        }}>
          Continue to join
        </button>
      </Shell>
    );
  }

  if (data.action === "venue_landing") {
    return (
      <Shell>
        <h1 className="q-title">{dest.venue_name || "What's on here"}</h1>
        <p className="q-body">The venue's what's-on page is coming soon.</p>
        <p className="q-muted">venue_landing · slice 3</p>
      </Shell>
    );
  }

  if (data.action === "match_checkin") {
    return (
      <Shell>
        <h1 className="q-title">Match check-in</h1>
        <p className="q-body">Check-in is coming soon.</p>
        <p className="q-muted">match_checkin · slice 6</p>
      </Shell>
    );
  }

  // Unknown action — defensive fallback.
  return (
    <Shell>
      <h1 className="q-title">Invite not recognised</h1>
      <p className="q-body">This invite can't be opened in this version of the app.</p>
    </Shell>
  );
}
