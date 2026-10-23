#!/usr/bin/env python3
"""
run_e2e.py - 真实浏览器端到端验收（输入锁 / 再次挑战 / 切关 / 失败路径 / 横幅 / 禁用按钮）

用法：python tests/run_e2e.py
依赖：本机 Microsoft Edge（与 run_tests.py 相同的 headless 方案），不引入第三方依赖。
"""

import http.server
import json
import os
import re
import socketserver
import subprocess
import sys
import threading
import time

PORT = 8101
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, format, *args):
        pass


def find_edge():
    candidates = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return None


def main():
    # Windows 控制台默认 GBK，强制 UTF-8 输出，避免中文/emoji 结果打印崩溃
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    edge = find_edge()
    if not edge:
        print("[ERROR] 未找到 Microsoft Edge，无法执行 e2e。")
        sys.exit(2)

    httpd = socketserver.TCPServer(("127.0.0.1", PORT), QuietHandler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(0.4)

    url = f"http://127.0.0.1:{PORT}/tests/e2e.html?e2e=1"
    cmd = [
        edge,
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--window-size=1200,1500",
        "--virtual-time-budget=90000",
        "--dump-dom",
        url,
    ]

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                              errors="ignore", timeout=180)
    finally:
        httpd.shutdown()

    dom = proc.stdout or ""
    done = 'data-e2e-done="true"' in dom
    match = re.search(r'<pre id="e2e-json">([\s\S]*?)</pre>', dom)

    print("=" * 62)
    print("Lv62 输入锁 / 横幅 / 关卡切换 · 真实浏览器 E2E")
    print("=" * 62)

    if not done or not match:
        print("[FAILED] e2e 页面未在预算内完成，未获取到结果。")
        print(f"  done={done}, dom_length={len(dom)}")
        sys.exit(1)

    payload = json.loads(match.group(1))
    for item in payload["results"]:
        status = "PASS" if item["pass"] else "FAIL"
        detail = f" -> {item['detail']}" if item.get("detail") else ""
        print(f"[{status:4}] {item['name']}{detail}")

    print("-" * 62)
    print(f"共 {len(payload['results'])} 项：{payload['passCount']} PASS / {payload['failCount']} FAIL")

    if payload["failCount"] > 0:
        print("[FAILED] 存在 e2e 失败项。")
        sys.exit(1)

    print("[SUCCESS] E2E 全部通过（真实浏览器点击验证）。")
    sys.exit(0)


if __name__ == "__main__":
    main()
