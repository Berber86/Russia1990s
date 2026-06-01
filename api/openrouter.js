// /api/openrouter.js

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, model, temperature, max_tokens, response_format, apiKey } = req.body || {};
  const apiKeyToUse = apiKey || process.env.OPENROUTER_API_KEY;

  if (!apiKeyToUse) {
    return res.status(500).json({ error: 'No OpenRouter API key available' });
  }

  try {
    const requestBody = {
      model: model || 'google/gemini-2.5-flash',
      messages,
      temperature: temperature ?? 0.6,
      max_tokens: max_tokens ?? 2500
    };

    if (response_format) {
      requestBody.response_format = response_format;
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKeyToUse}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.APP_URL || 'http://localhost:3000',
        'X-Title': '1990s'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error('[OpenRouter API] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
