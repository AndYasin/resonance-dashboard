module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const q     = req.query.q    || '';
  const lang  = req.query.lang || 'en';
  const limit = parseInt(req.query.limit || '5');
  const KG_KEY = process.env.GOOGLE_KG_KEY || '';

  if (!q)      return res.status(400).json({ error: 'q required' });
  if (!KG_KEY) return res.status(500).json({ error: 'KG key not configured', env: Object.keys(process.env).length });

  try {
    const url = 'https://kgsearch.googleapis.com/v1/entities:search'
      + '?query='    + encodeURIComponent(q)
      + '&key='      + KG_KEY
      + '&limit='    + limit
      + '&languages='+ lang;

    const r = await fetch(url, { headers: { 'User-Agent': 'ResonanceDash/1.0' } });
    const data = await r.json();

    if (!r.ok) return res.status(200).json({ error: data.error?.message, items: [] });

    const items = (data.itemListElement || []).map(el => {
      const e = el.result || {};
      return {
        id:          e['@id']?.replace('kg:', '') || '',
        name:        e.name || '',
        types:       (e['@type'] || []).filter(t => t !== 'Thing'),
        description: e.description || '',
        detail:      e.detailedDescription?.articleBody?.slice(0, 200) || '',
        url:         e.detailedDescription?.url || '',
        score:       el.resultScore || 0
      };
    });

    res.status(200).json({ items, query: q, fetchedAt: Date.now() });
  } catch(e) {
    res.status(500).json({ error: e.message, items: [] });
  }
};
