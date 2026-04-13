// Vercel Serverless Function — PAI (Pimino Amplification Index)
// api/pai.js
// POST /api/pai  body: { title, type, lang_count, editors, description }

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body = {};
  try {
    if (typeof req.body === 'string') body = JSON.parse(req.body);
    else body = req.body || {};
  } catch(e) { return res.status(400).json({ error: 'invalid json' }); }

  const { title, type, lang_count, editors, description } = body;
  if (!title) return res.status(400).json({ error: 'title required' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'API key not configured' });

  const prompt = `You are analyzing an event's viral/resonance potential for a signal detection platform.

Event: "${title}"
Type: ${type || 'unknown'}
Wikipedia language versions: ${lang_count || 0}
Simultaneous editors: ${editors || 0}
${description ? 'Description: ' + description.slice(0, 300) : ''}

Rate these 4 amplification factors from 0.0 to 1.0:

1. identification (0-1): Can the general public identify with or relate to the subject?
   - 1.0 = universal human (anyone could be the victim)
   - 0.5 = specific community  
   - 0.0 = abstract/institutional, hard to personalize

2. concrete_villain (0-1): Is there a specific, named responsible party?
   - 1.0 = named person with face (like a police officer, CEO)
   - 0.5 = named organization
   - 0.0 = "the system", "policy", anonymous bureaucracy

3. amplifier (0-1): Is there an existing movement, media outlet, or community ready to amplify?
   - 1.0 = large active movement already exists (BLM, MeToo)
   - 0.5 = some communities interested
   - 0.0 = no existing infrastructure

4. evidence (0-1): Is there clear, shareable documentation?
   - 1.0 = viral video, clear photo evidence
   - 0.5 = written reports, documents
   - 0.0 = no evidence, only claims

Also provide:
- amplification_type: "person" | "movement" | "symbol" | "system" | "corporate" | "geopolitical" | "none"
- resonance_prediction: "viral" | "regional" | "local" | "contained"
- time_horizon: "hours" | "days" | "weeks" | "months"
- domino_sectors: array of up to 3 sectors that will likely be affected (e.g. ["finance", "politics", "culture"])
- brief_reason: one sentence explaining the prediction

Respond ONLY with valid JSON:
{"identification":0.0,"concrete_villain":0.0,"amplifier":0.0,"evidence":0.0,"amplification_type":"none","resonance_prediction":"contained","time_horizon":"days","domino_sectors":[],"brief_reason":"..."}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': ANTHROPIC_KEY
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        messages: [{ role: 'user', content: prompt }]
      }),
      signal: AbortSignal.timeout(20000)
    });

    const data = await r.json();
    let text = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('').trim();
    // Strip markdown code fences if present
    text = text.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
    const details = JSON.parse(text);
    const pai = Math.round(
      details.identification * details.concrete_villain * details.amplifier * details.evidence * 100
    ) / 100;

    res.status(200).json({ pai, details, title, fetchedAt: Date.now() });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
