import urllib.request
import re
import json
import csv
import io
import time
import concurrent.futures

SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1EDMwxLBoYV_-4RXul07q4NiXGF6uxiDTaakn4Akhpoc/export?format=csv&gid=1705723818"
CACHE_FILE = "asin_cache.json"

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept-Language': 'en-IN,en-GB;q=0.9,en;q=0.8',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
}

def clean_image_url(url):
    if not url:
        return ""
    # Strip Amazon dynamic sizing parameter like ._SX355_. or ._SY450_. to get full resolution
    clean = re.sub(r'\._[A-Z0-9_,]+_\.', '.', url)
    return clean

def extract_image_for_asin(asin):
    if not asin or len(asin) != 10:
        return asin, None
    url = f"https://www.amazon.in/dp/{asin}"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=12) as resp:
            html = resp.read().decode('utf-8', errors='ignore')
            
            # Method 1: landingImage data-a-dynamic-image
            m1 = re.search(r'id="landingImage"[^>]*data-a-dynamic-image="([^"]+)"', html)
            if m1:
                imgs = json.loads(m1.group(1).replace('&quot;', '"'))
                if imgs:
                    return asin, clean_image_url(list(imgs.keys())[0])
            
            # Method 2: colorImages initial
            m2 = re.search(r"'colorImages':\s*\{\s*'initial':\s*(\[\{.*?\}\])\s*\},", html, re.DOTALL)
            if m2:
                try:
                    raw = m2.group(1)
                    raw = re.sub(r'([a-zA-Z0-9_]+):', r'"\1":', raw)
                    raw = raw.replace("'", '"')
                    data = json.loads(raw)
                    if data:
                        if data[0].get('hiRes'):
                            return asin, clean_image_url(data[0]['hiRes'])
                        if data[0].get('large'):
                            return asin, clean_image_url(data[0]['large'])
                except Exception:
                    pass

            # Method 3: main-image or imgTagWrapperId
            m3 = re.search(r'https://m\.media-amazon\.com/images/I/([a-zA-Z0-9_\-\+\%]+)\.(?:jpg|png)', html)
            if m3:
                return asin, clean_image_url(m3.group(0))

    except Exception as e:
        # print(f"Error fetching {asin}: {e}")
        pass

    return asin, None

def main():
    # 1. Load existing cache if any
    cache = {}
    try:
        with open(CACHE_FILE, 'r', encoding='utf-8') as f:
            cache = json.load(f)
            print(f"Loaded {len(cache)} existing cached ASIN images.")
    except Exception:
        pass

    # 2. Fetch sheet to get current ASINs
    req = urllib.request.Request(SHEET_CSV_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as resp:
        csv_text = resp.read().decode('utf-8')

    reader = list(csv.reader(io.StringIO(csv_text)))
    asins_to_fetch = []
    for r in reader[1:]:
        if len(r) > 1 and r[1].strip():
            asin = r[1].strip()
            if asin not in cache or not cache[asin]:
                asins_to_fetch.append(asin)

    print(f"Found {len(asins_to_fetch)} ASINs needing image fetch...")

    # 3. Fetch with thread pool
    if asins_to_fetch:
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            future_to_asin = {executor.submit(extract_image_for_asin, a): a for a in asins_to_fetch}
            for future in concurrent.futures.as_completed(future_to_asin):
                asin, img = future.result()
                if img:
                    cache[asin] = img
                    print(f"✓ {asin} -> {img}")
                else:
                    print(f"✗ {asin} -> Not found")

        with open(CACHE_FILE, 'w', encoding='utf-8') as f:
            json.dump(cache, f, indent=2)
        print(f"Saved {len(cache)} ASIN images to {CACHE_FILE}")
    else:
        print("All ASIN images are already cached!")

if __name__ == '__main__':
    main()
