import fs from 'fs';
import path from 'path';
import https from 'https';

const CACHE_PATH = path.join(process.cwd(), 'asin_cache.json');

function cleanImageUrl(url) {
  if (!url) return '';
  return url.replace(/\._[A-Z0-9_,]+_\./, '.');
}

function scrapeAmazonImage(asin) {
  return new Promise((resolve) => {
    if (!asin || asin.length !== 10) return resolve('');
    const url = `https://www.amazon.in/dp/${asin}`;
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-IN,en-GB;q=0.9,en;q=0.8'
      }
    };

    https.get(url, options, (res) => {
      let html = '';
      res.on('data', chunk => { html += chunk; });
      res.on('end', () => {
        try {
          // Method 1: landingImage data-a-dynamic-image
          const m1 = html.match(/id="landingImage"[^>]*data-a-dynamic-image="([^"]+)"/);
          if (m1) {
            const raw = m1[1].replace(/&quot;/g, '"');
            const parsed = JSON.parse(raw);
            const first = Object.keys(parsed)[0];
            if (first) return resolve(cleanImageUrl(first));
          }

          // Method 2: colorImages
          const m2 = html.match(/'colorImages':\s*\{\s*'initial':\s*(\[\{.*?\}\])\s*\},/s);
          if (m2) {
            let rawJson = m2[1].replace(/([a-zA-Z0-9_]+):/g, '"$1":').replace(/'/g, '"');
            const data = JSON.parse(rawJson);
            if (data && data[0]) {
              const img = data[0].hiRes || data[0].large;
              if (img) return resolve(cleanImageUrl(img));
            }
          }

          // Method 3: Media Amazon image pattern
          const m3 = html.match(/https:\/\/m\.media-amazon\.com\/images\/I\/([a-zA-Z0-9_\-\+\%]+)\.(?:jpg|png)/);
          if (m3) {
            return resolve(cleanImageUrl(m3[0]));
          }
        } catch (e) {
          // parse error
        }
        resolve('');
      });
    }).on('error', () => resolve(''));
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const asin = (req.query && req.query.asin ? String(req.query.asin).trim() : '');
  const force = req.query && (req.query.refresh === '1' || req.query.refresh === 'true' || req.query.force === '1');

  if (!asin) {
    return res.status(400).json({ error: 'Missing asin parameter' });
  }

  let cache = {};
  if (fs.existsSync(CACHE_PATH)) {
    try {
      cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    } catch (e) {}
  }

  let image = cache[asin] || '';

  if (force || !image) {
    const scraped = await scrapeAmazonImage(asin);
    if (scraped) {
      image = scraped;
      try {
        cache[asin] = image;
        fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
      } catch (err) {
        // file system might be read-only in some lambda environments
      }
    }
  }

  return res.status(200).json({ asin, image });
}
