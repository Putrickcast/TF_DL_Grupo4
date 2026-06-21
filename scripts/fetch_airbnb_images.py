"""Fetch public listing images referenced by canonical Airbnb pages.

This script follows the photo guidance from the assignment:
- use the canonical URL stored in the workbook-derived dataset;
- store files under public/img/<ID Airbnb>/;
- document the extraction method in public/data/image-manifest.json.

It only downloads image URLs already present in the public HTML returned by the
canonical page. It does not log in, click through hidden galleries, bypass
CAPTCHAs, or scrape private endpoints.
"""

from __future__ import annotations

import json
import re
import ssl
import time
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DATASET_JSON = ROOT / "public" / "data" / "listings.json"
OUTPUT_ROOT = ROOT / "public" / "img"
MANIFEST_JSON = ROOT / "public" / "data" / "image-manifest.json"
MAX_IMAGES_PER_LISTING = 3
REQUEST_DELAY_SECONDS = 0.35
USER_AGENT = "Mozilla/5.0 (compatible; academic-project-airbnb-photo-fetch/1.0)"


def fetch_bytes(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    # Local Windows certificate revocation checks fail in this environment.
    # The script still uses HTTPS endpoints; this only relaxes local cert validation.
    context = ssl._create_unverified_context()
    with urlopen(request, timeout=30, context=context) as response:
        return response.read()


def extract_listing_image_urls(html_text: str, listing_id: str, canonical_url: str) -> list[str]:
    """Return public listing photo URLs, excluding platform icons and host avatars."""

    candidates: list[str] = []
    patterns = [
        r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)',
        r'"picture_url"\s*:\s*"([^"]+)"',
        r'"baseUrl"\s*:\s*"(https://a0\.muscache\.com/[^"]+)"',
        r'(https://a0\.muscache\.com/im/pictures/[^"\\]+)',
    ]

    for pattern in patterns:
        for match in re.finditer(pattern, html_text):
            url = normalize_url(match.group(1))
            if is_public_airbnb_photo(url) and url not in candidates:
                candidates.append(url)

    room_id = room_id_from_url(canonical_url)
    strict_matches = [
        url
        for url in candidates
        if has_hosting_marker(url, listing_id) or (room_id and has_hosting_marker(url, room_id))
    ]

    # Older Airbnb pages sometimes expose public listing photos without a Hosting-<id>
    # marker. In that case the canonical page is still the source boundary, so use
    # the public a0.muscache.com image candidates from that page.
    return unique_photo_urls(strict_matches or candidates)


def room_id_from_url(url: str) -> str:
    match = re.search(r"/rooms/(\d+)", url)
    return match.group(1) if match else ""


def normalize_url(url: str) -> str:
    url = unescape(url)
    url = url.replace("\\u002F", "/").replace("\\/", "/")
    return url


def has_hosting_marker(url: str, listing_id: str) -> bool:
    return f"Hosting-{listing_id}" in url


def is_public_airbnb_photo(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.netloc != "a0.muscache.com":
        return False
    if "/im/pictures/" not in parsed.path:
        return False
    if "AirbnbPlatformAssets" in parsed.path:
        return False
    return True


def unique_photo_urls(urls: list[str]) -> list[str]:
    unique: list[str] = []
    seen_keys: set[str] = set()
    for url in urls:
        key = urlparse(url).path
        if key in seen_keys:
            continue
        seen_keys.add(key)
        unique.append(url)
    return unique


def extension_for(url: str, content_type: str | None) -> str:
    if content_type and "webp" in content_type:
        return ".webp"
    path = urlparse(url).path.lower()
    if path.endswith(".png"):
        return ".png"
    if path.endswith(".webp"):
        return ".webp"
    return ".jpg"


def download_image(url: str, out_path_without_ext: Path) -> Path:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    context = ssl._create_unverified_context()
    with urlopen(request, timeout=30, context=context) as response:
        content_type = response.headers.get("Content-Type", "")
        ext = extension_for(url, content_type)
        out_path = out_path_without_ext.with_suffix(ext)
        out_path.write_bytes(response.read())
    return out_path


def iter_listings(limit: int | None) -> Iterable[dict]:
    dataset = json.loads(DATASET_JSON.read_text(encoding="utf-8"))
    listings = dataset["listings"]
    return listings[:limit] if limit else listings


def main() -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, dict] = {
        "meta": {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "source": "Airbnb canonical public HTML + a0.muscache.com image URLs",
            "method": (
                "Fetch canonical page, extract public listing image URLs from HTML, "
                "save locally under public/img/<ID Airbnb>/."
            ),
            "maxImagesPerListing": MAX_IMAGES_PER_LISTING,
        },
        "listings": {},
    }

    total_downloaded = 0
    for listing in iter_listings(limit=None):
        listing_id = str(listing["id"])
        listing_dir = OUTPUT_ROOT / listing_id
        listing_dir.mkdir(parents=True, exist_ok=True)
        page_status = "ok"
        local_images: list[str] = []
        source_urls: list[str] = []

        try:
            html_bytes = fetch_bytes(listing["canonicalUrl"])
            urls = extract_listing_image_urls(
                html_bytes.decode("utf-8", errors="ignore"),
                listing_id,
                listing["canonicalUrl"],
            )
            source_urls = urls[:MAX_IMAGES_PER_LISTING]
            for index, image_url in enumerate(source_urls, start=1):
                out_path = download_image(image_url, listing_dir / f"photo-{index:02d}")
                local_images.append(out_path.relative_to(ROOT / "public").as_posix())
                total_downloaded += 1
                time.sleep(REQUEST_DELAY_SECONDS)
        except (HTTPError, URLError, TimeoutError, OSError) as error:
            page_status = f"error: {error}"

        manifest["listings"][listing_id] = {
            "title": listing["title"],
            "canonicalUrl": listing["canonicalUrl"],
            "status": page_status,
            "imageCount": len(local_images),
            "images": local_images,
            "sourceUrls": source_urls,
        }
        print(f"{listing_id}: {len(local_images)} images")
        time.sleep(REQUEST_DELAY_SECONDS)

    MANIFEST_JSON.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {MANIFEST_JSON}")
    print(f"Downloaded {total_downloaded} images")


if __name__ == "__main__":
    main()
