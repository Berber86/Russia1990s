// /api/hydra.js
export default async function handler(req, res) {
  // Разрешаем CORS для локальной разработки
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // Извлекаем параметры из тела запроса
  const { messages, model, temperature, max_tokens, response_format, apiKey } = req.body;
  
  // Определяем, какой ключ использовать: приоритет у переданного из клиента
  const apiKeyToUse = apiKey || process.env.HYDRA_API_KEY;
  
  if (!apiKeyToUse) {
    return res.status(500).json({ error: 'No API key available' });
  }
  
  try {
    const requestBody = {
      model: model || 'glm-4.7',
      messages: messages,
      temperature: temperature || 0.6,
      max_tokens: max_tokens || 2500,
    };
    
    if (response_format) {
      requestBody.response_format = response_format;
    }
    
    const response = await fetch('https://api.hydraai.ru/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKeyToUse}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });
    
    const data = await response.json();
    
    // Возвращаем ответ клиенту
    res.status(200).json(data);
  } catch (error) {
    console.error('[Hydra API] Error:', error);
    res.status(500).json({ error: error.message });
  }
}