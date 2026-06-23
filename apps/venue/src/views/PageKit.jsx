import React, { useState } from "react";

// Shared page primitives for the venue console IA (Venue People & Spaces epic, Phase 1).
//
// ViewSubhead — a one-line plain-English explainer under a page title, so a first-time
// operator knows what the view is for.
//
// TabbedPage — renders a set of related sub-views as tabs. The caller passes ONLY the
// sub-views that are visible (flag + discipline already filtered upstream); when exactly
// one qualifies the tab bar collapses and it renders bare. Each tab carries its own
// subhead. Tabs reuse the existing token-based styles (no hardcoded colour).

export function ViewSubhead({ children }) {
  if (!children) return null;
  return <p className="view-sub">{children}</p>;
}

// tabs: [{ id, label, subhead?, render: () => ReactNode }] — pre-filtered to the visible set.
// initial: an id to open first (e.g. from a legacy deep-link alias); falls back to the first tab.
export function TabbedPage({ tabs, initial }) {
  const valid = (tabs || []).filter(Boolean);
  const [active, setActive] = useState(() =>
    (initial && valid.some((t) => t.id === initial)) ? initial : valid[0]?.id
  );

  if (valid.length === 0) {
    return <div className="text-mute" style={{ padding: 24 }}>Nothing to show here yet.</div>;
  }

  const current = valid.find((t) => t.id === active) || valid[0];

  return (
    <div>
      {valid.length > 1 && (
        <div className="view-tabs" role="tablist">
          {valid.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              className="view-tab"
              aria-selected={t.id === current.id}
              aria-pressed={t.id === current.id}
              onClick={() => setActive(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <ViewSubhead>{current.subhead}</ViewSubhead>
      <div className="view-tab-body">{current.render()}</div>
    </div>
  );
}
