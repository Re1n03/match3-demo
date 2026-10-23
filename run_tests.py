#!/usr/bin/env python3
"""
run_tests.py - 项目通用核心引擎与机制自动化回归测试入口 (含界面渲染核验)
基于 Headless 浏览器环境真实执行 tests/test_suite.js，提取真实测试结果。
"""

import subprocess
import time
import http.server
import socketserver
import threading
import sys
import os
import re

PORT = 8099
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)
    def log_message(self, format, *args):
        pass

def main():
    httpd = socketserver.TCPServer(("", PORT), QuietHandler)
    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()
    time.sleep(0.5)

    edge_path = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    if not os.path.exists(edge_path):
        print(f"[ERROR] 未找到浏览器可执行文件: {edge_path}")
        sys.exit(1)

    # 1. 运行自动化测试控制台 test.html (等待全部测试异步结算完成)
    cmd_test = [
        edge_path,
        "--headless=new",
        "--disable-gpu",
        "--wait-for-selector=body[data-test-done='true']",
        "--dump-dom",
        f"http://localhost:{PORT}/test.html"
    ]
    proc_test = subprocess.run(cmd_test, capture_output=True, text=True, encoding='utf-8', errors='ignore')
    html_test = proc_test.stdout

    # 2. 检查主界面 index.html 渲染情况
    cmd_index = [
        edge_path,
        "--headless=new",
        "--disable-gpu",
        "--virtual-time-budget=3000",
        "--dump-dom",
        f"http://localhost:{PORT}/index.html"
    ]
    proc_index = subprocess.run(cmd_index, capture_output=True, text=True, encoding='utf-8', errors='ignore')
    html_index = proc_index.stdout

    httpd.shutdown()

    summary_match = re.search(r'<span class="stat-badge[^"]*" id="summary-text">([^<]+)</span>', html_test)
    duration_match = re.search(r'<div[^>]*id="duration-text">([^<]+)</div>', html_test)

    print("==========================================================")
    print("三消通用核心引擎 · 真实自动化测试执行报告 (审计强化版)")
    print("==========================================================")
    if summary_match:
        print("【测试汇总】:", summary_match.group(1))
    if duration_match:
        print("【执行耗时】:", duration_match.group(1))

    rows = re.findall(r'<tr>\s*<td[^>]*>(#[0-9]+)</td>\s*<td><span class="([^"]+)">([^<]+)</span></td>\s*<td[^>]*>([^<]+)</td>\s*<td[^>]*>([^<]+)</td>\s*</tr>', html_test)

    print(f"\n【详细断言列表 (共 {len(rows)} 项)】:")
    for num, tag_class, status, name, detail in rows:
        print(f"{num:4} [{status:4}] {name} -> {detail}")
    print("----------------------------------------------------------")

    # 检查主页面 DOM 渲染（行列数从渲染结果 data-rows/data-cols 读取，不硬编码 81/9x9）
    board_tag_match = re.search(r'<div[^>]*id="board-grid"[^>]*>', html_index)
    board_tag = board_tag_match.group(0) if board_tag_match else ''
    rows_match = re.search(r'data-rows="(\d+)"', board_tag)
    cols_match = re.search(r'data-cols="(\d+)"', board_tag)
    if not rows_match or not cols_match:
        print("[FAILED] index.html 未暴露 board-grid 的 data-rows/data-cols，无法核验棋盘尺寸。")
        sys.exit(1)
    board_rows = int(rows_match.group(1))
    board_cols = int(cols_match.group(1))
    expected_cells = board_rows * board_cols
    cell_count = html_index.count('class="board-cell')
    tile_count = html_index.count('class="tile ')
    print(f"【界面 DOM 渲染核验】: 关卡配置 {board_rows}x{board_cols}，"
          f"index.html 生成 {cell_count} 个格子、{tile_count} 颗棋子。")
    print("==========================================================")

    fail_count = sum(1 for r in rows if r[2] == 'FAIL')
    if fail_count > 0 or cell_count != expected_cells or tile_count != expected_cells:
        print(f"[FAILED] 存在断言失败，或界面渲染不符合 {board_rows}x{board_cols} 规格！")
        sys.exit(1)
    else:
        print(f"[SUCCESS] 全项断言真实通过，界面渲染符合 {board_rows}x{board_cols} 规格！")

if __name__ == '__main__':
    main()
