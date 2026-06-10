// Featured-match selection — HANDOVER §8, verbatim priority order.
// Pure function of (payload, serverOffsetMs, latchRef-ish state passed in/out).
// First rule that matches wins. Returns { fixture, storyTag, mode } where
// mode is 'live' | 'upnext' | 'idle'.

import { matchMinute } from "./format.js";

function rankMap(comp) {
  // team_id -> 1-based rank from standings_live (already pts/gd/gf sorted by the RPC)
  const m = new Map();
  (comp?.standings_live || []).forEach((row, i) => m.set(row.team_id, i + 1));
  return m;
}

function goalEvents(f) {
  return (f.recent_events || []).filter((e) => e.type === "goal" || e.type === "own_goal");
}

// goalLatch: { fixtureId, until } — sticky 60s latch so "goal just in"
// doesn't flap between fixtures. Caller owns the object (a ref).
export function selectFeatured(payload, serverOffsetMs, goalLatch, pinned) {
  const live = payload?.live_fixtures || [];
  const comps = payload?.competitions || [];
  const cfg = payload?.venue?.display_config || {};
  const now = Date.now() + (serverOffsetMs || 0);

  // 1. PINNED — operator override, honoured while live and unexpired
  const pinId = pinned?.featured_fixture_id ?? cfg.featured_fixture_id;
  const pinExp = pinned?.featured_pin_expires_at ?? cfg.featured_pin_expires_at;
  const pinTag = pinned?.featured_pin_story_tag ?? cfg.featured_pin_story_tag;
  if (pinId && (!pinExp || new Date(pinExp).getTime() > now)) {
    const f = live.find((x) => x.fixture_id === pinId);
    if (f) return { fixture: f, storyTag: pinTag || "★ Featured", mode: "live" };
  }

  if (live.length) {
    // 2. ★ TOP-OF-TABLE — both teams in top 3 of their comp's live standings
    const tot = live.filter((f) => {
      const comp = comps.find((c) => c.competition_id === f.competition_id);
      if (!comp) return false;
      const ranks = rankMap(comp);
      const h = ranks.get(f.home_team_id), a = ranks.get(f.away_team_id);
      return h && a && h <= 3 && a <= 3;
    });
    if (tot.length) {
      const pick = [...tot].sort((x, y) =>
        new Date(y.actual_kickoff_at || 0) - new Date(x.actual_kickoff_at || 0))[0];
      return { fixture: pick, storyTag: "★ Top-of-table", mode: "live" };
    }

    // 3. ⚡ GOAL JUST IN — goal within last 5 match minutes; 60s sticky latch
    if (goalLatch?.fixtureId && goalLatch.until > now) {
      const latched = live.find((f) => f.fixture_id === goalLatch.fixtureId);
      if (latched) return { fixture: latched, storyTag: "⚡ Goal just in", mode: "live" };
    }
    const withFreshGoal = live
      .map((f) => {
        const minNow = matchMinute(f.actual_kickoff_at, serverOffsetMs) ?? 0;
        const fresh = goalEvents(f).filter((e) => (e.minute ?? 0) >= minNow - 5);
        const latest = fresh.reduce((m, e) => Math.max(m, e.minute ?? 0), -1);
        return { f, latest };
      })
      .filter((x) => x.latest >= 0)
      .sort((a, b) => b.latest - a.latest);
    if (withFreshGoal.length) {
      const pick = withFreshGoal[0].f;
      if (goalLatch) { goalLatch.fixtureId = pick.fixture_id; goalLatch.until = now + 60000; }
      return { fixture: pick, storyTag: "⚡ Goal just in", mode: "live" };
    }

    // 4. ⚖ NAIL-BITER — 1-goal margin, minute ≥ 70
    const biters = live.filter((f) => {
      const min = matchMinute(f.actual_kickoff_at, serverOffsetMs) ?? 0;
      return Math.abs((f.home_score ?? 0) - (f.away_score ?? 0)) === 1 && min >= 70;
    });
    if (biters.length) {
      const pick = [...biters].sort((x, y) =>
        (y.home_score + y.away_score) - (x.home_score + x.away_score))[0];
      return { fixture: pick, storyTag: "⚖ Nail-biter", mode: "live" };
    }

    // 5. 🔥 ACTION — most recent_events in the last 10 match minutes
    const action = live
      .map((f) => {
        const minNow = matchMinute(f.actual_kickoff_at, serverOffsetMs) ?? 0;
        const n = (f.recent_events || []).filter((e) => (e.minute ?? 0) >= minNow - 10).length;
        return { f, n };
      })
      .sort((a, b) => b.n - a.n);
    if (action.length && action[0].n > 2) {
      return { fixture: action[0].f, storyTag: "🔥 Action", mode: "live" };
    }

    // 6. RECENCY — most recent kickoff
    const pick = [...live].sort((x, y) =>
      new Date(y.actual_kickoff_at || 0) - new Date(x.actual_kickoff_at || 0))[0];
    return { fixture: pick, storyTag: null, mode: "live" };
  }

  // 7. NO LIVE — next upcoming within 60 min → "Up Next", else idle message
  const upcoming = payload?.upcoming_fixtures || [];
  if (upcoming.length) {
    const next = upcoming[0]; // RPC sorts by kickoff_time
    if (next?.kickoff_time) {
      const [hh, mm] = String(next.kickoff_time).split(":").map(Number);
      const ko = new Date(now); ko.setHours(hh, mm, 0, 0);
      const mins = Math.round((ko.getTime() - now) / 60000);
      if (mins >= -10 && mins <= 60) return { fixture: next, storyTag: null, mode: "upnext" };
    }
  }
  return { fixture: null, storyTag: null, mode: "idle" };
}
