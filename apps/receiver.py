"""
HTTP 文件接收器 — 监听本地端口，保存上传的文件
用法：python receiver.py [端口] [保存目录]
默认：端口 8080，保存到 ./uploads
"""

import http.server
import os
import sys
import socketserver
import threading
from urllib.parse import unquote

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
SAVE_DIR = sys.argv[2] if len(sys.argv) > 2 else "./uploads"

os.makedirs(SAVE_DIR, exist_ok=True)


class UploadHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        if not self.path.startswith("/upload/"):
            self.send_error(404, "Not Found")
            return

        filename = unquote(self.path[len("/upload/"):])
        # 防止路径穿越
        filename = filename.replace("..", "").lstrip("/")
        filepath = os.path.join(SAVE_DIR, filename)
        dir_path = os.path.dirname(filepath)
        if dir_path:
            os.makedirs(dir_path, exist_ok=True)

        length = int(self.headers.get("Content-Length", 0))
        received = 0
        chunks = []

        # 分块接收大文件
        while received < length:
            chunk = self.rfile.read(min(65536, length - received))
            if not chunk:
                break
            chunks.append(chunk)
            received += len(chunk)

        data = b"".join(chunks)

        try:
            with open(filepath, "wb") as f:
                f.write(data)
            size_mb = len(data) / 1024 / 1024
            print(f"✅  [{self.address_string()}] {filename}  →  {filepath}  ({size_mb:.2f} MB)")
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"OK")
        except Exception as e:
            print(f"❌ 保存失败: {e}")
            self.send_error(500, str(e))
        return

    def do_GET(self):
        if self.path == "/status":
            files = []
            total_size = 0
            for root, dirs, filenames in os.walk(SAVE_DIR):
                for fn in filenames:
                    fp = os.path.join(root, fn)
                    sz = os.path.getsize(fp)
                    total_size += sz
                    rel = os.path.relpath(fp, SAVE_DIR)
                    files.append({"file": rel, "size": sz})
            import json
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"total": len(files), "size_mb": round(total_size / 1024 / 1024, 2), "files": files}).encode())
            return
        self.send_error(404, "Only /upload/* and /status are supported")

    def log_message(self, format, *args):
        # 只打印非上传的请求
        if "/upload/" not in args[0]:
            print(f"  {args[0]}")

    def address_string(self):
        return f"{self.client_address[0]}:{self.client_address[1]}"


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    """支持多线程并发上传"""
    allow_reuse_address = True


print("=" * 50)
print(f"  📡 文件接收器")
print(f"  监听端口: {PORT}")
print(f"  保存目录: {os.path.abspath(SAVE_DIR)}")
print(f"  上传地址: http://127.0.0.1:{PORT}/upload/文件名")
print(f"  状态查询: http://127.0.0.1:{PORT}/status")
print("=" * 50)

server = ThreadedHTTPServer(("0.0.0.0", PORT), UploadHandler)
server.serve_forever()
