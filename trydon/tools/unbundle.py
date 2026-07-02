#!/usr/bin/env python3
"""One-time bootstrap: unpack the handed-off Trydon-standalone.html bundle
into trydon/public/ (assets keep their UUID filenames so the template needs
no internal rewrites; only the <head> is augmented).

Usage: python3 tools/unbundle.py path/to/Trydon-standalone.html
"""
import json, gzip, base64, re, os, sys

EXT = {"font/woff2": ".woff2", "image/jpeg": ".jpg", "text/javascript": ".js"}

def grab(src, tag):
    m = re.search(r'<script type="__bundler/' + tag + r'">\s*(.*?)\s*</script>', src, re.S)
    return m.group(1)

def main(bundle_path):
    root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public")
    os.makedirs(root, exist_ok=True)
    src = open(bundle_path, encoding="utf-8").read()
    manifest = json.loads(grab(src, "manifest"))
    template = json.loads(grab(src, "template"))

    mime = {}
    runtime_uuid = None
    for k, v in manifest.items():
        raw = base64.b64decode(v["data"])
        if v.get("compressed"):
            raw = gzip.decompress(raw)
        # the dc runtime is the one script referenced from <head>
        if v["mime"] == "text/javascript" and f'<script src="{k}"' in template:
            runtime_uuid = k
            open(os.path.join(root, "dc-runtime.js"), "wb").write(raw)
            continue
        open(os.path.join(root, k), "wb").write(raw)
        mime[k] = v["mime"]
    json.dump(mime, open(os.path.join(root, "asset-mime.json"), "w"), indent=1)

    head_extra = (
        "<title>TRYDON — Command Deck</title>\n"
        '<meta name="theme-color" content="#0a0c11">\n'
        '<link rel="manifest" href="manifest.webmanifest">\n'
        '<link rel="icon" href="icon.svg" type="image/svg+xml">\n'
        '<link rel="apple-touch-icon" href="icon-192.png">\n'
        '<script src="trydon-bridge.js"></script>\n'
        f'<script src="dc-runtime.js"></script>'
    )
    template = template.replace(f'<script src="{runtime_uuid}"></script>', head_extra)
    open(os.path.join(root, "index.html"), "w", encoding="utf-8").write(template)
    print(f"unbundled {len(manifest)} assets; runtime={runtime_uuid}")

if __name__ == "__main__":
    main(sys.argv[1])
