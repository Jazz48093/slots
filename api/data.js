import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const SPREADSHEET_ID = "1EDMwxLBoYV_-4RXul07q4NiXGF6uxiDTaakn4Akhpoc";
const DEFAULT_GID = "823537914"; // "Slots - All Brands"

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Cache-Control': 'no-cache, no-store, max-age=0, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    };

    https.get(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchUrl(res.headers.location).then(resolve).catch(reject);
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

async function fetchSheetCsv(gid) {
  const ts = Date.now();
  // 1. Direct Google Visualization API (fast, instant live output)
  const gvizUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}&tq=&headers=1&_nocache=${ts}`;
  try {
    const text = await fetchUrl(gvizUrl);
    if (text && text.trim().length > 0) {
      return text;
    }
  } catch (e) {
    // fallback
  }

  // 2. Fallback to export endpoint
  const exportUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${gid}&_nocache=${ts}`;
  return await fetchUrl(exportUrl);
}

function parseCsv(text, asinCache) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length <= 1) return { items: [], brands: [] };

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

  const brandIdx = findCol(['brand', 'company'], -1);
  const nameIdx = findCol(['sku', 'product', 'item', 'title', 'name', 'desc'], brandIdx === 0 ? 1 : 0);
  const asinIdx = findCol(['asin', 'prid', 'id'], 2);
  const linkIdx = findCol(['link', 'url', 'href'], 3);
  const qtyIdx = findCol(['qty', 'quantity', 'target'], 4);
  const doneIdx = findCol(['done', 'order', 'placed', 'completed'], 5);
  const remIdx = findCol(['remaining', 'rem', 'left', 'slot', 'pending'], 6);
  const lessIdx = findCol(['less', 'discount', '%', 'off'], -1);

  const items = [];
  const brandSet = new Set();

  for (let i = 1; i < lines.length; i++) {
    const r = parseRow(lines[i]);
    if (!r || r.length === 0 || !r.some(v => v)) continue;

    const brand = (brandIdx !== -1 && r[brandIdx]) ? r[brandIdx].trim() : 'General';
    let name = (nameIdx !== -1 && r[nameIdx]) ? r[nameIdx].trim() : '';
    let asin = (asinIdx !== -1 && r[asinIdx]) ? r[asinIdx].trim() : '';
    let link = (linkIdx !== -1 && r[linkIdx]) ? r[linkIdx].trim() : '';
    const qtyRaw = (qtyIdx !== -1 && r[qtyIdx]) ? r[qtyIdx].trim() : '0';
    const doneRaw = (doneIdx !== -1 && r[doneIdx]) ? r[doneIdx].trim() : '0';
    const remRaw = (remIdx !== -1 && r[remIdx]) ? r[remIdx].trim() : '';
    const lessRaw = (lessIdx !== -1 && r[lessIdx]) ? r[lessIdx].trim() : '';

    if (link) {
      if (link.startsWith('www.')) link = 'https://' + link;
      else if (!link.startsWith('http://') && !link.startsWith('https://')) link = 'https://' + link;
    }

    // Auto-extract ASIN / ID from link if empty
    if (!asin && link) {
      const amazonMatch = link.match(/field-asin=([A-Z0-9]{10})/i) ||
                          link.match(/\/dp\/([A-Z0-9]{10})/i) ||
                          link.match(/\/gp\/product\/([A-Z0-9]{10})/i);
      if (amazonMatch) {
        asin = amazonMatch[1].toUpperCase();
      } else {
        const blinkitMatch = link.match(/\/prid\/(\d+)/i);
        if (blinkitMatch) {
          asin = blinkitMatch[1];
        }
      }
    }

    // If name is blank but ASIN or Link is present, generate fallback product name
    if (!name && asin) {
      name = `${brand} - ${asin}`;
    } else if (!name && !asin) {
      continue;
    }

    let platform = 'Product';
    if (link.includes('amazon.')) platform = 'Amazon';
    else if (link.includes('blinkit.')) platform = 'Blinkit';
    else if (link.includes('flipkart.')) platform = 'Flipkart';
    else if (link.includes('myntra.')) platform = 'Myntra';

    const lessClean = lessRaw.trim();
    const less = (!lessClean || ['--', '-', '0%', 'N/A', 'na', 'null', 'none'].includes(lessClean)) ? '-' : lessClean;

    const qty = parseInt(qtyRaw, 10) || 0;
    const done = parseInt(doneRaw, 10) || 0;
    
    // Smart Remaining: If user left Remaining empty or formula failed, compute qty - done
    let remaining;
    if (remRaw !== '' && !isNaN(parseInt(remRaw, 10))) {
      remaining = parseInt(remRaw, 10);
    } else {
      remaining = Math.max(0, qty - done);
    }

    const image = (asin && asinCache[asin]) ? asinCache[asin] : '';

    if (brand) brandSet.add(brand);

    items.push({
      brand,
      name,
      asin,
      link,
      platform,
      qty,
      done,
      remaining,
      less,
      image
    });
  }

  // Preserve natural Sheet order (insertion order in Set) so newly added brands appear at the bottom!
  const brands = Array.from(brandSet);
  return { items, brands };
}

export default async function handler(req, res) {
  // Set strict zero-cache headers for instant real-time reflection
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // 1. Load ASIN Cache (robust relative & cwd path)
    let asinCache = {};
    const cwdPath = path.join(process.cwd(), 'asin_cache.json');
    let cachePath = fs.existsSync(cwdPath) ? cwdPath : null;
    if (!cachePath) {
      try {
        const fileDir = path.dirname(fileURLToPath(import.meta.url));
        const relPath = path.join(fileDir, '../asin_cache.json');
        if (fs.existsSync(relPath)) cachePath = relPath;
      } catch (e) {}
    }
    if (cachePath && fs.existsSync(cachePath)) {
      try {
        asinCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      } catch (e) {
        // ignore parse error
      }
    }

    // 2. Fetch CSV
    const gid = (req.query && req.query.gid) || DEFAULT_GID;
    const csvText = await fetchSheetCsv(gid);

    // 3. Parse and enrich
    const { items, brands } = parseCsv(csvText, asinCache);

    const totalTarget = items.reduce((sum, item) => sum + item.qty, 0);
    const totalDone = items.reduce((sum, item) => sum + item.done, 0);
    const totalRemaining = items.reduce((sum, item) => sum + item.remaining, 0);

    res.status(200).json({
      status: 'success',
      timestamp: Math.floor(Date.now() / 1000),
      total: items.length,
      brands,
      stats: {
        totalBrands: brands.length,
        totalSkus: items.length,
        totalTarget,
        totalDone,
        totalRemaining
      },
      items
    });
  } catch (err) {
    console.error('Error fetching data:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
}
