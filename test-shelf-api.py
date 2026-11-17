"""Smart Rack API Test Script"""
import urllib.request
import json

API = "http://127.0.0.1:8080"

def get(path):
    try:
        req = urllib.request.urlopen(f"{API}{path}", timeout=8)
        data = json.loads(req.read())
        return req.status, data
    except Exception as e:
        return 0, {"error": str(e)}

def post(path, body):
    try:
        req = urllib.request.urlopen(
            urllib.request.Request(f"{API}{path}", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST"),
            timeout=8
        )
        data = json.loads(req.read())
        return req.status, data
    except Exception as e:
        return 0, {"error": str(e)}

tests = [
    ("GET", "/api/shelf/cells", None),
    ("GET", "/api/shelf/cells/L001A", None),
    ("GET", "/api/shelf/cells/L001B", None),
    ("GET", "/api/shelf/cells/L002A", None),
    ("GET", "/api/shelf/cells/L002B", None),
    ("GET", "/api/shelf/labels", None),
    ("GET", "/api/shelf/labels?ShelfCode=L002A", None),
    ("GET", "/api/shelf/summary", None),
    ("GET", "/api/shelf/racks", None),
    ("GET", "/api/wms/shelf/status", None),
    ("POST", "/api/shelf/LightOnAllEmptyLocationGY", {"shelfCode": "L001A", "color": 1}),
    ("POST", "/api/shelf/LightOnAllEmptyLocationGY", {"shelfCode": "L001A", "color": 0}),
    ("POST", "/api/shelf/ShelfInGY", {"shelfCode": "L001A", "labelId": "TEST-BATCH-001"}),
    ("POST", "/api/shelf/ShelfOutGY", {"labelIdListJson": '["TEST-BATCH-001"]'}),
    ("POST", "/api/shelf/InventoryRemoveLableGY", {"labelId": "TEST-BATCH-001"}),
]

ok = ng = 0
for method, path, body in tests:
    if method == "GET":
        code, data = get(path)
    else:
        code, data = post(path, body)

    result = data.get("Result", "") or data.get("result", "")
    if result == "OK":
        ok += 1
        icon = "✅"
    elif result == "NG":
        ng += 1
        icon = "❌"
    elif code and code != 200:
        ng += 1
        icon = "⚠️"
    else:
        ok += 1
        icon = "✅"

    if method == "GET" and "items" in data.get("data", {}):
        total = data["data"].get("total", len(data["data"]["items"]))
        extra = f" ({total} items)"
    elif method == "GET" and "shelves" in data.get("data", {}):
        shelves = data["data"]["shelves"]
        extra = " | " + ", ".join(f"{s['code']}:{s['totalCells']}cells/{s['occupiedCells']}occ" for s in shelves)
    elif method == "GET" and "racks" in data.get("data", {}):
        racks = data["data"]["racks"]
        extra = " | " + ", ".join(f"{r['code']}({len(r['sides'])}sides)" for r in racks)
    else:
        extra = ""

    msg = data.get("Message", "")
    print(f"{icon} {method:4s} {path:<50s} HTTP:{code} | Result:{result or 'N/A'} | {msg[:60]}{extra}")

print(f"\n✅ OK: {ok}  ❌ NG: {ng}  Total: {ok+ng}/15")
