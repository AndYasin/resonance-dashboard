// Vercel Edge Function — Wikidata graph proxy
// api/wikidata.js
// Usage: /api/wikidata?title=Péter_Magyar&lang=en

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const title = req.query.title || '';
  const lang  = req.query.lang  || 'en';
  if (!title) { res.status(400).json({ error: 'title required' }); return; }

  try {
    // Крок 1: отримуємо Wikidata ID з Wikipedia
    const wpUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=pageprops&titles=${encodeURIComponent(title)}&ppprop=wikibase_item&format=json`;
    const wpRes = await fetch(wpUrl, { headers: { 'User-Agent': 'ResonanceDash/1.0' } });
    const wpData = await wpRes.json();
    const pages = Object.values(wpData.query?.pages || {});
    const qid = pages[0]?.pageprops?.wikibase_item;
    if (!qid) { res.status(200).json({ error: 'no wikidata id', title }); return; }

    // Крок 2: SPARQL запит — отримуємо зв'язки
    const sparql = `
      SELECT ?rel ?relLabel ?target ?targetLabel ?targetDesc WHERE {
        {
          BIND(wd:${qid} AS ?subject)
          VALUES ?rel { wdt:P108 wdt:P102 wdt:P27 wdt:P1344 wdt:P69 wdt:P463 }
          ?subject ?rel ?target .
        } UNION {
          BIND(wd:${qid} AS ?target)  
          VALUES ?rel { wdt:P1366 wdt:P3373 wdt:P22 wdt:P25 }
          ?subject ?rel ?target .
        }
        SERVICE wikibase:label { 
          bd:serviceParam wikibase:language "en" .
          ?rel rdfs:label ?relLabel .
          ?target rdfs:label ?targetLabel .
          ?target schema:description ?targetDesc .
        }
      } LIMIT 50
    `;

    const sparqlUrl = 'https://query.wikidata.org/sparql?query=' + encodeURIComponent(sparql);
    const sparqlRes = await fetch(sparqlUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'ResonanceDash/1.0'
      }
    });
    const sparqlData = await sparqlRes.json();
    const bindings = sparqlData.results?.bindings || [];

    // Крок 3: також отримуємо основні дані про сутність
    const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims|labels|descriptions&languages=en&format=json`;
    const entityRes = await fetch(entityUrl, { headers: { 'User-Agent': 'ResonanceDash/1.0' } });
    const entityData = await entityRes.json();
    const entity = entityData.entities?.[qid] || {};

    // Визначаємо тип сутності (P31 = instance of)
    const instanceClaims = entity.claims?.P31 || [];
    const instanceIds = instanceClaims.map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean);

    // Маппінг типів
    const typeMap = {
      'Q5': 'person', 'Q4830453': 'company', 'Q6256': 'country',
      'Q43229': 'organization', 'Q7278': 'political_party',
      'Q215380': 'band', 'Q483501': 'artist'
    };
    const entityType = instanceIds.map(id => typeMap[id]).find(Boolean) || 'unknown';

    // Форматуємо зв'язки
    const relTypeMap = {
      'P108': 'employer', 'P102': 'party', 'P27': 'country',
      'P1344': 'event', 'P69': 'educated_at', 'P463': 'member_of',
      'P1366': 'replaced_by', 'P3373': 'sibling', 'P22': 'father', 'P25': 'mother'
    };

    const relations = bindings.map(b => ({
      relation: b.relLabel?.value || b.rel?.value?.split('/').pop(),
      relType: relTypeMap[b.rel?.value?.split('/').pop()] || 'related',
      target: b.targetLabel?.value,
      targetDesc: b.targetDesc?.value,
      targetId: b.target?.value?.split('/').pop()
    })).filter(r => r.target);

    // Групуємо по типу зв'язку
    const grouped = {};
    relations.forEach(r => {
      if (!grouped[r.relType]) grouped[r.relType] = [];
      grouped[r.relType].push({ name: r.target, desc: r.targetDesc, id: r.targetId });
    });

    res.status(200).json({
      qid,
      title,
      type: entityType,
      label: entity.labels?.en?.value || title,
      description: entity.descriptions?.en?.value || '',
      relations: grouped,
      relCount: relations.length,
      fetchedAt: Date.now()
    });

  } catch(e) {
    res.status(500).json({ error: e.message, title });
  }
};
