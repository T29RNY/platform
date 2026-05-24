// First-time-use hints are disabled.
// The wrapper div is preserved (same structure + style as the original)
// so call-site `style` props (layout-critical in TeamsScreen, PlayerView,
// SquadScreen, etc.) and any layout assumptions continue to hold.
// The hook is a no-op. All call sites across AdminView/PlayerView/StatsView/
// HistoryView/PlayerProfile remain untouched so hints can be re-enabled
// centrally if needed.

export function useFirstTimeHint() {
  return [false, () => {}];
}

export default function FirstTimeHint({ style, children }) {
  return <div style={{ position: "relative", ...style }}>{children}</div>;
}
