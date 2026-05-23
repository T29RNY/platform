// Surface → { SYSTEM_PROMPT, PROMPT_KEY } lookup.
// Edge function resolves the prompt by surface name.

import * as team_summary from "./team_summary.js";
import * as payment_summary from "./payment_summary.js";
import * as attendance_risk from "./attendance_risk.js";
import * as matchday_briefing from "./matchday_briefing.js";
import * as qa from "./qa.js";

export const PROMPTS = {
  team_summary,
  payment_summary,
  attendance_risk,
  matchday_briefing,
  qa,
};
