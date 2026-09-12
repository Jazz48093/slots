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

PORT = 8088
SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1EDMwxLBoYV_-4RXul07q4NiXGF6uxiDTaakn4Akhpoc/export?format=csv&gid=1705723818"
CACHE_FILE = os.path.join(os.path.dirname(__file__), "asin_cache.json")

AMAZON_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept-Language': 'en-IN,en-GB;q=0.9,en;q=0.8',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
}

def load_asin_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def save_asin_cache(cache):
    try:
        with open(CACHE_FILE, 'w', encoding='utf-8') as f:
            json.dump(cache, f, indent=2)
    except Exception:
        pass

def fetch_asin_image(asin):
    if not asin or len(asin) != 10:
        return None
    url = f"https://www.amazon.in/dp/{asin}"
    try:
        req = urllib.request.Request(url, headers=AMAZON_HEADERS)
        with urllib.request.urlopen(req, timeout=8) as resp:
            html = resp.read().decode('utf-8', errors='ignore')
            m1 = re.search(r'id="landingImage"[^>]*data-a-dynamic-image="([^"]+)"', html)
            if m1:
                imgs = json.loads(m1.group(1).replace('&quot;', '"'))
                if imgs:
                    raw_img = list(imgs.keys())[0]
                    return re.sub(r'\._[A-Z0-9_,]+_\.', '.', raw_img)
            m2 = re.search(r"'colorImages':\s*\{\s*'initial':\s*(\[\{.*?\}\])\s*\},", html, re.DOTALL)
            if m2:
                try:
                    raw = m2.group(1)
                    raw = re.sub(r'([a-zA-Z0-9_]+):', r'"\1":', raw)
                    raw = raw.replace("'", '"')
                    data = json.loads(raw)
                    if data:
                        img = data[0].get('hiRes') or data[0].get('large')
                        if img:
                            return re.sub(r'\._[A-Z0-9_,]+_\.', '.', img)
                except Exception:
                    pass
            m3 = re.search(r'https://m\.media-amazon\.com/images/I/([a-zA-Z0-9_\-\+\%]+)\.(?:jpg|png)', html)
            if m3:
                return re.sub(r'\._[A-Z0-9_,]+_\.', '.', m3.group(0))
    except Exception:
        pass
    return None

class LiveProxyHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Strict zero-cache headers for all responses
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def do_HEAD(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ['/api/data', '/api/asin-image']:
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
        else:
            super().do_HEAD()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == '/api/data':
            self.handle_api_data(parsed)
        elif path == '/api/asin-image':
            self.handle_asin_image(parsed)
        else:
            super().do_GET()

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
                less_idx = find_col(['dhruv less', 'dhruv', 'less %', 'less'], 6)

                asin_cache = load_asin_cache()
                items = []

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

                    # Normalize less percentage: if empty, "--", or "-", keep as "-"
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

        if not asin:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"error": "Missing asin parameter"}')
            return

        cache = load_asin_cache()
        if asin in cache and cache[asin]:
            img = cache[asin]
        else:
            img = fetch_asin_image(asin)
            if img:
                cache[asin] = img
                save_asin_cache(cache)

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({"asin": asin, "image": img or ""}).encode('utf-8'))

def run_server():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    socketserver.TCPServer.allow_reuse_address = True
    port = PORT
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
