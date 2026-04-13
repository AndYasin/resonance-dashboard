module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const title = req.query.title || '';
  const lang  = req.query.lang  || 'en';
  if (!title) { res.status(400).json({ error: 'title required' }); return; }

  try {
    // Крок 1: Wikidata ID з Wikipedia
    const wpRes = await fetch(
      `https://${lang}.wikipedia.org/w/api.php?action=query&prop=pageprops&titles=${encodeURIComponent(title)}&ppprop=wikibase_item&format=json`,
      { headers: { 'User-Agent': 'ResonanceDash/1.0' } }
    );
    const wpData = await wpRes.json();
    const qid = Object.values(wpData.query?.pages || {})[0]?.pageprops?.wikibase_item;
    if (!qid) return res.status(200).json({ error: 'no wikidata id', title });

    // Крок 2: SPARQL — зв'язки що мають значення для аналізу впливу
    const sparql = `
      SELECT DISTINCT ?prop ?propLabel ?target ?targetLabel ?targetDesc WHERE {
        VALUES ?prop {
          wdt:P108  wdt:P102  wdt:P27   wdt:P39   wdt:P26
          wdt:P463  wdt:P69   wdt:P1344 wdt:P749  wdt:P355
          wdt:P17   wdt:P131  wdt:P3373 wdt:P169  wdt:P488
        }
        wd:${qid} ?prop ?target .
        FILTER(!isLiteral(?target))
        SERVICE wikibase:label {
          bd:serviceParam wikibase:language "en" .
          ?prop  rdfs:label ?propLabel .
          ?target rdfs:label ?targetLabel .
          OPTIONAL { ?target schema:description ?targetDesc . }
        }
      } LIMIT 60
    `;

    const sparqlCtrl = new AbortController();
    const sparqlTimeout = setTimeout(() => sparqlCtrl.abort(), 8000);
    let bindings = [];
    try {
      const sparqlRes = await fetch(
        'https://query.wikidata.org/sparql?query=' + encodeURIComponent(sparql),
        { headers: { 'Accept': 'application/json', 'User-Agent': 'ResonanceDash/1.0' }, signal: sparqlCtrl.signal }
      );
      const sparqlData = await sparqlRes.json();
      bindings = sparqlData.results?.bindings || [];
    } catch(sparqlErr) {
      console.log('SPARQL timeout or error:', sparqlErr.message);
    } finally {
      clearTimeout(sparqlTimeout);
    }

    // Крок 3: тип сутності + опис
    const entityCtrl = new AbortController();
    const entityTimeout = setTimeout(() => entityCtrl.abort(), 5000);
    let entityData = { entities: {} };
    try {
      const entityRes = await fetch(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims|labels|descriptions&languages=en&format=json`,
        { headers: { 'User-Agent': 'ResonanceDash/1.0' }, signal: entityCtrl.signal }
      );
      entityData = await entityRes.json();
    } catch(e) { console.log('Entity fetch error:', e.message); } finally { clearTimeout(entityTimeout); }
    const entity = entityData?.entities?.[qid] || {};

    const typeMap = {
      'Q5':'person','Q4830453':'company','Q6256':'country',
      'Q43229':'organization','Q7278':'political_party',
      'Q215380':'band','Q483501':'artist','Q891723':'public_company',
      'Q327333':'government_agency'
    };
    const instanceIds = (entity.claims?.P31 || [])
      .map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
    const entityType = instanceIds.map(id => typeMap[id]).find(Boolean) || 'unknown';

    // Маппінг → людська назва + пріоритет для аналізу
    const relMap = {
      P108:'employer', P102:'party',    P27:'country',   P39:'position',
      P26:'spouse',    P463:'member_of',P69:'educated_at',P1344:'participated_in',
      P749:'parent_org',P355:'subsidiary',P17:'country', P131:'location',
      P3373:'sibling', P169:'ceo',      P488:'chairperson'
    };

    // Пріоритетні типи для аналізу впливу
    const highValue = new Set(['employer','party','position','spouse','ceo','chairperson','parent_org','subsidiary']);

    const relations = {};
    bindings.forEach(b => {
      const propId = b.prop?.value?.split('/').pop();
      const relType = relMap[propId] || 'related';
      if (!relations[relType]) relations[relType] = [];
      const item = {
        name: b.targetLabel?.value,
        desc: b.targetDesc?.value || '',
        id:   b.target?.value?.split('/').pop(),
        highValue: highValue.has(relType)
      };
      if (item.name && !relations[relType].find(x => x.id === item.id)) {
        relations[relType].push(item);
      }
    });

    // Stock tickers — Yahoo Finance символи для компаній (якщо є P414)
    const stockClaims = entity.claims?.P414 || [];
    const tickers = stockClaims
      .map(c => c.mainsnak?.datavalue?.value)
      .filter(Boolean);

    res.status(200).json({
      qid,
      title,
      type: entityType,
      label: entity.labels?.en?.value || title,
      description: entity.descriptions?.en?.value || '',
      tickers,
      relations,
      relCount: bindings.length,
      fetchedAt: Date.now()
    });

  } catch(e) {
    res.status(500).json({ error: e.message, title });
  }
};
