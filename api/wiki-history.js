// Vercel Serverless Function — Wikipedia Edit History Analysis
// api/wiki-history.js
// GET /api/wiki-history?title=RaveDAO&days=30&lang=en

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const title = req.query.title || '';
  const days  = Math.min(parseInt(req.query.days || '30'), 90);
  const lang  = req.query.lang || 'en';
  if (!title) return res.status(400).json({ error: 'title required' });

  const since = new Date(Date.now() - days * 86400000).toISOString();

  try {
    // Завантажуємо всі правки за період
    let revisions = [];
    let rvcontinue = null;
    let pages = 0;

    do {
      const params = new URLSearchParams({
        action: 'query',
        prop: 'revisions',
        titles: title,
        rvlimit: '500',
        rvprop: 'timestamp|user|size|comment|ids',
        rvdir: 'newer',
        rvstart: since,
        format: 'json',
        ...(rvcontinue ? { rvcontinue } : {})
      });

      const r = await fetch(
        `https://${lang}.wikipedia.org/w/api.php?${params}`,
        { headers: { 'User-Agent': 'ResonanceBot/1.0' }, signal: AbortSignal.timeout(10000) }
      );
      const d = await r.json();
      const page = Object.values(d.query?.pages || {})[0];

      if (!page || page.missing) {
        return res.status(200).json({
          title, lang, found: false,
          message: 'Article not found on ' + lang + '.wikipedia.org'
        });
      }

      revisions = revisions.concat(page.revisions || []);
      rvcontinue = d.continue?.rvcontinue || null;
      pages++;
    } while (rvcontinue && pages < 5); // max 2500 правок

    if (!revisions.length) {
      return res.status(200).json({
        title, lang, found: true,
        revisions: [], timeline: [], summary: { total: 0 }
      });
    }

    // Аналізуємо хронологію
    const byHour = {};
    const byDay  = {};
    const editors = new Set();
    let totalDelta = 0;
    let maxHourEdits = 0;
    let maxHourTime = null;
    let firstEdit = revisions[0].timestamp;
    let lastEdit  = revisions[revisions.length - 1].timestamp;

    revisions.forEach((rev, i) => {
      const dt   = new Date(rev.timestamp);
      const hour = dt.toISOString().slice(0, 13); // "2026-04-11T14"
      const day  = dt.toISOString().slice(0, 10); // "2026-04-11"

      if (!byHour[hour]) byHour[hour] = { edits: 0, editors: new Set(), delta: 0 };
      if (!byDay[day])   byDay[day]   = { edits: 0, editors: new Set(), delta: 0, comments: [] };

      byHour[hour].edits++;
      byDay[day].edits++;

      if (rev.user) {
        byHour[hour].editors.add(rev.user);
        byDay[day].editors.add(rev.user);
        editors.add(rev.user);
      }

      // Delta bytes
      if (i > 0) {
        const delta = (rev.size || 0) - (revisions[i-1].size || 0);
        byHour[hour].delta += delta;
        byDay[day].delta   += delta;
        totalDelta         += delta;
      }

      // Коментарі
      if (rev.comment) byDay[day].comments.push(rev.comment.slice(0, 80));

      // Пік активності
      if (byHour[hour].edits > maxHourEdits) {
        maxHourEdits = byHour[hour].edits;
        maxHourTime  = hour;
      }
    });

    // Будуємо timeline по днях
    const timeline = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, data]) => ({
        day,
        edits:   data.edits,
        editors: data.editors.size,
        delta:   data.delta,
        comments: [...new Set(data.comments)].slice(0, 5),
        // Spike score — нелінійний
        spike: data.editors.size >= 5 ? 'HIGH' :
               data.editors.size >= 3 ? 'MED'  :
               data.edits >= 5        ? 'LOW'  : 'none'
      }));

    // Знаходимо burst windows — години з піковою активністю
    const bursts = Object.entries(byHour)
      .filter(([, d]) => d.edits >= 3 || d.editors.size >= 2)
      .sort(([, a], [, b]) => b.editors.size - a.editors.size)
      .slice(0, 10)
      .map(([hour, data]) => ({
        hour,
        edits:   data.edits,
        editors: data.editors.size,
        delta:   data.delta
      }));

    // Ключові слова з коментарів
    const allComments = revisions
      .map(r => (r.comment || '').toLowerCase())
      .join(' ');
    const keywords = [];
    if (/died|death|killed/.test(allComments))     keywords.push('DEATH');
    if (/crash|disaster|attack/.test(allComments)) keywords.push('DISASTER');
    if (/arrested|scandal/.test(allComments))      keywords.push('SCANDAL');
    if (/pump|price|token|crypto/.test(allComments)) keywords.push('CRYPTO');
    if (/elected|won|appointed/.test(allComments)) keywords.push('APPOINTED');
    if (/created|new article/.test(allComments))   keywords.push('NEW_ARTICLE');

    res.status(200).json({
      title, lang, found: true,
      summary: {
        total:      revisions.length,
        editors:    editors.size,
        days:       Object.keys(byDay).length,
        totalDelta,
        firstEdit,
        lastEdit,
        maxHourEdits,
        maxHourTime,
        keywords
      },
      timeline,
      bursts,
      fetchedAt: Date.now()
    });

  } catch(e) {
    res.status(500).json({ error: e.message, title });
  }
};
