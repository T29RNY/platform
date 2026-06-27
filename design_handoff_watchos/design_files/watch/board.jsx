// ============================================================
// watch/board.jsx — lays every watch screen onto the design canvas
// ============================================================
const WD = window.WATCH_DIMS;

function Stage({ size, children }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Watch size={size}>{children}</Watch>
    </div>
  );
}

const tileStyle = { background: 'radial-gradient(125% 90% at 50% -5%, #181c26 0%, #0a0c10 70%)' };
function tileW(size) { return WD[size].w + 72; }
function tileH(size) { return WD[size].h + 64; }

// ab() must RETURN a DCArtboard element directly — wrapping it in another
// component would hide it from DCSection's `type === DCArtboard` walk.
function ab(id, label, size, screen) {
  return (
    <DCArtboard key={id} id={id} label={label} width={tileW(size)} height={tileH(size)} style={tileStyle}>
      <Stage size={size}>{screen}</Stage>
    </DCArtboard>
  );
}

function Board() {
  return (
    <DesignCanvas>
      <DCSection id="setup" title="Match setup" subtitle="Before kickoff · Apple Watch Ultra (49 mm)">
        {ab('pre', 'Kickoff gate', 'ultra', <PreMatch />)}
      </DCSection>

      <DCSection id="live" title="Live — the glance screen" subtitle="One wrist-glance for 90 minutes: clock, period, score, three taps">
        {ab('home', 'Live match home', 'ultra', <LiveHome />)}
        {ab('half', 'Half-time · period control', 'ultra', <HalfTime />)}
      </DCSection>

      <DCSection id="log" title="Logging an event" subtitle="Action → team → player — you saw WHAT happened first, so log that first. Crown picks the shirt number">
        {ab('action', '1 · What happened?', 'ultra', <ActionSheet />)}
        {ab('team', '2 · Which team', 'ultra', <TeamSelect />)}
        {ab('player', '3 · Which player (Crown)', 'ultra', <PlayerPick />)}
        {ab('card', 'Card confirmation', 'ultra', <CardConfirm />)}
        {ab('2yellow', '2nd yellow → red', 'ultra', <SecondYellow />)}
        {ab('sub', 'Substitution (Crown)', 'ultra', <Substitution />)}
      </DCSection>

      <DCSection id="tools" title="In-play tools" subtitle="Sin-bin runs as a thin strip on the live home — never a takeover. Tap it to manage. Returns + the running log live here too">
        {ab('sinbin', 'Sin-bin · manage (tap strip)', 'ultra', <SinBin />)}
        {ab('return', 'May-return alert', 'ultra', <MayReturn />)}
        {ab('mlog', 'Match log (Crown scroll)', 'ultra', <MatchLog />)}
      </DCSection>

      <DCSection id="result" title="Result" subtitle="Final whistle locks the report">
        {ab('ft', 'Full time', 'ultra', <FullTime />)}
      </DCSection>

      <DCSection id="series" title="Series 9 · 45 mm" subtitle="Same design system, smaller canvas — no Action button, rounder corners">
        {ab('s-home', 'Live home', 'series', <LiveHome />)}
        {ab('s-action', 'Action sheet', 'series', <ActionSheet />)}
        {ab('s-sinbin', 'Sin-bin countdown', 'series', <SinBin />)}
      </DCSection>
    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Board />);
