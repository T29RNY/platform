// POST /api/gaffer
// { messages: [{role, content}], systemPrompt: string }
// Returns { text: string }

module.exports = async function handler(req, res) {
  try {
    console.log('[gaffer] request received, method:', req.method);
    console.log('[gaffer] ANTHROPIC_API_KEY present:', !!process.env.ANTHROPIC_API_KEY);

    if (req.method !== 'POST') return res.status(405).end();

    const { messages, systemPrompt } = req.body || {};
    if (!messages || !systemPrompt) {
      console.error('[gaffer] missing body fields — messages:', !!messages, 'systemPrompt:', !!systemPrompt);
      return res.status(400).json({ error: 'Missing messages or systemPrompt' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('[gaffer] ANTHROPIC_API_KEY is not set');
      return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });
    }

    console.log('[gaffer] calling Anthropic API, message count:', messages.length);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: systemPrompt,
        messages: messages.slice(-10),
      }),
    });

    console.log('[gaffer] Anthropic response status:', response.status);

    if (!response.ok) {
      const errBody = await response.text();
      console.error('[gaffer] Anthropic API error — status:', response.status, 'body:', errBody);
      return res.status(502).json({ error: errBody });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    console.log('[gaffer] success, response length:', text.length);
    return res.status(200).json({ text });

  } catch (err) {
    console.error('[gaffer] unhandled error:', err.message);
    console.error('[gaffer] stack:', err.stack);
    return res.status(500).json({ error: err.message });
  }
};
