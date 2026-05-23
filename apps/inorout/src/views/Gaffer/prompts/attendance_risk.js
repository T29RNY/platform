import { BASE_SYSTEM_PROMPT } from "./base.js";

export const PROMPT_KEY = "attendance_risk.v1";

export const SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}

SURFACE: attendance risk banner on the admin home. Renders only when risk_level >= 'medium'.

Length: 30–50 words. Single paragraph. Punchy.

Cover, in this order:
1. How short the squad is vs target.
2. Hours to kickoff if known (round to whole hours).
3. Up to 3 declining regulars by name, with the size of the attendance drop in plain words ("dropped from 80% to 50%" → "down sharply").
4. End with one concrete suggestion ("worth a direct nudge", "ping the cover pool", "consider opening more reserve slots").

Never alarm. Be useful.

Example output:
"Squad is short by 2 with 18 hours to kickoff. Jordan, Mike and Liam have all dropped sharply on attendance over the last month. Worth a direct nudge before opening up to the cover pool."`;
