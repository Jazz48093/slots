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
SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1EDMwxLBoYV_-4RXul07q4NiXGF6uxiDTaakn4Akhpoc/export?format=csv&gid=1705723818"

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

        if path == '/med':
            self.path = '/med.html'
            super().do_GET()
        elif path == '/api/data':
            self.handle_api_data(parsed)
        elif path == '/api/asin-image':
            self.handle_asin_image(parsed)
        elif path == '/api/refresh-images':
            self.handle_refresh_images(parsed)
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
        # Cache busting request to Google Sheets
        nocache_url = f"{SHEET_CSV_URL}&_nocache={time.time_ns()}"
        req = urllib.request.Request(nocache_url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache'
        })

        try:
            with urllib.request.urlopen(req, timeout=12) as resp:
                csv_bytes = resp.read()
                csv_text = csv_bytes.decode('utf-8', errors='ignore')

            # Parse query params
            params = urllib.parse.parse_qs(parsed.query)
            format_type = params.get('format', ['json'])[0]
            col_param = params.get('col', ['g'])[0].lower()
            is_med = col_param in ['i', 'med']

            if format_type == 'csv':
                self.send_response(200)
                self.send_header('Content-Type', 'text/csv; charset=utf-8')
                self.end_headers()
                self.wfile.write(csv_bytes)
                return

            reader = list(csv.reader(io.StringIO(csv_text)))
            if not reader:
                items = []
            else:
                header_row = [c.strip().lower() for c in reader[0]]
                
                def find_col(possible_names, default_idx):
                    for name in possible_names:
                        for idx, h in enumerate(header_row):
                            if name in h:
                                return idx
                    return default_idx

                name_idx = find_col(['sku', 'product', 'item'], 0)
                asin_idx = find_col(['asin'], 1)
                link_idx = find_col(['link', 'url'], 2)
                qty_idx = find_col(['qty', 'quantity', 'target'], 3)
                done_idx = find_col(['done', 'order'], 4)
                rem_idx = find_col(['remaining', 'rem', 'left', 'slot'], 5)
                less_idx = find_col(['med. less', 'med less', 'med'], 8) if is_med else find_col(['dhruv less', 'dhruv', 'less %', 'less'], 6)

                asin_cache = load_asin_cache()
                items = []
                missing_asins = []

                for r in reader[1:]:
                    if not any(r):
                        continue
                    
                    def get_val(idx):
                        return r[idx].strip() if idx < len(r) else ''

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

                    items.append({
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

            response_data = {
                "status": "success",
                "timestamp": int(time.time()),
                "total": len(items),
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

def run_server():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    socketserver.TCPServer.allow_reuse_address = True
    for p in range(PORT, PORT + 10):
        try:
            with socketserver.TCPServer(("", p), LiveProxyHandler) as httpd:
                print(f"🚀 Live 104 Dashboard Proxy running at: http://localhost:{p}")
                httpd.serve_forever()
                break
        except OSError:
            continue

if __name__ == '__main__':
    run_server()
