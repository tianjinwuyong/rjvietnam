import json
import os
import queue
import socket
import threading
import time
from datetime import datetime, timezone

import pyautogui
import requests
from pywinauto import Desktop


MES = "http://127.0.0.1:8080"
PROGRESS = r"C:\Temp\auto_line_100_progress.jsonl"
BASE_COMPLETED = int(os.environ.get("AUTO_LINE_BASE_COMPLETED", "5"))
ADDITIONAL_BOARDS = int(os.environ.get("AUTO_LINE_REMAINING", "95"))
ui_lock = threading.Lock()
fct_queue = queue.Queue()
depanel_queue = queue.Queue()
known_lock = threading.Lock()


def log(**entry):
    entry["at"] = datetime.now(timezone.utc).isoformat()
    with open(PROGRESS, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    print(json.dumps(entry, ensure_ascii=False), flush=True)


def motherboards():
    response = requests.get(
        f"{MES}/api/station/confirmed-motherboards?line=auto&limit=5000",
        timeout=20,
    )
    response.raise_for_status()
    return response.json().get("items", [])


def bring_station(ip):
    escaped_ip = ip.replace(".", r"\.")
    windows = Desktop(backend="win32").windows(title_re=rf"{escaped_ip}.*")
    if not windows:
        raise RuntimeError(f"RDP {ip} is not open")
    # .51 has one stale white RDP connection and one live connection. The live
    # connection is the most recently enumerated matching window.
    window = windows[-1] if ip == "192.168.6.51" else max(
        windows,
        key=lambda item: item.rectangle().width() * item.rectangle().height(),
    )
    window.restore()
    window.move_window(x=0, y=0, width=1920, height=1080, repaint=True)
    window.set_focus()
    time.sleep(2)


def wait_for_new_ict(known_ids, timeout=45):
    deadline = time.time() + timeout
    while time.time() < deadline:
        rows = motherboards()
        new_rows = [row for row in rows if row.get("motherboardId") not in known_ids]
        complete = [
            row for row in new_rows
            if len(row.get("members") or []) == 6 and row.get("motherboardId")
        ]
        if complete:
            return max(complete, key=lambda row: row.get("updatedAt") or "")
        time.sleep(2)
    raise TimeoutError("ICT motherboard did not reach MES")


def wait_for_fct(motherboard_id, timeout=55):
    deadline = time.time() + timeout
    while time.time() < deadline:
        match = next(
            (row for row in motherboards()
             if row.get("motherboardId") == motherboard_id),
            None,
        )
        if match and match.get("fctBatchId"):
            return match
        time.sleep(2)
    raise TimeoutError(f"FCT result missing for {motherboard_id}")


def depanel_scan(sn):
    with socket.create_connection(("192.168.6.53", 1003), timeout=5) as stream:
        stream.sendall((sn + "\r\n").encode("ascii"))


def wait_for_depanel(sn, timeout=25):
    deadline = time.time() + timeout
    while time.time() < deadline:
        response = requests.get(
            f"{MES}/api/station/auto-line-sn-history",
            params={"sn": sn, "limit": 100},
            timeout=15,
        )
        response.raise_for_status()
        if any(
            row.get("stationCode") == "auto_depanel"
            for row in response.json().get("items", [])
        ):
            return
        time.sleep(2)
    raise TimeoutError(f"depanel scan missing for {sn}")


def main():
    known_ids = {
        row.get("motherboardId") for row in motherboards()
        if row.get("motherboardId")
    }
    log(state="STARTED", target=ADDITIONAL_BOARDS, baseline=len(known_ids))

    def ict_worker():
        produced = 0
        while produced < ADDITIONAL_BOARDS:
            cycle = produced + BASE_COMPLETED + 1
            try:
                with ui_lock:
                    bring_station("192.168.6.51")
                    pyautogui.click(296, 301)
                with known_lock:
                    snapshot = set(known_ids)
                ict = wait_for_new_ict(snapshot)
                motherboard_id = ict["motherboardId"]
                with known_lock:
                    if motherboard_id in known_ids:
                        time.sleep(1)
                        continue
                    known_ids.add(motherboard_id)
                members = sorted(
                    ict["members"], key=lambda item: int(item.get("slot") or 0)
                )
                daughter_sn = members[0]["sn"]
                fct_queue.put((cycle, motherboard_id, daughter_sn))
                produced += 1
                log(
                    state="ICT_DONE",
                    cycle=cycle,
                    motherboardId=motherboard_id,
                    daughterSn=daughter_sn,
                )
                time.sleep(2)
            except Exception as error:
                log(state="ICT_RETRY", cycle=cycle, error=str(error))
                time.sleep(2)
        fct_queue.put(None)

    def fct_worker():
        while True:
            item = fct_queue.get()
            if item is None:
                depanel_queue.put(None)
                return
            cycle, motherboard_id, daughter_sn = item
            try:
                with ui_lock:
                    bring_station("192.168.6.52")
                    pyautogui.click(400, 162)
                    pyautogui.hotkey("ctrl", "a")
                    pyautogui.write(daughter_sn, interval=0.03)
                    pyautogui.click(1440, 162)
                    time.sleep(2)
                    pyautogui.click(638, 114)
                merged = wait_for_fct(motherboard_id)
                depanel_queue.put(item)
                log(
                    state="FCT_DONE",
                    cycle=cycle,
                    motherboardId=motherboard_id,
                    fctBatchId=merged.get("fctBatchId"),
                )
                time.sleep(2)
            except Exception as error:
                log(state="FCT_RETRY", cycle=cycle, error=str(error))
                fct_queue.put(item)
                time.sleep(2)

    def depanel_worker():
        completed = 0
        while True:
            item = depanel_queue.get()
            if item is None:
                log(state="COMPLETE", completed=completed + BASE_COMPLETED)
                return
            cycle, motherboard_id, daughter_sn = item
            try:
                depanel_scan(daughter_sn)
                wait_for_depanel(daughter_sn)
                completed += 1
                log(
                    state="BOARD_DONE",
                    cycle=cycle,
                    completed=completed + BASE_COMPLETED,
                    motherboardId=motherboard_id,
                    daughterSn=daughter_sn,
                )
                time.sleep(2)
            except Exception as error:
                log(state="DEPANEL_RETRY", cycle=cycle, error=str(error))
                depanel_queue.put(item)
                time.sleep(2)

    workers = [
        threading.Thread(target=ict_worker, name="ict", daemon=False),
        threading.Thread(target=fct_worker, name="fct", daemon=False),
        threading.Thread(target=depanel_worker, name="depanel", daemon=False),
    ]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join()


if __name__ == "__main__":
    main()
