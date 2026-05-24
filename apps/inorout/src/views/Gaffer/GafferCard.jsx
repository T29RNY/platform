import { useEffect, useState, useRef } from "react";
import { getGafferBriefing } from "@platform/core/storage/supabase.js";

const TITLES = {
  team_summary:      "Team summary",
  payment_summary:   "Payment summary",
  attendance_risk:   "Attendance risk",
  matchday_briefing: "Matchday briefing",
};

export default function GafferCard({
  adminToken,
  surface,
  forceRefresh = false,
  showMeta = false,
  onError,
}) {
  const [state, setState] = useState({ status: "loading", content: "", meta: null, error: null });
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!adminToken || !surface) return;
    if (fetchedRef.current && !forceRefresh) return;
    fetchedRef.current = true;

    let cancelled = false;
    setState(s => ({ ...s, status: "loading", error: null }));

    getGafferBriefing(adminToken, surface, { forceRefresh })
      .then(res => {
        if (cancelled) return;
        if (res?.error) {
          setState({ status: "error", content: "", meta: null, error: res.error });
          if (onError) onError(res.error);
          return;
        }
        setState({ status: "ready", content: res.content, meta: res, error: null });
      })
      .catch(err => {
        if (cancelled) return;
        const msg = err?.message || "request_failed";
        setState({ status: "error", content: "", meta: null, error: msg });
        if (onError) onError(msg);
        console.error("[GafferCard] fetch failed:", msg);
      });

    return () => { cancelled = true; };
  }, [adminToken, surface, forceRefresh]);

  if (state.status === "loading") {
    return (
      <div
        data-gaffer-surface={surface}
        style={cardStyle}
      >
        <div style={titleStyle}>{TITLES[surface] || "Briefing"}</div>
        <div style={loadingStyle}>Reading the data…</div>
      </div>
    );
  }

  if (state.status === "error") {
    if (state.error === "ai_key_not_configured" || state.error === "team_not_enabled") {
      return null;
    }
    return (
      <div data-gaffer-surface={surface} style={cardStyle}>
        <div style={titleStyle}>{TITLES[surface] || "Briefing"}</div>
        <div style={errorStyle}>Couldn't read your data right now. Try again later.</div>
      </div>
    );
  }

  return (
    <div data-gaffer-surface={surface} style={cardStyle}>
      <div style={titleStyle}>{TITLES[surface] || "Briefing"}</div>
      <div style={bodyStyle}>{state.content}</div>
      {showMeta && state.meta && (
        <div style={metaStyle}>
          {state.meta.cached ? "Cached" : "Fresh"} · {state.meta.tokensIn}+{state.meta.tokensOut} tokens · £{(state.meta.costPence/100).toFixed(4)}
        </div>
      )}
    </div>
  );
}

const cardStyle = {
  background: "var(--bg2)",
  border: "1px solid var(--line)",
  borderRadius: 12,
  padding: 16,
  marginBottom: 12,
  fontFamily: "var(--font-body)",
};

const titleStyle = {
  fontFamily: "var(--font-display)",
  fontSize: 14,
  letterSpacing: 1,
  color: "var(--t2)",
  textTransform: "uppercase",
  marginBottom: 8,
};

const bodyStyle = {
  fontSize: 15,
  lineHeight: 1.5,
  color: "var(--t1)",
  whiteSpace: "pre-wrap",
};

const loadingStyle = {
  fontSize: 14,
  color: "var(--t3)",
  fontStyle: "italic",
};

const errorStyle = {
  fontSize: 14,
  color: "var(--t3)",
};

const metaStyle = {
  marginTop: 10,
  fontSize: 11,
  color: "var(--t3)",
};
