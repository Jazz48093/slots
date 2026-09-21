import urllib.request
import re
import json
import csv
import io
import time
import os
import argparse
import concurrent.futures

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1EDMwxLBoYV_-4RXul07q4NiXGF6uxiDTaakn4Akhpoc/export?format=csv&gid=1705723818"
CACHE_FILE = os.path.join(BASE_DIR, "asin_cache.json")

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'en-IN,en-GB;q=0.9,en;q=0.8',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
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
                try:
                    imgs = json.loads(m1.group(1).replace('&quot;', '"'))
                    if imgs:
                        return asin, clean_image_url(list(imgs.keys())[0])
                except Exception:
                    pass

            # Method 2: colorImages initial block
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

            # Method 3: ImageBlockBTF / ImageBlockATF script data
            m3 = re.search(r'"hiRes":\s*"(https://m\.media-amazon\.com/images/I/[^"]+)"', html)
            if m3:
                return asin, clean_image_url(m3.group(1))

            m4 = re.search(r'"large":\s*"(https://m\.media-amazon\.com/images/I/[^"]+)"', html)
            if m4:
                return asin, clean_image_url(m4.group(1))

            # Method 4: any media-amazon product image URL pattern
            m5 = re.search(r'https://m\.media-amazon\.com/images/I/([a-zA-Z0-9_\-\+\%]+)\.(?:jpg|png)', html)
            if m5:
                return asin, clean_image_url(m5.group(0))

    except Exception as e:
        # Silently catch network / 404 / rate-limit errors
        pass

    return asin, None

def load_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def save_cache(cache):
    try:
        with open(CACHE_FILE, 'w', encoding='utf-8') as f:
            json.dump(cache, f, indent=2)
        return True
    except Exception as e:
        print(f"Error saving cache: {e}")
        return False

def get_sheet_asins():
    req = urllib.request.Request(SHEET_CSV_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=12) as resp:
        csv_text = resp.read().decode('utf-8', errors='ignore')
    reader = list(csv.reader(io.StringIO(csv_text)))
    asins = []
    for r in reader[1:]:
        if len(r) > 1 and r[1].strip():
            asin = r[1].strip()
            if asin not in asins:
                asins.append(asin)
    return asins

def refresh_all_images(force=False, max_workers=6, specific_asin=None):
    """
    Refreshes images from Amazon.
    If specific_asin is provided, only refreshes that ASIN.
    If force is True, re-fetches all ASINs from Amazon even if in cache.
    Otherwise, only fetches missing or empty entries.
    Returns dict: { "status": "success", "refreshed": count, "total": total, "updated": {asin: url} }
    """
    cache = load_cache()
    
    if specific_asin:
        asins_to_fetch = [specific_asin]
    else:
        sheet_asins = get_sheet_asins()
        if force:
            asins_to_fetch = sheet_asins
        else:
            asins_to_fetch = [a for a in sheet_asins if not cache.get(a)]

    if not asins_to_fetch:
        return {
            "status": "success",
            "message": "All images are up to date",
            "refreshed": 0,
            "total": len(cache),
            "updated": {}
        }

    updated = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_asin = {executor.submit(extract_image_for_asin, a): a for a in asins_to_fetch}
        for future in concurrent.futures.as_completed(future_to_asin):
            asin, img = future.result()
            if img:
                cache[asin] = img
                updated[asin] = img

    if updated:
        save_cache(cache)

    return {
        "status": "success",
        "message": f"Successfully refreshed {len(updated)} images from Amazon",
        "refreshed": len(updated),
        "total": len(cache),
        "updated": updated
    }

def main():
    parser = argparse.ArgumentParser(description="Refresh and fetch Amazon product images for UC 104 dashboard")
    parser.add_argument('-f', '--force', action='store_true', help="Force re-fetch all ASINs from Amazon")
    parser.add_argument('--asin', type=str, help="Fetch image for a single specific ASIN")
    parser.add_argument('-w', '--workers', type=int, default=6, help="Number of concurrent worker threads")
    args = parser.parse_args()

    print("==========================================")
    print(" Amazon Image Refresher - UC 104 Dashboard")
    print("==========================================")
    
    if args.asin:
        print(f"Fetching Amazon image for ASIN: {args.asin}...")
        asin, img = extract_image_for_asin(args.asin)
        if img:
            cache = load_cache()
            cache[asin] = img
            save_cache(cache)
            print(f"✓ Successfully cached {asin} -> {img}")
        else:
            print(f"✗ Failed to extract image for {args.asin}")
        return

    print(f"Mode: {'Full Force Refresh' if args.force else 'Missing-Only Refresh'}")
    res = refresh_all_images(force=args.force, max_workers=args.workers)
    print(res["message"])
    print(f"Total cached images: {res['total']}")

if __name__ == '__main__':
    main()
