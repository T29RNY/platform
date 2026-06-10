# Reception Display — Handoff Package

Everything Claude Code needs to ship this screen.

## In this folder

- **`HANDOVER.md`** — The full spec. Read this first. Covers:
  - File structure, dependencies, fonts
  - Canvas scaling (1920×1080 letterboxed)
  - Design tokens (colours, type scale, spacing, radii, shadows)
  - Layout grid + dimensions for every region
  - Component-by-component spec (header, hero, mini tiles, live table,
    golden boot, coming up, tall promo, ticker)
  - RPC contract (`get_display_state`, `check_display_pin`)
  - Realtime broadcast subscription + 60s fallback
  - Featured-match selection algorithm (priority rules + story tags)
  - Integration API (`updateDisplayState`, animation triggers)
  - Animation catalog (every animation, what triggers it)
  - Match-minute computation, per-venue config, production checklist

- **`Reception Display.html`** — Working reference implementation. Open
  it in a browser to see the screen running. Open in an editor to read
  the renderer functions and CSS. The `<script>` block has a big comment
  with the integration surface — that's the contract.

## Build path (recommended order)

1. Stand up `/display/index.html` with the exact DOM + CSS from the
   reference file. Verify the page scales 1920×1080.
2. Wire the Supabase client. Call `get_display_state` once on load.
3. Implement `updateDisplayState(payload)` — start with the easy
   panels: standings table, top scorers, coming up. Render-from-data.
4. Implement the featured match selection algorithm (§8 of HANDOVER.md).
   Render the hero from the chosen fixture.
5. Wire realtime subscription. Each broadcast → re-pull state.
6. Add the diff layer: detect new goals, score changes, rank shuffles.
   Hook the corresponding animation triggers.
7. Add 60s fallback poll.
8. Add the PIN gate (client-side 3-strike lockout).
9. Smart TV pass: wake-lock, error boundaries, offline fallback,
   service worker for last-payload cold-load.

## Reviewing the design

The reference HTML is the source of truth for visuals. If anything in
HANDOVER.md conflicts with the file, the file wins.
