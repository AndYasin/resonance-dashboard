// Vercel Serverless Function — proxies Wikimedia Pageviews API
// api/pageviews.js

const https = require('https');

function pad(n) { return String(n).padStart(2, '0'); }
function fmtHour(d) { return d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) + pad(d.getHours()); }
function fmtDate(d) { return d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()); }

function fetchWikimedia(path) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'wikimedia.org',// Vercel Serverless Function — proxies Wikimedia Pageviews API
// api/pageviews.js — daily granularity (hourly removed by Wikimedia)

const https = require('https');

function pad(n) { return String(n).padStart(2, '0'); }
function fmtDate(d) { return d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()); }

function fetchWikimedia(path) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'wikimedia.org',
      path: path,
      headers: { 'User-Agent': 'ResonanceDash/1.0 (vercel)' }
    }, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: r.statusCode, body: {} }); }
      });
    }).on('error', reject);
  });
}

async function fetchPageviews(title, lang, days) {
  const encoded = encodeURIComponent(title.replace(/ /g, '_'));
  const now = new Date();
  const start = new Date(now - days * 86400000);
  const path = '/api/rest_v1/metrics/pageviews/per-article/' + lang +
    '.wikipedia/all-access/all-agents/' + encoded +
    '/daily/' + fmtDate(start) + '00/' + fmtDate(now) + '00';

  const { status, body } = await fetchWikimedia(path);
  if (status !== 200) return { items: [], title, lang, error: status };

  const items = (body.items || []).map(i => ({ t: i.timestamp, v: i.views }));
  if (items.length < 2) return { items, title, lang, ratio: 0, trend: 0, fetchedAt: Date.now() };

  // ratio: сьогодні vs середнє за попередні дні
  const last = items[items.length - 1].v;
  const avg  = items.slice(0, -1).reduce((s, i) => s + i.v, 0) / (items.length - 1);
  const ratio = avg > 0 ? Math.round(last / avg * 10) / 10 : 0;

  // trend: останні 3 дні vs попередні 3
  let trend = 0;
  if (items.length >= 6) {
    const last3 = items.slice(-3).reduce((s,i) => s+i.v, 0) / 3;
    const prev3 = items.slice(-6,-3).reduce((s,i) => s+i.v, 0) / 3;
    trend = prev3 > 0 ? Math.round((last3 - prev3) / prev3 * 100) : 0;
  }

  return { items, title, lang, ratio, trend, fetchedAt: Date.now() };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const title  = req.query.title  || '';
  const titles = req.query.titles || '';
  const lang   = req.query.lang   || 'en';
  const days   = parseInt(req.query.days || '8');

  if (titles) {
    const arr = titles.split(',').slice(0, 30);
    const results = await Promise.allSettled(arr.map(t => fetchPageviews(t.trim(), lang, days)));
    const batch = {};
    arr.forEach((t, i) => { batch[t] = results[i].status === 'fulfilled' ? results[i].value : null; });
    res.status(200).json({ batch, fetchedAt: Date.now() });
    return;
  }

  if (!title) { res.status(400).json({ error: 'title required' }); return; }

  try {
    const data = await fetchPageviews(title, lang, days);
    res.status(200).json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
      path: path,
      headers: { 'User-Agent': 'ResonanceDash/1.0 (vercel)' }
    }, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        try { resolve({ status: r.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: r.statusCode, body: {} }); }
      });
    }).on('error', reject);
  });
}

async function fetchPageviews(title, lang, mode, days) {
  const encoded = encodeURIComponent(title.replace(/ /g, '_'));
  const now = new Date();
  let path;

  if (mode === 'hourly') {
    const start = new Date(now - 48 * 3600000);
    const end   = new Date(now -  1 * 3600000);
    path = '/api/rest_v1/metrics/pageviews/per-article/' + lang + '.wikipedia/all-access/all-agents/' + encoded + '/hourly/' + fmtHour(start) + '00/' + fmtHour(end) + '00';
  } else {
    const start = new Date(now - days * 86400000);
    path = '/api/rest_v1/metrics/pageviews/per-article/' + lang + '.wikipedia/all-access/all-agents/' + encoded + '/daily/' + fmtDate(start) + '00/' + fmtDate(now) + '00';
  }

  const { status, body } = await fetchWikimedia(path);
  if (status !== 200) return { items: [], title, lang, error: status };

  const items = (body.items || []).map(i => ({ t: i.timestamp, v: i.views }));

  let ratio = 0, trend = 0;
  if (items.length >= 2) {
    const last = items[items.length - 1].v;
    const avg = items.slice(0, -1).reduce((s, i) => s + i.v, 0) / (items.length - 1);
    ratio = avg > 0 ? Math.round(last / avg * 10) / 10 : 0;
    if (items.length >= 6) {
      const last3 = items.slice(-3).reduce((s,i) => s+i.v, 0) / 3;
      const prev3 = items.slice(-6,-3).reduce((s,i) => s+i.v, 0) / 3;
      trend = prev3 > 0 ? Math.round((last3 - prev3) / prev3 * 100) : 0;
    }
  }

  return { items, title, lang, ratio, trend, fetchedAt: Date.now() };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const title  = req.query.title  || '';
  const titles = req.query.titles || '';
  const lang   = req.query.lang   || 'en';
  const mode   = req.query.mode   || 'hourly';
  const days   = parseInt(req.query.days || '7');

  if (titles) {
    const arr = titles.split(',').slice(0, 30);
    const results = await Promise.allSettled(arr.map(t => fetchPageviews(t.trim(), lang, mode, days)));
    const batch = {};
    arr.forEach((t, i) => { batch[t] = results[i].status === 'fulfilled' ? results[i].value : null; });
    res.status(200).json({ batch, fetchedAt: Date.now() });
    return;
  }

  if (!title) { res.status(400).json({ error: 'title required' }); return; }

  try {
    const data = await fetchPageviews(title, lang, mode, days);
    res.status(200).json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
