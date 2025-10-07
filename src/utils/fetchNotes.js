// utils/fetchNotes.js
const { OpenAI } = require('openai');

const client = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1'
});

/**
 * Fetch concise, general, non-prescriptive safety notes.
 * Return shape:
 * {
 *   careNotes: string[],
 *   sideEffectsCommon: string[],
 *   avoidIf: string[],
 *   precautions: string[],
 *   interactionsKey: string[]
 * }
 */
async function fetchMedicineNotes(medicineName) {
  if (!medicineName) return null;
  try {
    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      max_tokens: 400,
      messages: [
        { role: 'system', content:
`You are a careful medical summarizer. Provide short, general, non-prescriptive info. 
No dosing, no personalized advice. Avoid country-specific regulation claims.`
        },
        { role: 'user', content:
`Give concise safety notes for "${medicineName}" as JSON with these keys:
{
  "careNotes": ["when/how to take (very short bullets)"],
  "sideEffectsCommon": ["<=6 most common"],
  "avoidIf": ["<=6 conditions where generally avoided/contraindicated"],
  "precautions": ["<=6 important cautions incl. procedures like contrast studies"],
  "interactionsKey": ["<=6 notable interaction themes (e.g., alcohol)"]
}
Rules:
- Keep each bullet 3–8 words.
- DO NOT include dosing or medical advice.
- If uncertain, omit the item.
- Focus on widely agreed standard references.`
        }
      ],
      headers: {
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Medicine Safety Notes Lookup'
      }
    });

    // Defensive parse
    const txt = resp?.choices?.[0]?.message?.content || '{}';
    let json = {};
    try { json = JSON.parse(txt); } catch {}
    const arr = v => Array.isArray(v) ? v.filter(Boolean).slice(0, 6) : undefined;

    return {
      careNotes: arr(json.careNotes),
      sideEffectsCommon: arr(json.sideEffectsCommon),
      avoidIf: arr(json.avoidIf),
      precautions: arr(json.precautions),
      interactionsKey: arr(json.interactionsKey)
    };
  } catch (e) {
    console.error('fetchMedicineNotes failed:', e.message);
    return null;
  }
}

module.exports = { fetchMedicineNotes };
