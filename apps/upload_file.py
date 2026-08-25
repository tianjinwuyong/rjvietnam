"""
HTTP 文件上传工具 — IP 可配置
用法:
  python upload_file.py
  python upload_file.py http://192.168.1.100:8080
  python upload_file.py http://192.168.1.100:8080 C:/Users/tianj/Desktop/report.xlsx
"""

import urllib.request
import sys

# ── 可配置 ────────────────────────────────────────────────────────────────────
DEFAULT_HOST = "http://127.0.0.1:8080"   # 改成目标服务器 IP:PORT
DEFAULT_FILE = ""                        # 默认空，启动后交互式输入
# ──────────────────────────────────────────────────────────────────────────────


def upload(url: str, filepath: str) -> bool:
    filename = filepath.split("/")[-1].split("\\")[-1]
    print(f"上传文件: {filename}")
    print(f"目标地址: {url}/upload/{filename}")

    try:
        with open(filepath, "rb") as f:
            data = f.read()
    except FileNotFoundError:
        print(f"❌ 文件不存在: {filepath}")
        return False
    except Exception as e:
        print(f"❌ 读取文件失败: {e}")
        return False

    req = urllib.request.Request(
        f"{url}/upload/{filename}",
        data=data,
        headers={"Content-Type": "application/octet-stream"},
        method="POST",
    )

    try:
        resp = urllib.request.urlopen(req, timeout=60)
        result = resp.read().decode(errors="replace")
        print(f"✅ {resp.status} — {result}")
        return True
    except urllib.error.HTTPError as e:
        print(f"❌ HTTP {e.code} — {e.reason}")
        try:
            print(f"   Body: {e.read().decode(errors='replace')}")
        except:
            pass
        return False
    except urllib.error.URLError as e:
        print(f"❌ 连接失败: {e.reason}")
        return False
    except Exception as e:
        print(f"❌ 未知错误: {e}")
        return False


def interactive():
    print("=" * 50)
    print("  HTTP 文件上传工具")
    print("=" * 50)
    host = input(f"服务器地址 [默认 {DEFAULT_HOST}]: ").strip()
    host = host or DEFAULT_HOST

    if not host.startswith("http"):
        host = "http://" + host

    filepath = input(f"文件路径 [直接回车交互式选择]: ").strip()
    if not filepath:
        filepath = input("请输入完整文件路径: ").strip()

    print()
    upload(host, filepath)


if __name__ == "__main__":
    if len(sys.argv) >= 2:
        host = sys.argv[1]
        if not host.startswith("http"):
            host = "http://" + host
    else:
        host = input(f"服务器地址 [默认 {DEFAULT_HOST}]: ").strip() or DEFAULT_HOST

    if len(sys.argv) >= 3:
        filepath = sys.argv[2]
    elif DEFAULT_FILE:
        filepath = DEFAULT_FILE
    else:
        filepath = input("文件路径: ").strip()

    if not filepath:
        print("❌ 未指定文件路径")
        sys.exit(1)

    success = upload(host, filepath)
    sys.exit(0 if success else 1)
