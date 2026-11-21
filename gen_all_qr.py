#!/usr/bin/env python3
"""Generate QR codes for all employees via browser token."""
from playwright.sync_api import sync_playwright
import urllib.request, json

CHROME_PATH = r"C:\Users\tianj\AppData\Local\ms-playwright\chromium-1228\chrome-win64\chrome.exe"
BASE_URL = "http://127.0.0.1:5178"

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME_PATH, headless=True, args=["--no-sandbox"])
    page = browser.new_page(viewport={"width": 1600, "height": 900})

    page.goto(BASE_URL)
    page.evaluate("() => { sessionStorage.clear(); localStorage.clear(); }")
    page.close()
    page = browser.new_page(viewport={"width": 1600, "height": 900})

    # Login
    page.goto(BASE_URL, wait_until="networkidle", timeout=30000)
    page.wait_for_timeout(1000)
    page.fill("input[placeholder='用户名']", "ADMIN_VN_01")
    page.fill("input[placeholder='密码']", "Factory@123")
    page.click("button[type='submit']")
    page.wait_for_timeout(6000)

    token = page.evaluate("() => sessionStorage.getItem('auth_token')")
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # Get all employees
    req = urllib.request.Request(
        "http://127.0.0.1:8080/api/hr/employees?limit=50",
        headers=headers
    )
    emps = json.loads(urllib.request.urlopen(req).read()).get("data", {}).get("items", [])
    print(f"Total employees: {len(emps)}")

    # Generate QR for each
    ok, fail = 0, 0
    for e in emps:
        eid = e["id"]
        data = json.dumps({}).encode()
        req2 = urllib.request.Request(
            f"http://127.0.0.1:8080/api/hr/employees/{eid}/qr-code",
            data=data, headers={"Content-Type": "application/json"}
        )
        try:
            json.loads(urllib.request.urlopen(req2).read())
            print(f"  Emp {eid} ({e.get('name_zh','?')}): OK")
            ok += 1
        except Exception as ex:
            print(f"  Emp {eid}: FAIL - {ex}")
            fail += 1

    print(f"\nGenerated {ok}/{len(emps)} QR codes, {fail} failed")

    # Verify hasActiveQr
    print("\nVerifying hasActiveQr for all:")
    for e in emps:
        eid = e["id"]
        req3 = urllib.request.Request(
            f"http://127.0.0.1:8080/api/hr/employees/{eid}/qr-code",
            headers={"Content-Type": "application/json"}
        )
        try:
            r3 = json.loads(urllib.request.urlopen(req3).read())
            d = r3.get("data", {})
            print(f"  Emp {eid}: hasActiveQr={d.get('hasActiveQr')} expires={str(d.get('expiresAt',''))[:10]}")
        except Exception as ex:
            print(f"  Emp {eid}: {ex}")

    browser.close()
    print("\n=== DONE ===")