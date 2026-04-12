// Vercel Serverless Function — proxies Wikimedia Pageviews API
// Uses global fetch (Node 24 built-in)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const title  = req.query.title  || '';
  const titles = req.query.titles || '';
  const lang   = req.query.lang   || 'en';
  const days   = parseInt(req.query.days || '8');

  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtDate(d) { return d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()); }

  async function fetchPageviews(t, l, d) {
    const encoded = encodeURIComponent(t.replace(/ /g, '_'));
    const now   = new Date();
    const start = new Date(now - d * 86400000);
    const url   = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/' + l +
      '.wikipedia/all-access/all-agents/' + encoded +
      '/daily/' + fmtDate(start) + '00/' + fmtDate(now) + '00';

    const r = await fetch(url, { headers: { 'User-Agent': 'ResonanceDash/1.0' } });
    if (!r.ok) return { items: [], title: t, lang: l, error: r.status };

    const body  = await r.json();
    const items = (body.items || []).map(i => ({ t: i.timestamp, v: i.views }));
    if (items.length < 2) return { items, title: t, lang: l, ratio: 0, trend: 0 };

    const last  = items[items.length - 1].v;
    const avg   = items.slice(0, -1).reduce((s, i) => s + i.v, 0) / (items.length - 1);
    const ratio = avg > 0 ? Math.round(last / avg * 10) / 10 : 0;

    let trend = 0;
    if (items.length >= 6) {
      const last3 = items.slice(-3).reduce((s,i) => s+i.v, 0) / 3;
      const prev3 = items.slice(-6,-3).reduce((s,i) => s+i.v, 0) / 3;
      trend = prev3 > 0 ? Math.round((last3 - prev3) / prev3 * 100) : 0;
    }

    return { items, title: t, lang: l, ratio, trend, fetchedAt: Date.now() };
  }

  try {
    if (titles) {
      const arr = titles.split(',').slice(0, 30);
      const results = await Promise.allSettled(arr.map(t => fetchPageviews(t.trim(), lang, days)));
      const batch = {};
      arr.forEach((t, i) => { batch[t] = results[i].status === 'fulfilled' ? results[i].value : null; });
      res.status(200).json({ batch, fetchedAt: Date.now() });
      return;
    }
    if (!title) { res.status(400).json({ error: 'title required' }); return; }
    const data = await fetchPageviews(title, lang, days);
    res.status(200).json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
