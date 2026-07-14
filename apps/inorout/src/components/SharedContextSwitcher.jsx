// SharedContextSwitcher.jsx — ONE presentational context-switcher body shared by
// both mobile shells (casual gold + /hub amber). Shell-unification PR #3.
//
// CONTENT-ONLY (D3): it renders the play/ref clash banner + the sectioned entity
// rows and nothing else. Each SHELL owns the container and the physics:
//   • casual → an App-root fixed overlay (ContextSwitcher.jsx), rows NAVIGATE.
//   • hub    → a section inside the Profile MobileSheet, role rows switch IN-PLACE.
// The component holds ZERO navigation/role knowledge — the caller pre-builds the
// `sections` (see nav.js buildSwitcherSections) and each item carries its own
// onSelect. So a new hat added to nav.js appears in BOTH shells for free.
//
// THEME-BY-DOM-POSITION: references ONLY the --u-* alias contract (PR #2), so it
// renders gold under :root and amber under [data-surface="mobile"] automatically —
// never a JS theme prop. The two text levels line up because gold collapses
// --u-text-2/3/4 → --t2, so one --u-text-3 sub-colour is correct in both worlds.
//
// ICONS: the caller passes renderIcon(name, {size, color}); each shell maps the
// semantic name (house/shield/flag/users/whistle/figure/grid/alert/check/chevron)
// onto its own icon set (casual = Phosphor direct · hub = MIcon registry).
//
// ROW GRAMMAR stays per-shell for now via `variant` — the residual, non-tokenizable
// differences (title font/size/weight, icon inline-vs-box) the --u-* tokens can't
// express. This keeps a casual-only player's switcher PIXEL-IDENTICAL to today. PR
// #5 ("one-app polish") unifies the row grammar on top of this one component.

// Per-shell styling the tokens can't carry. Colours/fonts/radii themselves still
// come from --u-* (theme-by-DOM-position); only geometry/scale differs here.
const VARIANT = {
  casual: {
    rowBg: "var(--u-surface-control)", rowRadius: "var(--u-radius-lg)",
    rowGap: 14, rowPad: "14px 16px", rowGapBelow: 10,
    iconInline: true, iconSize: 24,
    titleFont: "var(--u-font-display)", titleSize: 18, titleWeight: 400,
    titleSpacing: "0.04em", titleLine: 1.1,
    ebSize: 11, ebMargin: "18px 2px 12px",
  },
  hub: {
    rowBg: "var(--u-surface-card)", rowRadius: "var(--u-radius-lg)",
    rowGap: 12, rowPad: "12px 14px", rowGapBelow: 8,
    iconInline: false, iconSize: 18, iconBox: 36, iconBoxRadius: "var(--u-radius-sm)",
    titleFont: "var(--u-font-body)", titleSize: 14.5, titleWeight: 700,
    titleSpacing: "normal", titleLine: 1.15,
    ebSize: 11.5, ebMargin: "20px 2px 10px",
  },
};

function Eyebrow({ v, children }) {
  return (
    <div style={{
      fontFamily: "var(--u-font-body)", fontSize: v.ebSize, fontWeight: 700,
      letterSpacing: "0.12em", textTransform: "uppercase",
      color: "var(--u-text-3)", margin: v.ebMargin,
    }}>
      {children}
    </div>
  );
}

function Row({ v, item, renderIcon }) {
  const active = !!item.active;
  const clickable = typeof item.onSelect === "function";
  const glyph = renderIcon(item.iconName, {
    size: v.iconSize,
    color: active || v.iconInline ? "var(--u-accent)" : "var(--u-text-2)",
  });
  return (
    <button
      onClick={clickable ? item.onSelect : undefined}
      disabled={!clickable}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: v.rowGap,
        padding: v.rowPad, marginBottom: v.rowGapBelow, textAlign: "left",
        cursor: clickable ? "pointer" : "default",
        background: v.rowBg,
        border: "1px solid " + (active ? "var(--u-accent-border)" : "var(--u-hairline)"),
        borderRadius: v.rowRadius, boxShadow: "var(--u-shadow-card)",
        opacity: item.muted ? 0.72 : 1,
        color: "var(--u-text-1)", fontFamily: "var(--u-font-body)",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {v.iconInline ? glyph : (
        <div style={{
          width: v.iconBox, height: v.iconBox, borderRadius: v.iconBoxRadius, flex: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: active ? "var(--u-accent-soft)" : "var(--u-surface-chip)",
        }}>{glyph}</div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: v.titleFont, fontSize: v.titleSize, fontWeight: v.titleWeight,
          letterSpacing: v.titleSpacing, lineHeight: v.titleLine, color: "var(--u-text-1)",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {item.title}
        </div>
        {item.sub && (
          <div style={{ fontFamily: "var(--u-font-body)", fontSize: 12, color: "var(--u-text-3)", marginTop: 2 }}>
            {item.sub}
          </div>
        )}
      </div>
      {item.badges?.length ? (
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {item.badges.map((b, i) => (
            <span key={b + i} style={{
              fontFamily: "var(--u-font-body)", fontSize: 10, fontWeight: 600,
              letterSpacing: "0.06em", textTransform: "uppercase",
              color: "var(--u-accent)", border: "1px solid var(--u-hairline)",
              borderRadius: "var(--u-radius-pill)", padding: "3px 8px",
            }}>{b}</span>
          ))}
        </div>
      ) : clickable ? (
        renderIcon(active ? "check" : "chevron", {
          size: active ? 18 : 16,
          color: active ? "var(--u-accent)" : "var(--u-text-4)",
        })
      ) : null}
    </button>
  );
}

// sections: [{ type, label, items:[{ key, iconName, title, sub, badges, active, muted, onSelect }] }]
// conflicts: get_my_world().conflicts [{ message }]  — the play-vs-referee clash banner.
export default function SharedContextSwitcher({ variant = "hub", sections = [], conflicts = [], renderIcon }) {
  const v = VARIANT[variant] || VARIANT.hub;
  return (
    <>
      {conflicts.length > 0 && (
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          margin: "16px 0 4px", padding: "12px 14px",
          // A schedule clash is a recoverable caution, not a hard error, so it
          // reads on the amber --u-warning family. --u-danger stays reserved for
          // genuine failures (PR #5 clash-as-caution).
          background: "var(--u-warning-soft)", border: "1px solid var(--u-warning-border)",
          borderRadius: v.rowRadius,
        }}>
          {renderIcon("alert", { size: 20, color: "var(--u-warning)" })}
          <div style={{ fontFamily: "var(--u-font-body)", fontSize: 12.5, color: "var(--u-text-1)", lineHeight: 1.4 }}>
            <strong style={{ color: "var(--u-warning)" }}>
              {conflicts.length === 1 ? "Schedule clash" : `${conflicts.length} schedule clashes`}
            </strong>
            {": "}
            {conflicts[0]?.message || "You are down to play and to referee close together."}
          </div>
        </div>
      )}

      {sections.map((sec) => {
        if (!sec.items?.length) return null;
        return (
          <div key={sec.type}>
            <Eyebrow v={v}>{sec.label}</Eyebrow>
            {sec.items.map((item) => (
              <Row key={item.key} v={v} item={item} renderIcon={renderIcon} />
            ))}
          </div>
        );
      })}
    </>
  );
}
