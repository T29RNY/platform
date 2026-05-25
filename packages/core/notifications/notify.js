// Phase 0E — multi-channel notification dispatch abstraction.
//
// Single entry point for all outbound notifications. Routes to the right
// provider (browser push, WhatsApp, SMS, email) based on the `channel` arg.
//
// Phase 0 ships the abstraction in DRY-RUN mode. No real provider calls.
// Every send is recorded in an in-memory log and (in browser) the browser
// console.
//
// Phase 9 will plug Twilio (SMS + WhatsApp) and email providers in via the
// `_providers` map. Existing call sites won't change.
//
// Hard-coded safety rails (apply BEFORE provider call, in this order):
//   1. Kill switch — `NOTIFICATIONS_ENABLED` env var or process.env flag.
//      Default false. Code merges to main with notifications off.
//   2. Dry-run — `NOTIFICATIONS_DRY_RUN` flag. Logs but does not send.
//   3. Per-recipient rate limit — max N notifications per recipient per
//      24h, enforced via the in-memory `_rateLog`.
//   4. Template whitelist — only known templates are dispatched. Unknown
//      templates raise immediately (catches typos before they reach a
//      provider).
//
// Sport-agnostic by name. Templates can refer to football-specific data
// when rendered, but the dispatch surface itself doesn't bake football in.

// ─── Configuration ─────────────────────────────────────────────────────────

const RATE_LIMIT_MAX_PER_24H = 5;
const RATE_LIMIT_WINDOW_MS   = 24 * 60 * 60 * 1000;

// Known templates. Sport-neutral names. Render functions stay tiny — the
// real templates live with each provider (Phase 9 will load the WhatsApp
// pre-approved template IDs from Meta).
export const TEMPLATES = {
  ref_assignment:       (data) => `Hi ${data.name}, you're assigned to ${data.fixture} on ${data.date} at ${data.venue}, Pitch ${data.pitch}. Open your ref view: ${data.link}`,
  fixture_reminder:     (data) => `Reminder: ${data.team} vs ${data.opponent} tonight at ${data.time}, Pitch ${data.pitch}, ${data.venue}`,
  result_confirmed:     (data) => `${data.team_a} ${data.score_a} - ${data.score_b} ${data.team_b}. Full time confirmed.`,
  squad_availability:   (data) => `Who's in for ${data.fixture}? Confirm here: ${data.link}`,
};

const CHANNELS = ["push", "whatsapp", "sms", "email"];

// ─── Provider registry (Phase 9 wires real providers here) ────────────────

const _providers = {
  push:     null,
  whatsapp: null,
  sms:      null,
  email:    null,
};

export function registerProvider(channel, provider) {
  if (!CHANNELS.includes(channel)) {
    throw new Error(`notify: unknown channel "${channel}"`);
  }
  _providers[channel] = provider;
}

// ─── In-memory state ──────────────────────────────────────────────────────

const _rateLog = new Map(); // key: `${channel}:${recipientKey}` → [timestamps]
const _sendLog = [];        // [{ ts, channel, template, recipient, dryRun, sent }]

export function getSendLog()  { return [..._sendLog]; }
export function clearSendLog(){ _sendLog.length = 0; }

// ─── Helpers ──────────────────────────────────────────────────────────────

function recipientKey(recipient = {}) {
  return recipient.playerId
      || recipient.token
      || recipient.phone
      || recipient.email
      || "anonymous";
}

function envFlag(name) {
  if (typeof process !== "undefined" && process.env && name in process.env) {
    return process.env[name] === "true" || process.env[name] === "1";
  }
  return false;
}

function isEnabled()  { return envFlag("NOTIFICATIONS_ENABLED"); }
function isDryRun()   { return envFlag("NOTIFICATIONS_DRY_RUN") || !isEnabled(); }

function isRateLimited(channel, recipient) {
  const key = `${channel}:${recipientKey(recipient)}`;
  const now = Date.now();
  const window = (_rateLog.get(key) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  _rateLog.set(key, window);
  return window.length >= RATE_LIMIT_MAX_PER_24H;
}

function recordSend(channel, recipient) {
  const key = `${channel}:${recipientKey(recipient)}`;
  const window = _rateLog.get(key) || [];
  window.push(Date.now());
  _rateLog.set(key, window);
}

// ─── Main entry point ─────────────────────────────────────────────────────

export async function sendNotification({ recipient, channel, template, data }) {
  if (!CHANNELS.includes(channel)) {
    throw new Error(`notify: unknown channel "${channel}"`);
  }
  if (!(template in TEMPLATES)) {
    throw new Error(`notify: unknown template "${template}"`);
  }
  if (!recipient) {
    throw new Error("notify: recipient required");
  }

  const body  = TEMPLATES[template](data || {});
  const dry   = isDryRun();
  const entry = {
    ts:        Date.now(),
    channel,
    template,
    recipient: recipientKey(recipient),
    body,
    dryRun:    dry,
    sent:      false,
    skipped:   null,
  };

  if (dry) {
    entry.skipped = "dry_run";
    _sendLog.push(entry);
    // In browser dev, surface via console.warn so the dev tools show it.
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[notify dry-run]", entry);
    }
    return entry;
  }

  if (isRateLimited(channel, recipient)) {
    entry.skipped = "rate_limited";
    _sendLog.push(entry);
    return entry;
  }

  const provider = _providers[channel];
  if (!provider) {
    entry.skipped = "no_provider";
    _sendLog.push(entry);
    return entry;
  }

  try {
    await provider({ recipient, body, template, data });
    recordSend(channel, recipient);
    entry.sent = true;
  } catch (err) {
    entry.skipped = "provider_error";
    entry.error = err.message;
    if (typeof console !== "undefined") console.error("[notify provider error]", err);
  }

  _sendLog.push(entry);
  return entry;
}
