---
description: Pause an epic between PRs — give the paste-ready next-session prompt and confirm when it's safe to close.
---

We pick up the next PR in a new session. Do the following, concisely:

1. **State exactly where we are** in one or two lines: what just merged (PR # + what it was), what's applied to the live DB, and which PR/phase is next.

2. **Confirm it's safe to close this session.** Verify there is no unfinished irreversible work in flight — i.e. every applied migration's source is merged to `origin/main` (no Hard Rule 11 drift), no PR is mid-merge, no ephemeral-verify left un-rolled-back (`_e2e_` leak-check = 0), and no background agent still running. Say plainly either **"✅ safe to close now"** or **"⚠️ don't close yet — <reason>"**. If anything is still open, finish or hand it off before giving the all-clear.

3. **Give the paste-ready next-session kickoff prompt** in a fenced code block — a single line the operator can paste into a fresh session to resume exactly where we left off (usually the `/loop /dev-loop <MANIFEST>.md` trigger, or a more specific instruction if the next step is narrower). Note next free migration number if the next PR adds one.

4. **Nothing else.** No new code, no starting the next PR — this command only pauses cleanly and hands off.
