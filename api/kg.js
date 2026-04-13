module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({ 
    hasKey: !!process.env.GOOGLE_KG_KEY,
    keyStart: process.env.GOOGLE_KG_KEY?.slice(0,6) || 'none',
    allKeys: Object.keys(process.env).filter(k=>k.includes('GOOGLE'))
  });
};
