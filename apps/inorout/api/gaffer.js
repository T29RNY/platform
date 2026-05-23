// POST /api/gaffer
//
// Body:
//   { adminToken: string,
//     surface: 'team_summary'|'payment_summary'|'attendance_risk'|'matchday_briefing'|'qa',
//     question?: string,             -- required when surface='qa'
//     forceRefresh?: boolean }
//
// Response:
//   { content, briefingId, cached, surface, model, tokensIn, tokensOut, costPence }
//
// Required env vars:
//   ANTHROPIC_API_KEY            -- direct Anthropic API (current pattern; AI Gateway is a future swap)
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY    -- for ai_briefings INSERT and context RPC calls
//
// Spec: GAFFER.md

const { createClient } = require('@supabase/supabase-js');

// ── Config ────────────────────────────────────────────────────────────────────

const MODEL = 'claude-sonnet-4-5';     // bump to claude-sonnet-4-6 when we re-canary
const MAX_TOKENS = {
  team_summary:      400,
  payment_summary:   300,
  attendance_risk:   200,
  matchday_briefing: 800,
  qa:                500,
};

// TTL minutes. 0 = never cache.
const CACHE_TTL_MIN = {
  team_summary:      30,
  payment_summary:   30,
  attendance_risk:   15,
  matchday_briefing: 180,
  qa:                0,
};

// Sonnet 4.5 price per million tokens (pence). Update when bumping model.
const PRICE_IN_PENCE_PER_M  = 240;    // ~$3/M input  → ~£2.40/M
const PRICE_OUT_PENCE_PER_M = 1200;   // ~$15/M output → ~£12/M

const SURFACE_TO_RPC = {
  team_summary:      'gaffer_get_context_team_summary',
  payment_summary:   'gaffer_get_context_payment_summary',
  attendance_risk:   'gaffer_get_context_attendance_risk',
  matchday_briefing: 'gaffer_get_context_matchday_briefing',
};

const ALLOWED_SURFACES = new Set([
  'team_summary',
  'payment_summary',
  'attendance_risk',
  'matchday_briefing',
  'qa',
]);

// Per-team allowlist for Phase 1 canary. Set env GAFFER_ENABLED_TEAMS as
// comma-separated team_ids ("team_finbars,team_x") to opt in.
const ENABLED_TEAMS = new Set(
  (process.env.GAFFER_ENABLED_TEAMS || '')
    .split(',').map(s => s.trim()).filter(Boolean)
);

// ── Prompts (inlined — Vercel Node serverless can't import ESM .js cleanly
// from src/ without a build step, so we keep them here in CommonJS) ───────────

const BASE_PROMPT = `You are Ask the Gaffer, the football-operations assistant for a casual weekly football team using In or Out. You are speaking to the team's admin (the "manager"). Your data is everything the team has logged in the app: match results, player attendance, payments, bibs, POTM votes.

Rules:
1. Never fabricate a statistic. Every claim must be backed by the <context> block. If the data does not say it, do not say it.
2. If the data is sparse, acknowledge it. Better to say "we only have 3 games to go on" than to extrapolate.
3. Tone: knowledgeable football observer, not corporate. Direct, specific, no hedging. UK English.
4. Format: flowing paragraphs. Never use bullet points unless the surface explicitly requests them.
5. Address the admin by their team name in long-form surfaces, never by their personal name.
6. Use UK football vocabulary: "fixture" not "game", "kickoff" not "start time", "POTM" not "MVP", "bibs" not "vests".
7. Round percentages to whole numbers in narrative; show one decimal only when the difference is < 1%.
8. Currency: amounts in the context are in pence. Convert to pounds when narrating (e.g. 1800 pence → "£18").
9. Never mention internal field names, jsonb structure, or that you are reading "a context block". Speak about the team, not about the data feed.

The <context> block contains pre-computed team data. Use only the fields present. Do not invent fields.`;

const SURFACE_PROMPTS = {
  team_summary: {
    key: 'team_summary.v1',
    prompt: `${BASE_PROMPT}

SURFACE: team summary card on the admin home screen.
Length: 60–80 words. Single paragraph.
Cover, in this order, only if data supports it:
1. This week's confirmed-IN count vs squad size.
2. Who hasn't responded yet (name 2–3 max).
3. Recent form as a W/L/D pattern.
4. One standout — top scorer this month or top reliable this month.
Skip any of 1–4 if context lacks the data.`,
  },
  payment_summary: {
    key: 'payment_summary.v1',
    prompt: `${BASE_PROMPT}

SURFACE: payment summary card on the Payments admin screen.
Length: 50–70 words. Single paragraph.
Cover, in order:
1. Total outstanding (£) across how many players.
2. Oldest debt — name + amount + age in weeks.
3. Last week's collection: collected vs owed.
4. Always-paid players (max 3 named) if 3+ qualify.
Pence-to-pounds conversion is mandatory.`,
  },
  attendance_risk: {
    key: 'attendance_risk.v1',
    prompt: `${BASE_PROMPT}

SURFACE: attendance risk banner on admin home. Only renders when risk_level >= 'medium'.
Length: 30–50 words. Punchy. Single paragraph.
Cover:
1. How short vs target + hours to kickoff (if known).
2. Up to 3 declining regulars by name, with plain-language drop ("down sharply").
3. End with ONE concrete suggestion.
Never alarm. Be useful.`,
  },
  matchday_briefing: {
    key: 'matchday_briefing.v1',
    prompt: `${BASE_PROMPT}

SURFACE: matchday briefing modal.
Length: 150–200 words. 2–3 flowing paragraphs.
Cover, only if data supports it:
1. Confirmed squad size vs target. Reserves available.
2. Predicted teams (Smart Teams) — name 1–2 interesting things. Skip if null.
3. In-form players: scorers, winning streak.
4. Last POTM — name + how long ago.
5. Bib rotation: last holder; suggest someone in confirmed squad who has never had bibs.
If predicted_teams is null AND in_form_players is empty, say so honestly.`,
  },
  qa: {
    key: 'qa.v1',
    prompt: `${BASE_PROMPT}

SURFACE: Q&A panel in admin Gaffer tab. Admin asks free-form questions.
Length: 80–120 words. Single paragraph unless genuinely needs two.
Scope: only answer using the <context> block (which contains team_summary, payment_summary, attendance_risk, matchday_briefing data merged).
- If question is out of scope (tactics, weather, who-to-drop), reframe: "I can only answer from the team's data — try asking about attendance, scoring, payments, or this week's squad."
- If data is sparse, say so.
Never invent. Never bullet point. If you cite a number, it must appear in the context block.`,
  },
};

// ── Handler ───────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

    const { adminToken, surface, question, forceRefresh } = req.body || {};

    if (!adminToken) return res.status(400).json({ error: 'missing_admin_token' });
    if (!ALLOWED_SURFACES.has(surface)) return res.status(400).json({ error: 'unknown_surface' });
    if (surface === 'qa' && !question) return res.status(400).json({ error: 'missing_question' });

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('[gaffer] ANTHROPIC_API_KEY missing');
      return res.status(503).json({ error: 'ai_key_not_configured' });
    }
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error('[gaffer] Supabase env vars missing');
      return res.status(503).json({ error: 'supabase_not_configured' });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    // 1. Resolve team_id from admin_token (also acts as auth check)
    const { data: team, error: teamErr } = await supabase
      .from('teams')
      .select('id, name')
      .eq('admin_token', adminToken)
      .maybeSingle();

    if (teamErr || !team) {
      console.error('[gaffer] admin_token lookup failed:', teamErr?.message);
      return res.status(401).json({ error: 'unauthorized' });
    }

    // 2. Allowlist gate (Phase 1 canary). Empty allowlist = open to all (treated as off by default
    // in the UI via ENABLE_GAFFER flag; this is a server-side belt).
    if (ENABLED_TEAMS.size > 0 && !ENABLED_TEAMS.has(team.id)) {
      return res.status(403).json({ error: 'team_not_enabled' });
    }

    // 3. Cache check (skip if forceRefresh or TTL=0)
    const ttlMin = CACHE_TTL_MIN[surface] ?? 0;
    if (ttlMin > 0 && !forceRefresh) {
      const cutoff = new Date(Date.now() - ttlMin * 60_000).toISOString();
      const { data: cached } = await supabase
        .from('ai_briefings')
        .select('id, content, model, tokens_in, tokens_out, cost_pence, generated_at')
        .eq('team_id', team.id)
        .eq('surface', surface)
        .gte('generated_at', cutoff)
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cached) {
        return res.status(200).json({
          content:    cached.content,
          briefingId: cached.id,
          cached:     true,
          surface,
          model:      cached.model,
          tokensIn:   cached.tokens_in,
          tokensOut:  cached.tokens_out,
          costPence:  Number(cached.cost_pence),
          generatedAt: cached.generated_at,
        });
      }
    }

    // 4. Build context. QA surface gets all four structured contexts merged.
    let context;
    if (surface === 'qa') {
      const ctx = {};
      for (const s of ['team_summary', 'payment_summary', 'attendance_risk', 'matchday_briefing']) {
        const { data, error } = await supabase.rpc(SURFACE_TO_RPC[s], { p_admin_token: adminToken });
        if (error) {
          console.error(`[gaffer] context rpc failed for ${s}:`, error.message);
          return res.status(500).json({ error: 'context_rpc_failed', surface: s });
        }
        ctx[s] = data;
      }
      context = ctx;
    } else {
      const { data, error } = await supabase.rpc(SURFACE_TO_RPC[surface], { p_admin_token: adminToken });
      if (error) {
        console.error(`[gaffer] context rpc failed for ${surface}:`, error.message);
        return res.status(500).json({ error: 'context_rpc_failed' });
      }
      context = data;
    }

    // 5. Build user message
    let userMessage;
    if (surface === 'qa') {
      userMessage = `<context>\n${JSON.stringify(context, null, 2)}\n</context>\n\nAdmin's question:\n${question}`;
    } else {
      userMessage = `<context>\n${JSON.stringify(context, null, 2)}\n</context>\n\nWrite the briefing now.`;
    }

    const { prompt, key } = SURFACE_PROMPTS[surface];

    // 6. Call Anthropic
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS[surface],
        system: prompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!anthropicRes.ok) {
      const errBody = await anthropicRes.text();
      console.error('[gaffer] anthropic error', anthropicRes.status, errBody);
      return res.status(502).json({ error: 'anthropic_error', detail: errBody });
    }

    const aiData = await anthropicRes.json();
    const content = aiData.content?.[0]?.text || '';
    const tokensIn = aiData.usage?.input_tokens ?? 0;
    const tokensOut = aiData.usage?.output_tokens ?? 0;
    const costPence = +(
      (tokensIn  * PRICE_IN_PENCE_PER_M)  / 1_000_000 +
      (tokensOut * PRICE_OUT_PENCE_PER_M) / 1_000_000
    ).toFixed(4);

    // 7. Persist briefing (service role bypasses RLS for insert)
    const { data: inserted, error: insErr } = await supabase
      .from('ai_briefings')
      .insert({
        team_id:          team.id,
        audience:         'admin',
        surface,
        match_id:         context?.match_id ?? null,
        content,
        context_snapshot: context,
        prompt_key:       key,
        model:            MODEL,
        tokens_in:        tokensIn,
        tokens_out:       tokensOut,
        cost_pence:       costPence,
        question:         surface === 'qa' ? question : null,
      })
      .select('id, generated_at')
      .single();

    if (insErr) {
      // Don't fail the request if insert breaks — return content but log
      console.error('[gaffer] ai_briefings insert failed:', insErr.message);
    }

    return res.status(200).json({
      content,
      briefingId:  inserted?.id ?? null,
      cached:      false,
      surface,
      model:       MODEL,
      tokensIn,
      tokensOut,
      costPence,
      generatedAt: inserted?.generated_at ?? new Date().toISOString(),
    });

  } catch (err) {
    console.error('[gaffer] unhandled error:', err?.message, err?.stack);
    return res.status(500).json({ error: 'internal_error', message: err?.message });
  }
};
