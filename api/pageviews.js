// Vercel Edge Function — proxies Wikimedia Pageviews API
// Deployed at: /api/pageviews

export default async function handler(req) {
  const url = new URL(req.url);
  const lang   = url.searchParams.get('lang')   || 'en';
  const mode   = url.searchParams.get('mode')   || 'hourly';
  const days   = parseInt(url.searchParams.get('days') || '2');
  const titlesParam = url.searchParams.get('titles'); // batch
  const title  = url.searchParams.get('title');

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // ── Batch mode: ?titles=A,B,C ──
  if (titlesParam) {
    const titles = titlesParam.split(',').slice(0, 30); // max 30
    const results = await Promise.allSettled(
      titles.map(t => fetchPageviews(t.trim(), lang, mode, days))
    );
    const data = {};
    titles.forEach((t, i) => {
      const r = results[i];
      data[t] = r.status === 'fulfilled' ? r.value : null;
    });
    return new Response(JSON.stringify({ batch: data, fetchedAt: Date.now() }), {
      headers: corsHeaders
    });
  }

  // ── Single title ──
  if (!title) {
    return new Response(JSON.stringify({ error: 'title required' }), {
      status: 400, headers: corsHeaders
    });
  }

  try {
    const data = await fetchPageviews(title, lang, mode, days);
    return new Response(JSON.stringify(data), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: corsHeaders
    });
  }
}

async function fetchPageviews(title, lang, mode, days) {
  const encoded = encodeURIComponent(title.replace(/ /g, '_'));
  const now = new Date();

  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtDate(d) {
    return d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate());
  }
  function fmtHour(d) {
    return d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) + pad(d.getHours());
  }

  let path;
  if (mode === 'hourly') {
    // Last 48 hours, end = 1 год тому щоб не запитувати майбутні дані
    const start = new Date(now - 48 * 3600000);
    const end   = new Date(now - 1  * 3600000);
    path = `/api/rest_v1/metrics/pageviews/per-article/${lang}.wikipedia/all-access/all-agents/${encoded}/hourly/${fmtHour(start)}00/${fmtHour(end)}00`;
  } else {
    // Daily, last N days
    const start = new Date(now - days * 86400000);
    path = `/api/rest_v1/metrics/pageviews/per-article/${lang}.wikipedia/all-access/all-agents/${encoded}/daily/${fmtDate(start)}00/${fmtDate(now)}00`;
  }

  const r = await fetch(`https://wikimedia.org${path}`, {
    headers: { 'User-Agent': 'ResonanceDash/1.0 (vercel-edge)' }
  });

  if (!r.ok) {
    return { items: [], title, lang, error: r.status };
  }

  const json = await r.json();
  const items = (json.items || []).map(i => ({
    t: i.timestamp,
    v: i.views
  }));

  // Calculate spike ratio: last period vs average of previous periods
  let ratio = 0;
  let trend = 0;
  if (items.length >= 2) {
    const last = items[items.length - 1].v;
    const prev = items.slice(0, -1);
    const avg = prev.reduce((s, i) => s + i.v, 0) / prev.length;
    ratio = avg > 0 ? +(last / avg).toFixed(2) : 0;
    // Trend: last 3 vs previous 3
    if (items.length >= 6) {
      const last3 = items.slice(-3).reduce((s,i)=>s+i.v,0)/3;
      const prev3 = items.slice(-6,-3).reduce((s,i)=>s+i.v,0)/3;
      trend = prev3 > 0 ? +((last3-prev3)/prev3*100).toFixed(0) : 0;
    }
  }

  return { items, title, lang, ratio, trend, fetchedAt: Date.now() };
}
