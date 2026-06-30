// RefMatch.jsx — Referee track, the in-app officiating handoff (full-screen overlay).
//
// Thin referee wrapper over the shared <LiveMatchSheet> (extracted in P1 of the
// referee-owed epic). It renders the shared live-match surface with the referee
// defaults — amber accent, "Fixtures" back label, "Officiating" iframe title — so the
// referee path is unchanged, while the broadcast composer (P2) and ref ratings (P4)
// reuse the same sheet with their own props/footer.
//
// The shared sheet keeps the sanctioned "pull the ref view in, unchanged" mechanism:
// instead of re-porting the meticulously-designed ref app (apps/ref), it IFRAMEs the
// existing token-driven route. The ref_token carries all authority
// (get_fixture_state_by_ref_token is SECURITY DEFINER + anon), so no parent
// session/cookie sharing is needed.
//
// Rendered by MobileShell as a shell-level overlay (mirrors the `tournament` overlay
// pattern) covering the header + tab bar.

import LiveMatchSheet from "../LiveMatchSheet.jsx";

export default function RefMatch({ game, onBack }) {
  return <LiveMatchSheet game={game} onBack={onBack} />;
}
