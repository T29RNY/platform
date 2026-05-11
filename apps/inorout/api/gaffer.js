// POST /api/gaffer
// { messages: [{role, content}], systemPrompt: string }
// Returns { text: string }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { messages, systemPrompt } = req.body || {};
  if (!messages || !systemPrompt) {
    return res.status(400).json({ error: 'Missing messages or systemPrompt' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Missing ANTHROPIC_API_KEY' });

  try {
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

    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ error: err });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    return res.status(200).json({ text });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
