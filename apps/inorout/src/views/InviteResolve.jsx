import { useState, useEffect } from "react";
import { resolveInviteLink, checkinViaInvite } from "@platform/core/storage/supabase.js";
import VenueLanding from "./VenueLanding.jsx";

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

// Read the player's token from localStorage (set whenever they visit /p/<token>).
function getStoredPlayerToken() {
  try {
    const last = localStorage.getItem("ioo_last_visited") || "";
    const match = last.match(/^\/p\/([^/?#]+)/);
    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
}

function formatKickoff(scheduledDate, kickoffTime) {
  if (!scheduledDate || !kickoffTime) return null;
  try {
    const [h, m] = kickoffTime.split(":");
    const date = new Date(scheduledDate + "T00:00:00");
    const day = date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    const hh = parseInt(h, 10);
    const mm = m.padStart(2, "0");
    const ampm = hh >= 12 ? "pm" : "am";
    const h12 = hh % 12 || 12;
    return `${day} · ${h12}:${mm}${ampm}`;
  } catch (e) {
    return null;
  }
}

const CHECKIN_ERRORS = {
  not_member:      "You're not on either team in this fixture. Ask your team admin for your personal link.",
  game_over:       "This match has already been played.",
  invite_inactive: "This check-in code has been switched off.",
  invite_expired:  "This check-in code has expired.",
  invite_exhausted:"This check-in code has reached its maximum uses.",
  admin_locked_in: "Your admin has locked your place. No need to check in.",
  squad_full:      "The squad is full for this fixture.",
  invalid_token:   "We couldn't find your player account. Ask your team admin for your personal link.",
  fixture_not_found: "This fixture no longer exists.",
};

function CheckinView({ code, dest }) {
  const [phase, setPhase]   = useState("confirm"); // confirm | loading | done | error
  const [result, setResult] = useState(null);
  const [errMsg, setErrMsg] = useState(null);

  const playerToken = getStoredPlayerToken();
  const kickoff = formatKickoff(dest.scheduled_date, dest.kickoff_time);

  // Player has no stored token — they're not a recognised member on this device.
  if (!playerToken) {
    return (
      <Shell>
        <h1 className="q-title">Check in</h1>
        <p className="q-body">
          We don't recognise you on this device. You need to be a member of one
          of these teams to check in.
        </p>
        {dest.home_team_name && dest.away_team_name && (
          <p className="q-muted">{dest.home_team_name} vs {dest.away_team_name}</p>
        )}
        <p className="q-muted">Ask your team admin for your personal player link.</p>
      </Shell>
    );
  }

  if (phase === "confirm") {
    return (
      <Shell>
        <h1 className="q-title">Check in</h1>
        {dest.home_team_name && dest.away_team_name && (
          <p className="q-body" style={{ fontWeight: 600 }}>
            {dest.home_team_name} vs {dest.away_team_name}
          </p>
        )}
        {kickoff && <p className="q-muted">{kickoff}</p>}
        <button
          className="q-cta"
          onClick={async () => {
            setPhase("loading");
            try {
              const res = await checkinViaInvite(code, playerToken);
              setResult(res);
              setPhase("done");
            } catch (e) {
              const msg = e?.message || "";
              setErrMsg(CHECKIN_ERRORS[msg] || "Something went wrong. Try again.");
              setPhase("error");
            }
          }}
        >
          Mark me IN
        </button>
      </Shell>
    );
  }

  if (phase === "loading") {
    return <Shell><p className="q-body">Checking you in…</p></Shell>;
  }

  if (phase === "done") {
    return (
      <Shell>
        <h1 className="q-title">
          {result?.already_in ? "Already in" : "You're IN"}
        </h1>
        {result?.player_name && (
          <p className="q-body" style={{ fontWeight: 600 }}>{result.player_name}</p>
        )}
        {result?.team_name && (
          <p className="q-muted">{result.team_name}</p>
        )}
        {result?.already_in && (
          <p className="q-muted">You were already marked in for this fixture.</p>
        )}
      </Shell>
    );
  }

  // error
  return (
    <Shell>
      <h1 className="q-title">Can't check in</h1>
      <p className="q-body">{errMsg}</p>
    </Shell>
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
    return <VenueLanding venueId={data.entity_id} code={data.code} />;
  }

  if (data.action === "match_checkin") {
    return <CheckinView code={data.code} dest={dest} />;
  }

  // Unknown action — defensive fallback.
  return (
    <Shell>
      <h1 className="q-title">Invite not recognised</h1>
      <p className="q-body">This invite can't be opened in this version of the app.</p>
    </Shell>
  );
}
