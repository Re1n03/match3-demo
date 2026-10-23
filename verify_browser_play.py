import subprocess
import time
import http.server
import socketserver
import threading
import os
import re

PORT = 8094
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)
    def log_message(self, format, *args):
        pass

httpd = socketserver.TCPServer(("", PORT), Quiet)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
time.sleep(0.5)

browser_test_html = """<!DOCTYPE html>
<html><body>
<div id="log"></div>
<script type="module">
import { Match3Engine } from './js/engine/Match3Engine.js';
import { BoardRenderer } from './js/ui/BoardRenderer.js';
import { AudioManager } from './js/ui/AudioManager.js';
import { Level62Config } from './js/levels/level62.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = [];
function addLog(msg) { 
  log.push(msg); 
  document.getElementById('log').innerHTML = log.join("<br>");
}

async function run() {
  try {
    const audio = new AudioManager();
    const engine = new Match3Engine(Level62Config);
    const boardEl = document.createElement('div');
    boardEl.id = 'board-grid';
    document.body.appendChild(boardEl);

    const modal = document.createElement('div');
    modal.id = 'game-over-modal';
    modal.className = 'modal-overlay hidden';
    modal.innerHTML = '<div id="modal-title"></div><div id="modal-desc"></div><button id="modal-restart-btn">Restart</button>';
    document.body.appendChild(modal);

    const renderer = new BoardRenderer(boardEl, engine, audio);
    renderer.buildBoard();

    addLog("Init: moves=" + engine.movesRemaining + ", jarPos=(" + engine.customMechanics.jarPos.row + "," + engine.customMechanics.jarPos.col + ")");

    // 1. 执行 Step 1: (1,4) <-> (2,4)
    await renderer.handleCellClick(1, 4);
    await renderer.handleCellClick(2, 4);
    await sleep(400);
    addLog("Step 1 done: moves=" + engine.movesRemaining + ", jarCharge=" + engine.customMechanics.jarCharge);

    // 2. 执行 Step 2: (0,3) <-> (0,4)
    await renderer.handleCellClick(0, 3);
    await renderer.handleCellClick(0, 4);
    await sleep(400);
    addLog("Step 2 done: moves=" + engine.movesRemaining + ", jarCharge=" + engine.customMechanics.jarCharge);

    // 3. 执行 Step 3: (1,2) <-> (1,3)
    let seenLeap = false;
    let seenBurst = false;
    engine.on('jarLeap', (e) => {
      seenLeap = true;
      addLog("Event jarLeap: from=(" + e.from.row + "," + e.from.col + ") to=(" + e.to.row + "," + e.to.col + ")");
    });
    engine.on('jarBurst', (e) => {
      seenBurst = true;
      addLog("Event jarBurst: pos=(" + e.pos.row + "," + e.pos.col + ") blastCells=" + e.blastCells.length);
    });

    await renderer.handleCellClick(1, 2);
    await renderer.handleCellClick(1, 3);

    // 检查刚爆破时 modal 是否仍被延迟隐藏 (留出腾跃与十字爆破视觉呈现窗口)
    await sleep(300);
    const modalHiddenDuringBurst = modal.classList.contains('hidden');
    addLog("During animation: modalHidden=" + modalHiddenDuringBurst + " (clean board view preserved)");

    // 等待全部结算完成 (包含 550ms 胜利弹窗延迟)
    await sleep(1500);

    const modalHiddenAfterAnimation = modal.classList.contains('hidden');
    addLog("After 1.5s: modalIsVisible=" + (!modalHiddenAfterAnimation) + ", finalJarPos=(" + engine.customMechanics.jarPos.row + "," + engine.customMechanics.jarPos.col + "), state=" + engine.state);
    addLog("Animation verification: seenLeap=" + seenLeap + ", seenBurst=" + seenBurst);

    // 4. 测试重置
    engine.reset();
    renderer.buildBoard();
    addLog("After Reset: moves=" + engine.movesRemaining + ", jarCharge=" + engine.customMechanics.jarCharge + ", jarPos=(" + engine.customMechanics.jarPos.row + "," + engine.customMechanics.jarPos.col + "), state=" + engine.state);

  } catch (err) {
    addLog("ERROR: " + err.message + "\\n" + err.stack);
  }
}
run();
</script>
</body></html>
"""

test_file = os.path.join(DIRECTORY, "browser_verify.html")
with open(test_file, "w", encoding="utf-8") as f:
    f.write(browser_test_html)

edge_path = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
cmd = [
    edge_path,
    "--headless=new",
    "--disable-gpu",
    "--virtual-time-budget=6000",
    "--dump-dom",
    f"http://localhost:{PORT}/browser_verify.html"
]

proc = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='ignore')
print("=== 真实浏览器交互执行日志 ===")
m = re.search(r'<div id="log">([\s\S]*?)</div>', proc.stdout)
if m:
    print(m.group(1).replace("<br>", "\n"))
else:
    print("LOG NOT FOUND. stdout:")
    print(proc.stdout[:500])

httpd.shutdown()
if os.path.exists(test_file):
    os.remove(test_file)
