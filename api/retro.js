// api/retro.js — Vercel serverless
// GET /api/retro?title=Silicon+Valley+Bank&event=2023-03-10&days=14

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const title = req.query.title || '';
  const eventDate = req.query.event || '';
  const days = Math.min(parseInt(req.query.days || '14'), 30);
  const lang = req.query.lang || 'en';

  if (!title || !eventDate) 
    return res.status(400).json({ error: 'title and event required' });

  const eventDt = new Date(eventDate + 'T00:00:00Z');
  const since = new Date(eventDt - days * 86400000).toISOString();
  const until = new Date(eventDt.getTime() + 3 * 86400000).toISOString();

  try {
    let revisions = [], rvcontinue = null, pages = 0;
    do {
      const params = new URLSearchParams({
        action: 'query', prop: 'revisions',
        titles: title, rvlimit: '500',
        rvprop: 'timestamp|user|size|comment',
        rvdir: 'newer', rvstart: since, rvend: until,
        format: 'json',
        ...(rvcontinue ? { rvcontinue } : {})
      });
      const r = await fetch(
        `https://${lang}.wikipedia.org/w/api.php?${params}`,
        { headers: { 'User-Agent': 'ResonanceRetro/1.0' }, signal: AbortSignal.timeout(12000) }
      );
      const d = await r.json();
      const page = Object.values(d.query?.pages || {})[0];
      if (!page || page.missing) return res.status(200).json({ found: false, title });
      revisions = revisions.concat(page.revisions || []);
      rvcontinue = d.continue?.rvcontinue || null;
      pages++;
    } while (rvcontinue && pages < 6);

    // Аналіз по днях
    const byDay = {}, byHour = {};
    for (const rev of revisions) {
      const dt = new Date(rev.timestamp);
      const day  = dt.toISOString().slice(0, 10);
      const hour = dt.toISOString().slice(0, 13);
      if (!byDay[day])  byDay[day]  = { edits: 0, editors: new Set(), comments: [] };
      if (!byHour[hour]) byHour[hour] = { edits: 0, editors: new Set() };
      byDay[day].edits++;
      byHour[hour].edits++;
      if (rev.user) { byDay[day].editors.add(rev.user); byHour[hour].editors.add(rev.user); }
      if (rev.comment) byDay[day].comments.push(rev.comment.slice(0, 60));
    }

    // Timeline з T-offset
    const timeline = Object.entries(byDay).sort(([a],[b]) => a.localeCompare(b)).map(([day, d]) => {
      const diffDays = Math.round((new Date(day) - eventDt) / 86400000);
      const editors = d.editors.size;
      const signal = editors >= 10 ? 'STRONG' : editors >= 5 ? 'MED' : editors >= 3 ? 'LOW' : 'none';
      return { day, t: diffDays, edits: d.edits, editors, signal, comments: [...new Set(d.comments)].slice(0,3) };
    });

    // Перший сигнал до події
    const firstSignal = timeline.find(d => d.t < 0 && d.signal !== 'none');

    // Топ години
    const topHours = Object.entries(byHour)
      .map(([hour, d]) => ({
        hour,
        t_hours: Math.round((new Date(hour+':00:00Z') - eventDt) / 3600000),
        edits: d.edits, editors: d.editors.size
      }))
      .sort((a,b) => b.editors - a.editors)
      .slice(0, 5);

    res.status(200).json({
      found: true, title, lang, eventDate,
      total: revisions.length,
      firstSignal: firstSignal ? { day: firstSignal.day, t: firstSignal.t, editors: firstSignal.editors, signal: firstSignal.signal } : null,
      timeline, topHours
    });

  } catch(e) {
    res.status(500).json({ error: e.message, title });
  }
};
