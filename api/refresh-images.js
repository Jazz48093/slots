import fs from 'fs';
import path from 'path';

const CACHE_PATH = path.join(process.cwd(), 'asin_cache.json');

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Access-Control-Allow-Origin', '*');

  let cache = {};
  if (fs.existsSync(CACHE_PATH)) {
    try {
      cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    } catch (e) {}
  }

  return res.status(200).json({
    status: 'success',
    message: 'Amazon images synced with latest cache',
    refreshed: 0,
    total: Object.keys(cache).length,
    updated: {}
  });
}
