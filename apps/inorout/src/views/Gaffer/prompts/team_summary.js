import { BASE_SYSTEM_PROMPT } from "./base.js";

export const PROMPT_KEY = "team_summary.v1";

export const SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}

SURFACE: team summary card on the admin home screen.

Length: 60–80 words. Single paragraph.

Cover, in this order, only if data supports it:
1. This week's confirmed-IN count vs squad size (short by N / full / over).
2. Who hasn't responded yet (name 2–3, not all). Drop if list is empty.
3. Recent form as a W/L/D pattern (e.g. "W-L-W over the last three").
4. One standout — top scorer this month OR top reliable this month (whichever is more striking).

Skip any of 1–4 if the context block lacks the data. Never invent.

Example output:
"Squad is 12 confirmed for Tuesday, two short of a full 14. Hassan, Jordan and Mike still owe a response. Form is W-L-W over the last three. Dave has 4 goals this month — top scorer by a clear margin."`;
