// Playwright global setup: mint a fresh session for each demo user and write a
// storageState file (e2e/.auth/<user>.json) used by the projects in the config.
// Runs once per `playwright test` invocation; no dev server needed for this step.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintSession, storageStateFor, USERS } from './lib/auth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(__dirname, '.auth');

// Only mint the demo users whose selected --project(s) actually need them. The apps
// force-refresh (and so ROTATE) the single-use refresh token on every boot, so an
// idle-aged minted token trips Supabase reuse-detection — hence authed projects run
// in SEPARATE invocations (see config header + the `e2e:consumer` root script).
// Minting only the needed user per invocation keeps that pattern under the GoTrue
// token rate limit. No --project flag (a full `npm run e2e`) → mint everyone.
function neededUsers() {
  const argv = process.argv;
  const projects = argv
    .map((a, i) => (a === '--project' ? argv[i + 1] : (a.startsWith('--project=') ? a.slice('--project='.length) : null)))
    .filter(Boolean);
  if (projects.length === 0) return Object.keys(USERS);
  const need = new Set();
  for (const p of projects) {
    for (const name of Object.keys(USERS)) if (p.includes(name)) need.add(name);
  }
  return [...need];
}

export default async function globalSetup() {
  await fs.mkdir(AUTH_DIR, { recursive: true });
  for (const name of neededUsers()) {
    const creds = USERS[name];
    const session = await mintSession(creds.email, creds.password);
    const state = storageStateFor(session);
    await fs.writeFile(path.join(AUTH_DIR, `${name}.json`), JSON.stringify(state, null, 2));
    // eslint-disable-next-line no-console
    console.log(`[auth] ${name} (${creds.email}) -> ${session.user.id}`);
  }
}
