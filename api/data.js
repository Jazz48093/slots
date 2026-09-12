import fs from 'fs';
import path from 'path';
import https from 'https';

const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1EDMwxLBoYV_-4RXul07q4NiXGF6uxiDTaakn4Akhpoc/export?format=csv&gid=1705723818";

function fetchTextWithRedirect(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        https.get(res.headers.location, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res2) => {
          let data = '';
          res2.on('data', chunk => data += chunk);
          res2.on('end', () => resolve(data));
        }).on('error', reject);
      } else if (res.statusCode >= 200 && res.statusCode < 300) {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      } else {
        reject(new Error(`Failed to fetch sheet, status: ${res.statusCode}`));
      }
    }).on('error', reject);
  });
}

function parseCsv(text, asinCache) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length <= 1) return [];

  function parseRow(rowStr) {
    const row = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < rowStr.length; i++) {
      const c = rowStr[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === ',' && !inQuotes) {
        row.push(cur);
        cur = '';
      } else {
        cur += c;
      }
    }
    row.push(cur);
    return row.map(s => s.replace(/^"|"$/g, '').trim());
  }

  const headerRow = parseRow(lines[0]).map(h => h.toLowerCase().trim());
  function findCol(names, defIdx) {
    for (const n of names) {
      const idx = headerRow.findIndex(h => h.includes(n));
      if (idx !== -1) return idx;
    }
    return defIdx;
  }

  const nameIdx = findCol(['sku', 'product', 'item'], 0);
  const asinIdx = findCol(['asin'], 1);
  const linkIdx = findCol(['link', 'url'], 2);
  const qtyIdx = findCol(['qty', 'quantity', 'target'], 3);
  const doneIdx = findCol(['done', 'order'], 4);
  const remIdx = findCol(['remaining', 'rem', 'left', 'slot'], 5);
  const lessIdx = findCol(['dhruv less', 'dhruv', 'less %', 'less'], 6);

  const items = [];
  for (let i = 1; i < lines.length; i++) {
    const r = parseRow(lines[i]);
    if (!r || r.length === 0 || !r.some(v => v)) continue;
    const name = r[nameIdx] || '';
    const asin = r[asinIdx] || '';
    let link = r[linkIdx] || '';
    const qtyRaw = r[qtyIdx] || '0';
    const doneRaw = r[doneIdx] || '0';
    const remRaw = r[remIdx] || '0';
    const lessRaw = r[lessIdx] || '';

    if (!name && !asin) continue;

    if (link) {
      if (link.startsWith('www.')) link = 'https://' + link;
      else if (!link.startsWith('http://') && !link.startsWith('https://')) link = 'https://' + link;
    }

    const lessClean = lessRaw.trim();
    const less = (!lessClean || ['--', '-', '0%', 'N/A', 'na', 'null', 'none'].includes(lessClean)) ? '-' : lessClean;

    const qty = parseInt(qtyRaw, 10) || 0;
    const done = parseInt(doneRaw, 10) || 0;
    const remaining = parseInt(remRaw, 10) || 0;
    const image = asinCache[asin] || '';

    items.push({ name, asin, link, qty, done, remaining, less, image });
  }
  return items;
}

export default async function handler(req, res) {
  // Set strict zero-cache headers
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // 1. Load ASIN Cache
    let asinCache = {};
    const cachePath = path.join(process.cwd(), 'asin_cache.json');
    if (fs.existsSync(cachePath)) {
      try {
        asinCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      } catch (e) {
        // ignore parse error
      }
    }

    // 2. Query Google Sheet with nanosecond cache-busting timestamp
    const nocacheUrl = `${SHEET_CSV_URL}&_nocache=${Date.now()}`;
    const csvText = await fetchTextWithRedirect(nocacheUrl);

    // 3. Parse and enrich
    const items = parseCsv(csvText, asinCache);

    res.status(200).json({
      status: 'success',
      timestamp: Math.floor(Date.now() / 1000),
      total: items.length,
      items
    });
  } catch (err) {
    console.error('Error fetching data:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
}
