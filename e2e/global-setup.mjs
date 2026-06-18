// Playwright global setup: mint a fresh session for each demo user and write a
// storageState file (e2e/.auth/<user>.json) used by the projects in the config.
// Runs once per `playwright test` invocation; no dev server needed for this step.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintSession, storageStateFor, USERS } from './lib/auth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(__dirname, '.auth');

export default async function globalSetup() {
  await fs.mkdir(AUTH_DIR, { recursive: true });
  for (const [name, creds] of Object.entries(USERS)) {
    const session = await mintSession(creds.email, creds.password);
    const state = storageStateFor(session);
    await fs.writeFile(path.join(AUTH_DIR, `${name}.json`), JSON.stringify(state, null, 2));
    // eslint-disable-next-line no-console
    console.log(`[auth] ${name} (${creds.email}) -> ${session.user.id}`);
  }
}
