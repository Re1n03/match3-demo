import subprocess
import time
import http.server
import socketserver
import threading
import os

PORT = 8095
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)
    def log_message(self, format, *args):
        pass

httpd = socketserver.TCPServer(("", PORT), Quiet)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
time.sleep(0.5)

edge_path = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
# 让 Edge 打开 test.html 并抓取 console 或写个测试
cmd = [
    edge_path,
    "--headless=new",
    "--disable-gpu",
    "--dump-dom",
    f"http://localhost:{PORT}/test.html"
]

proc = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='ignore')
httpd.shutdown()
