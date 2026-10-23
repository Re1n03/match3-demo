#!/usr/bin/env python3
"""
run_all.py - 一键验收：单元/机制回归 + 真实浏览器 E2E + Lv62 关卡约束求解器

用法：
    python tests/run_all.py
可选：
    设置环境变量 NODE_BIN 指向 node 可执行文件（未安装 node 时求解器会跳过并提示）
"""

import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def run_step(title, cmd, env=None, timeout=300):
    print("\n" + "=" * 64)
    print(f"▶ {title}")
    print("=" * 64)
    proc = subprocess.run(
        cmd,
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        env=env,
    )
    if proc.stdout:
        print(proc.stdout, end="" if proc.stdout.endswith("\n") else "\n")
    if proc.returncode != 0 and proc.stderr:
        print(proc.stderr)
    print(f"—— {title}: {'PASS' if proc.returncode == 0 else 'FAIL'} (exit {proc.returncode})")
    return proc.returncode == 0


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

    child_env = dict(os.environ)
    child_env["PYTHONIOENCODING"] = "utf-8"

    results = []

    # 1. 单元/机制回归（浏览器 headless，run_tests.py 内含 32 项断言 + DOM 渲染核验）
    results.append(("单元/机制回归", run_step(
        "单元/机制回归 (run_tests.py)",
        [sys.executable, "run_tests.py"],
        env=child_env,
    )))

    # 2. 真实浏览器 E2E
    results.append(("E2E 验收", run_step(
        "真实浏览器 E2E (tests/run_e2e.py)",
        [sys.executable, os.path.join("tests", "run_e2e.py")],
        env=child_env,
    )))

    # 3. Lv62 8x8 约束求解器 + 模拟器确定性（需要 Node；缺失时跳过）
    node_bin = os.environ.get("NODE_BIN") or shutil.which("node")
    if node_bin and os.path.exists(node_bin):
        results.append(("Lv62 求解器", run_step(
            "Lv62 8x8 约束求解器 (tests/solve_lv62.mjs)",
            [node_bin, os.path.join("tests", "solve_lv62.mjs")],
            env=child_env,
        )))
        results.append(("模拟器确定性", run_step(
            "模拟器确定性 (tests/sim/test_determinism.mjs)",
            [node_bin, os.path.join("tests", "sim", "test_determinism.mjs")],
            env=child_env,
        )))
        results.append(("Lv64 greedy 评分", run_step(
            "Lv64 greedy 评分 (tests/sim/test_lv64_greedy.mjs)",
            [node_bin, os.path.join("tests", "sim", "test_lv64_greedy.mjs")],
            env=child_env,
        )))
    else:
        print("\n[跳过] 未找到 node（可通过 NODE_BIN 指定），跳过求解器与模拟器确定性测试。")

    print("\n" + "=" * 64)
    print("验收汇总")
    print("=" * 64)
    all_pass = True
    for name, passed in results:
        print(f"  [{'PASS' if passed else 'FAIL'}] {name}")
        if not passed:
            all_pass = False
    print("=" * 64)
    print("[SUCCESS] 全部验收通过。" if all_pass else "[FAILED] 存在未通过项。")
    sys.exit(0 if all_pass else 1)


if __name__ == "__main__":
    main()
