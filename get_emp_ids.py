#!/usr/bin/env python3
"""Get real employee data from API using browser's token."""
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
    print(f"Token: {token[:30]}...")

    # Get real employees
    req = urllib.request.Request(
        "http://127.0.0.1:8080/api/hr/employees?limit=10",
        headers={"Authorization": f"Bearer {token}"}
    )
    resp = json.loads(urllib.request.urlopen(req).read())
    emps = resp.get("data", {}).get("items", [])
    print(f"\nReal employees from API: {len(emps)}")
    for e in emps[:5]:
        print(f"  id={e['id']} emp_no={e.get('employee_no','?')} name={e.get('name_zh','?')}")

    # Check QR images (whitelisted - no token needed)
    print("\nQR image checks:")
    for e in emps[:5]:
        eid = e["id"]
        try:
            req2 = urllib.request.urlopen(f"http://127.0.0.1:8080/api/hr/employees/{eid}/qr-image")
            sz = len(req2.read())
            print(f"  Emp {eid}: {sz} bytes ✅")
        except Exception as ex:
            print(f"  Emp {eid}: FAIL - {ex}")

    browser.close()
    print("\n=== DONE ===")