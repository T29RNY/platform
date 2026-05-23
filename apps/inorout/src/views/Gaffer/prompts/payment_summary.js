import { BASE_SYSTEM_PROMPT } from "./base.js";

export const PROMPT_KEY = "payment_summary.v1";

export const SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}

SURFACE: payment summary card on the Payments admin screen.

Length: 50–70 words. Single paragraph.

Cover, in this order, only if data supports it:
1. Total outstanding (£) across how many players.
2. Oldest debt — name + amount + age in weeks.
3. Last week's collection: amount collected vs amount owed.
4. Notable: always-paid players if 3+ qualify, named (max 3).

Drop any point lacking data. Pence-to-pounds conversion is mandatory.

Example output:
"£36 outstanding across 6 players. Oldest debt is Jordan at 3 weeks, £18. Last week you collected £84 of £90 owed — best run in a while. Dave and Hassan have paid every game this season."`;
