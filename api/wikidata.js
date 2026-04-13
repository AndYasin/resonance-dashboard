module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const title = req.query.title || '';
  const lang  = req.query.lang  || 'en';
  if (!title) return res.status(400).json({ error: 'title required' });

  try {
    // Крок 1: Wikidata ID з Wikipedia
    const ctrl1 = new AbortController();
    setTimeout(() => ctrl1.abort(), 5000);
    const wpRes = await fetch(
      `https://${lang}.wikipedia.org/w/api.php?action=query&prop=pageprops&titles=${encodeURIComponent(title)}&ppprop=wikibase_item&format=json`,
      { headers: { 'User-Agent': 'ResonanceDash/1.0' }, signal: ctrl1.signal }
    );
    const wpData = await wpRes.json();
    const qid = Object.values(wpData.query?.pages || {})[0]?.pageprops?.wikibase_item;
    if (!qid) return res.status(200).json({ error: 'no wikidata id', title });

    // Крок 2: Wikidata REST API — швидший ніж SPARQL
    const ctrl2 = new AbortController();
    setTimeout(() => ctrl2.abort(), 8000);
    const wdRes = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims|labels|descriptions|sitelinks&languages=en&sitefilter=enwiki&format=json`,
      { headers: { 'User-Agent': 'ResonanceDash/1.0' }, signal: ctrl2.signal }
    );
    const wdData = await wdRes.json();
    const entity = wdData.entities?.[qid] || {};

    // Тип сутності
    const typeMap = {
      'Q5':'person','Q4830453':'company','Q6256':'country',
      'Q43229':'organization','Q7278':'political_party',
      'Q215380':'band','Q483501':'artist','Q891723':'public_company',
      'Q327333':'government_agency','Q3624078':'sovereign_state'
    };
    const instanceIds = (entity.claims?.P31 || [])
      .map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
    const entityType = instanceIds.map(id => typeMap[id]).find(Boolean) || 'unknown';

    // Властивості які нас цікавлять
    const propMap = {
      P108: 'employer',    P102: 'party',       P27:  'country',
      P39:  'position',    P26:  'spouse',       P463: 'member_of',
      P69:  'educated_at', P1344:'participated_in', P749:'parent_org',
      P355: 'subsidiary',  P169: 'ceo',          P488: 'chairperson',
      P131: 'location',    P17:  'org_country',  P3373:'sibling',
      P22:  'father',      P25:  'mother'
    };

    const highValue = new Set(['employer','party','position','spouse','ceo','chairperson','parent_org','subsidiary']);

    // Збираємо QID для batch lookup
    const toResolve = new Set();
    Object.entries(propMap).forEach(([pid, relType]) => {
      (entity.claims?.[pid] || []).forEach(c => {
        const val = c.mainsnak?.datavalue?.value;
        if (val?.id) toResolve.add(val.id);
      });
    });

    // Batch resolve labels — один запит для всіх QIDs
    let labels = {};
    if (toResolve.size > 0) {
      const ids = [...toResolve].slice(0, 50).join('|');
      const ctrl3 = new AbortController();
      setTimeout(() => ctrl3.abort(), 6000);
      try {
        const lRes = await fetch(
          `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids}&props=labels|descriptions&languages=en&format=json`,
          { headers: { 'User-Agent': 'ResonanceDash/1.0' }, signal: ctrl3.signal }
        );
        const lData = await lRes.json();
        Object.entries(lData.entities || {}).forEach(([id, e]) => {
          labels[id] = {
            name: e.labels?.en?.value || id,
            desc: e.descriptions?.en?.value || ''
          };
        });
      } catch(e) { console.log('Labels fetch error:', e.message); }
    }

    // Будуємо relations
    const relations = {};
    Object.entries(propMap).forEach(([pid, relType]) => {
      (entity.claims?.[pid] || []).forEach(c => {
        const val = c.mainsnak?.datavalue?.value;
        if (!val?.id) return;
        const info = labels[val.id];
        if (!info?.name) return;
        if (!relations[relType]) relations[relType] = [];
        if (!relations[relType].find(x => x.id === val.id)) {
          relations[relType].push({
            id: val.id,
            name: info.name,
            desc: info.desc,
            highValue: highValue.has(relType)
          });
        }
      });
    });

    // Tickers (P414 = stock exchange)
    const tickers = (entity.claims?.P414 || [])
      .map(c => c.mainsnak?.datavalue?.value).filter(Boolean);

    res.status(200).json({
      qid, title, lang,
      type: entityType,
      label: entity.labels?.en?.value || title,
      description: entity.descriptions?.en?.value || '',
      tickers,
      relations,
      relCount: Object.values(relations).flat().length,
      fetchedAt: Date.now()
    });

  } catch(e) {
    res.status(500).json({ error: e.message, title });
  }
};
