#!/usr/bin/env python3
"""mes-compat-proxy: bridge the Unified PDA's legacy contract to MES 122.

Off-factory test route for the `hotelDebug` build:

    device 127.0.0.1:8080 --(adb reverse)--> this proxy --(Tailscale)--> MES 122

MES 122 (ruijing-management-122, 100.116.166.118:8080) serves login/session at
/api/auth/login and /api/auth/session, while the shipped PDA ApiService calls
/auth/login and /auth/session. This proxy rewrites only those two paths and
passes everything else through untouched (including /health, which the app's
EndpointFailoverInterceptor probes).

Usage (workstation, with `tailscale` connected):
    python tools/mes-compat-proxy.py [--listen 8080] [--upstream http://100.116.166.118:8080]
Then, per device:
    adb -s <device> reverse tcp:8080 tcp:8080
"""
import argparse
import http.client
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

DEFAULT_UPSTREAM = "http://100.116.166.118:8080"
# Legacy PDA auth routes -> MES 122 auth routes.
AUTH_REWRITE = {"/auth/login": "/api/auth/login", "/auth/session": "/api/auth/session"}
HOP_BY_HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
              "te", "trailers", "transfer-encoding", "upgrade", "content-length"}
LOCK = threading.Lock()
UPSTREAM = urlsplit(DEFAULT_UPSTREAM)


class Proxy(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _proxy(self):
        parts = urlsplit(self.path)
        path = parts.path
        if path in AUTH_REWRITE:
            path = AUTH_REWRITE[path]
        path = path + (("?" + parts.query) if parts.query else "")
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        headers = {k: v for k, v in self.headers.items() if k.lower() not in HOP_BY_HOP}
        conn = http.client.HTTPConnection(UPSTREAM.hostname, UPSTREAM.port or 80, timeout=60)
        try:
            conn.request(self.command, path, body=body, headers=headers)
            resp = conn.getresponse()
            payload = resp.read()
        except Exception as e:  # upstream down -> clean 502, never a hung device
            self.send_error(502, f"mes-compat-proxy upstream error: {e}")
            return
        finally:
            conn.close()
        self.send_response(resp.status, resp.reason)
        for k, v in resp.getheaders():
            if k.lower() not in HOP_BY_HOP:
                self.send_header(k, v)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("X-Mes-Compat", "login/session rewritten to /api/auth/*")
        self.end_headers()
        self.wfile.write(payload)

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _proxy

    def log_message(self, fmt, *args):
        print(f"[mes-compat-proxy] {self.command} {self.path} <- {fmt % args}", flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--listen", type=int, default=8080)
    ap.add_argument("--upstream", default=DEFAULT_UPSTREAM)
    args = ap.parse_args()
    global UPSTREAM
    UPSTREAM = urlsplit(args.upstream)
    server = ThreadingHTTPServer(("0.0.0.0", args.listen), Proxy)
    print(f"[mes-compat-proxy] listening :{args.listen} -> {args.upstream} "
          f"(rewrites {list(AUTH_REWRITE.items())})", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
