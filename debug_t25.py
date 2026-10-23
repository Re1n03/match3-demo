import subprocess
import time
import http.server
import socketserver
import threading
import os

PORT = 8092
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)
    def log_message(self, format, *args):
        pass

httpd = socketserver.TCPServer(("", PORT), Quiet)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
time.sleep(0.5)

html_code = """
<!DOCTYPE html>
<html><body>
<div id="output"></div>
<script type="module">
import { Match3Engine } from './js/engine/Match3Engine.js';
import { Level62Config } from './js/levels/level62.js';

// 深拷贝 config 防止引用污染
function createFreshConfig() {
  const cfg = JSON.parse(JSON.stringify(Level62Config));
  cfg.customMechanics = { ...Level62Config.customMechanics };
  return cfg;
}

const engine = new Match3Engine({ ...createFreshConfig(), stepDelay: 0 });
const timeline = [];

engine.on('jarActive', () => timeline.push('ACTIVE'));
engine.on('jarLeap', (e) => timeline.push('LEAP: ' + JSON.stringify(e)));
engine.on('jarBurst', () => timeline.push('BURST'));
engine.on('targetsUpdated', () => timeline.push('TARGET'));
engine.on('victory', () => timeline.push('VICTORY'));

await engine.trySwap({ row: 1, col: 4 }, { row: 2, col: 4 });
timeline.push('charge after s1: ' + engine.customMechanics.jarCharge);
await engine.trySwap({ row: 0, col: 3 }, { row: 0, col: 4 });
timeline.push('charge after s2: ' + engine.customMechanics.jarCharge);
await engine.trySwap({ row: 1, col: 2 }, { row: 1, col: 3 });
timeline.push('charge after s3: ' + engine.customMechanics.jarCharge);

document.getElementById('output').innerText = timeline.join('\\n');
document.body.dataset.done = 'true';
</script>
</body></html>
"""

with open(os.path.join(DIRECTORY, "debug_t25.html"), "w", encoding="utf-8") as f:
    f.write(html_code)

edge_path = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
cmd = [
    edge_path,
    "--headless=new",
    "--disable-gpu",
    "--wait-for-selector=body[data-done='true']",
    "--dump-dom",
    f"http://localhost:{PORT}/debug_t25.html"
]

proc = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='ignore')
print(proc.stdout)
httpd.shutdown()
os.remove(os.path.join(DIRECTORY, "debug_t25.html"))
