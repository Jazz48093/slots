import http.server
import socketserver
import urllib.request
import urllib.parse
import json
import csv
import io
import time
import os
import re
import threading

from fetch_asin_images import (
    extract_image_for_asin,
    refresh_all_images,
    load_cache as load_asin_cache,
    save_cache as save_asin_cache,
    CACHE_FILE
)

PORT = 8088
SPREADSHEET_ID = "1EDMwxLBoYV_-4RXul07q4NiXGF6uxiDTaakn4Akhpoc"
DEFAULT_GID = "823537914" # "Slots - All Brands"

# Background worker lock to prevent overlapping sync threads
_bg_fetch_lock = threading.Lock()
_bg_fetching_asins = set()

def background_fetch_missing_asins(asins):
    global _bg_fetching_asins
    with _bg_fetch_lock:
        to_fetch = [a for a in asins if a not in _bg_fetching_asins]
        if not to_fetch:
            return
        _bg_fetching_asins.update(to_fetch)

    def worker():
        global _bg_fetching_asins
        try:
            cache = load_asin_cache()
            updated = False
            for asin in to_fetch:
                try:
                    _, img = extract_image_for_asin(asin)
                    if img:
                        cache[asin] = img
                        updated = True
                        print(f"✓ [Background Sync] Cached image for {asin} -> {img}")
                except Exception as e:
                    print(f"✗ [Background Sync] Error fetching {asin}: {e}")
            if updated:
                save_asin_cache(cache)
        finally:
            with _bg_fetch_lock:
                for a in to_fetch:
                    _bg_fetching_asins.discard(a)

    t = threading.Thread(target=worker, daemon=True)
    t.start()


class LiveProxyHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Strict zero-cache headers for all responses
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Pragma, Cache-Control')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_HEAD(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ['/api/data', '/api/asin-image', '/api/refresh-images']:
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
        else:
            super().do_HEAD()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path in ['/dhruv', '/dhruv/']:
            self.path = '/dhruv.html'
            super().do_GET()
        elif path in ['/med', '/med/']:
            self.path = '/med.html'
            super().do_GET()
        elif path in ['/sites', '/sites/', '/hub', '/hub/', '/vercel', '/vercel/']:
            self.path = '/sites.html'
            super().do_GET()
        elif path == '/api/data':
            self.handle_api_data(parsed)
        elif path == '/api/asin-image':
            self.handle_asin_image(parsed)
        elif path == '/api/refresh-images':
            self.handle_refresh_images(parsed)
        elif path == '/api/vercel-projects':
            self.handle_vercel_projects(parsed)
        else:
            super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/api/refresh-images':
            self.handle_refresh_images(parsed)
        else:
            self.send_response(404)
            self.end_headers()

    def handle_api_data(self, parsed):
        params = urllib.parse.parse_qs(parsed.query)
        gid = params.get('gid', [DEFAULT_GID])[0]

        # First try gviz endpoint (fast, direct, no redirect)
        gviz_url = f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid={gid}&_nocache={time.time_ns()}"
        req = urllib.request.Request(gviz_url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
        })

        csv_text = ""
        try:
            with urllib.request.urlopen(req, timeout=12) as resp:
                csv_bytes = resp.read()
                csv_text = csv_bytes.decode('utf-8', errors='ignore')
        except Exception:
            # Fallback to export format
            export_url = f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/export?format=csv&gid={gid}&_nocache={time.time_ns()}"
            req2 = urllib.request.Request(export_url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            })
            with urllib.request.urlopen(req2, timeout=12) as resp2:
                csv_bytes = resp2.read()
                csv_text = csv_bytes.decode('utf-8', errors='ignore')

        format_type = params.get('format', ['json'])[0]
        if format_type == 'csv':
            self.send_response(200)
            self.send_header('Content-Type', 'text/csv; charset=utf-8')
            self.end_headers()
            self.wfile.write(csv_text.encode('utf-8'))
            return

        try:
            reader = list(csv.reader(io.StringIO(csv_text)))
            if not reader:
                items = []
                brands = []
            else:
                header_row = [c.strip().lower() for c in reader[0]]
                
                def find_col(possible_names, default_idx):
                    for name in possible_names:
                        for idx, h in enumerate(header_row):
                            if name in h:
                                return idx
                    return default_idx

                brand_idx = find_col(['brand'], -1)
                name_idx = find_col(['sku', 'product', 'item', 'name'], 1 if brand_idx == 0 else 0)
                asin_idx = find_col(['asin'], 2)
                link_idx = find_col(['link', 'url'], 3)
                qty_idx = find_col(['qty', 'quantity', 'target'], 4)
                done_idx = find_col(['done', 'order', 'placed'], 5)
                rem_idx = find_col(['remaining', 'rem', 'left', 'slot', 'pending'], 6)
                less_idx = find_col(['less', 'discount', '%'], -1)

                asin_cache = load_asin_cache()
                items = []
                brand_set = set()
                missing_asins = []

                for r in reader[1:]:
                    if not any(r):
                        continue
                    
                    def get_val(idx):
                        return r[idx].strip() if idx != -1 and idx < len(r) else ''

                    brand = get_val(brand_idx) or 'General'
                    name = get_val(name_idx)
                    asin = get_val(asin_idx)
                    link = get_val(link_idx)
                    qty_raw = get_val(qty_idx) or '0'
                    done_raw = get_val(done_idx) or '0'
                    rem_raw = get_val(rem_idx) or '0'
                    less_raw = get_val(less_idx)

                    if not name and not asin:
                        continue

                    # Normalize link
                    if link:
                        if link.startswith('www.'):
                            link = 'https://' + link
                        elif not link.startswith('http://') and not link.startswith('https://'):
                            link = 'https://' + link

                    # Normalize less percentage
                    less_clean = less_raw.strip()
                    if not less_clean or less_clean in ['--', '-', '0%', 'N/A', 'na', 'null', 'none']:
                        less_display = '-'
                    else:
                        less_display = less_clean

                    try:
                        qty = int(float(qty_raw))
                    except Exception:
                        qty = 0

                    try:
                        done = int(float(done_raw))
                    except Exception:
                        done = 0

                    try:
                        remaining = int(float(rem_raw))
                    except Exception:
                        remaining = 0

                    # Look up image in cache
                    image = asin_cache.get(asin, "")
                    if asin and not image:
                        missing_asins.append(asin)

                    if brand:
                        brand_set.add(brand)

                    items.append({
                        "brand": brand,
                        "name": name,
                        "asin": asin,
                        "link": link,
                        "qty": qty,
                        "done": done,
                        "remaining": remaining,
                        "less": less_display,
                        "image": image
                    })

                # Automatically trigger background image scrape for missing ASINs
                if missing_asins:
                    background_fetch_missing_asins(missing_asins)

                brands = sorted(list(brand_set))

            total_target = sum(item["qty"] for item in items)
            total_done = sum(item["done"] for item in items)
            total_remaining = sum(item["remaining"] for item in items)

            response_data = {
                "status": "success",
                "timestamp": int(time.time()),
                "total": len(items),
                "brands": brands,
                "stats": {
                    "totalBrands": len(brands),
                    "totalSkus": len(items),
                    "totalTarget": total_target,
                    "totalDone": total_done,
                    "totalRemaining": total_remaining
                },
                "items": items
            }

            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(json.dumps(response_data, ensure_ascii=False).encode('utf-8'))

        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            err_resp = {"status": "error", "message": str(e)}
            self.wfile.write(json.dumps(err_resp).encode('utf-8'))

    def handle_asin_image(self, parsed):
        params = urllib.parse.parse_qs(parsed.query)
        asin = params.get('asin', [''])[0].strip()
        force_refresh = params.get('refresh', ['0'])[0] in ['1', 'true', 'yes'] or params.get('force', ['0'])[0] in ['1', 'true', 'yes']

        if not asin:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"error": "Missing asin parameter"}')
            return

        cache = load_asin_cache()
        img = cache.get(asin, "")

        if force_refresh or not img:
            _, fetched_img = extract_image_for_asin(asin)
            if fetched_img:
                img = fetched_img
                cache[asin] = img
                save_asin_cache(cache)

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"asin": asin, "image": img or ""}).encode('utf-8'))

    def handle_refresh_images(self, parsed):
        params = urllib.parse.parse_qs(parsed.query)
        force = params.get('force', ['0'])[0] in ['1', 'true', 'yes'] or params.get('all', ['0'])[0] in ['1', 'true', 'yes']
        asin_param = params.get('asin', [None])[0]

        start_time = time.time()
        res = refresh_all_images(force=force, specific_asin=asin_param, max_workers=8)
        res["duration_seconds"] = round(time.time() - start_time, 2)

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(res).encode('utf-8'))

    def handle_vercel_projects(self, parsed):
        params = urllib.parse.parse_qs(parsed.query)
        token = params.get('token', [None])[0]
        auth_hdr = self.headers.get('Authorization')
        if auth_hdr and auth_hdr.startswith('Bearer '):
            token = auth_hdr.split('Bearer ', 1)[1].strip()

        if not token:
            default_data = {
                "status": "success",
                "mode": "default",
                "projects": [
                    {
                        "id": "brand-slots-main",
                        "name": "Brand Slots Live Counter",
                        "url": "https://brand-slots.vercel.app",
                        "category": "Live Dashboards",
                        "framework": "Vercel Serverless",
                        "icon": "🏷️",
                        "description": "Multi-Brand Live Counter production portal tracking order targets, remaining slots, and ASIN catalog.",
                        "environment": "Production",
                        "pinned": True
                    },
                    {
                        "id": "uc104-main",
                        "name": "Slots Live Counter",
                        "url": "https://uc104.vercel.app",
                        "category": "Live Dashboards",
                        "framework": "Vercel Serverless",
                        "icon": "📊",
                        "description": "Multi-Brand Real-Time Order Targets, Fulfilled Quantities & Remaining Slots synced live with Google Sheets.",
                        "environment": "Production",
                        "pinned": True
                    },
                    {
                        "id": "uc104-med",
                        "name": "MED Special Allocation Portal",
                        "url": "https://uc104.vercel.app/med",
                        "category": "Client Portals",
                        "framework": "Vercel Serverless",
                        "icon": "💊",
                        "description": "Specialized Medical & Merchant allocation tracker with Col I discount matrices and 1-click copy action.",
                        "environment": "Production",
                        "pinned": True
                    },
                    {
                        "id": "uc104-dhruv",
                        "name": "Dhruv Partner Monitor",
                        "url": "https://uc104.vercel.app/dhruv",
                        "category": "Client Portals",
                        "framework": "Vercel Serverless",
                        "icon": "🤝",
                        "description": "Dedicated partner fulfillment monitoring tracking Col G allocation metrics and real-time inventory count.",
                        "environment": "Production",
                        "pinned": False
                    }
                ]
            }
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(default_data).encode('utf-8'))
            return

        try:
            req = urllib.request.Request(
                "https://api.vercel.com/v9/projects",
                headers={
                    "Authorization": f"Bearer {token}",
                    "User-Agent": "Vercel-Sites-Hub/1.0"
                }
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(e.read())
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))

def run_server():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    socketserver.TCPServer.allow_reuse_address = True
    for p in range(PORT, PORT + 10):
        try:
            with socketserver.TCPServer(("", p), LiveProxyHandler) as httpd:
                print(f"🚀 Slots Live Counter Proxy running at: http://localhost:{p}")
                httpd.serve_forever()
                break
        except OSError:
            continue

if __name__ == '__main__':
    run_server()
