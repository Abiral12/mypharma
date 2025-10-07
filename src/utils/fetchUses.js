// utils/fetchUses.js
const { OpenAI } = require('openai');

// Uses OpenRouter (same as your vision/OCR code). Set OPENROUTER_API_KEY in .env
const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1'
});

// Keep it concise and safe. We only need a short bullet list.
async function fetchUsesFromInternet(medicineName) {
  if (!medicineName) return null;
  try {
    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 150,
      messages: [
        { role: 'system', content: 'You are a concise medical assistant.' },
        {
          role: 'user',
          content:
`Give the main medical uses/indications of "${medicineName}" as a short comma-separated list.
- Base it on standard, well-known clinical uses.
- No dosing, no advice, no brands, no contraindications.`
        }
      ],
      headers: {
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Medicine Uses Lookup'
      }
    });

    const text = resp?.choices?.[0]?.message?.content || '';
    // Normalize to an array (max 6)
    return text
      .split(/[•\-\n;,]/g)
      .map(s => s.replace(/\(.*?\)/g, '').trim())
      .filter(Boolean)
      .slice(0, 6);
  } catch (e) {
    console.error('fetchUsesFromInternet failed:', e.message);
    return null;
  }
}

module.exports = { fetchUsesFromInternet };
