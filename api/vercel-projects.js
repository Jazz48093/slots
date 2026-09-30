import https from 'https';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Extract token from query or Authorization header
  const token = req.query.token || (req.headers.authorization ? req.headers.authorization.replace(/^Bearer\s+/i, '') : null);

  if (!token) {
    // If no token provided, return default project listings
    return res.status(200).json({
      status: 'success',
      mode: 'default',
      projects: [
        {
          id: 'brand-slots-main',
          name: 'Brand Slots Live Counter',
          url: 'https://brand-slots.vercel.app',
          category: 'Live Dashboards',
          framework: 'Vercel Serverless',
          icon: '🏷️',
          description: 'Multi-Brand Live Counter production portal tracking order targets, remaining slots, and ASIN catalog.',
          environment: 'Production',
          pinned: true
        },
        {
          id: 'uc104-main',
          name: 'Slots Live Counter',
          url: 'https://uc104.vercel.app',
          category: 'Live Dashboards',
          framework: 'Vercel Serverless',
          icon: '📊',
          description: 'Multi-Brand Real-Time Order Targets, Fulfilled Quantities & Remaining Slots synced live with Google Sheets.',
          environment: 'Production',
          pinned: true
        },
        {
          id: 'uc104-med',
          name: 'MED Special Allocation Portal',
          url: 'https://uc104.vercel.app/med',
          category: 'Client Portals',
          framework: 'Vercel Serverless',
          icon: '💊',
          description: 'Specialized Medical & Merchant allocation tracker with Col I discount matrices and 1-click copy action.',
          environment: 'Production',
          pinned: true
        },
        {
          id: 'uc104-dhruv',
          name: 'Dhruv Partner Monitor',
          url: 'https://uc104.vercel.app/dhruv',
          category: 'Client Portals',
          framework: 'Vercel Serverless',
          icon: '🤝',
          description: 'Dedicated partner fulfillment monitoring tracking Col G allocation metrics and real-time inventory count.',
          environment: 'Production',
          pinned: false
        }
      ]
    });
  }

  // Proxy to Vercel API
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.vercel.com',
      port: 443,
      path: '/v9/projects',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Vercel-Sites-Hub/1.0'
      }
    };

    const vercelReq = https.request(options, (vercelRes) => {
      let body = '';
      vercelRes.on('data', chunk => body += chunk);
      vercelRes.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          res.status(vercelRes.statusCode).json(parsed);
        } catch (e) {
          res.status(502).json({ error: 'Invalid response from Vercel API' });
        }
        resolve();
      });
    });

    vercelReq.on('error', (err) => {
      res.status(500).json({ error: err.message });
      resolve();
    });

    vercelReq.end();
  });
}
