#!/usr/bin/env python3
"""ForgeOptima AI - Local Ollama Bridge Companion.

Provides zero-dependency browser-to-Ollama CORS bridging for Local AI mode.
Standard library only: Python 3.8+ required. No pip install needed.

Usage:
    python scripts/forgeoptima-bridge.py
    # Bridge listens on http://localhost:11435 and forwards to http://localhost:11434
"""
import http.server
import json
import sys
import urllib.error
import urllib.request

PORT = 11435
OLLAMA_BASE = "http://localhost:11434"


class OllamaBridgeHandler(http.server.BaseHTTPRequestHandler):
    def _set_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Session-ID")

    def do_OPTIONS(self):
        self.send_response(204)
        self._set_cors()
        self.end_headers()

    def do_DELETE(self):
        length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(length) if length > 0 else None
        target = f"{OLLAMA_BASE}{self.path}"
        try:
            req = urllib.request.Request(
                target,
                data=post_data,
                headers={"Content-Type": "application/json"},
                method="DELETE"
            )
            with urllib.request.urlopen(req, timeout=30) as res:
                body = res.read()
                self.send_response(res.status)
                self._set_cors()
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self._set_cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(e.read())
        except Exception as e:
            self.send_response(502)
            self._set_cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self._set_cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"ok","bridge":"forgeoptima-local"}')
            return

        target = f"{OLLAMA_BASE}{self.path}"
        try:
            req = urllib.request.Request(target)
            with urllib.request.urlopen(req, timeout=5) as res:
                body = res.read()
                self.send_response(res.status)
                self._set_cors()
                self.send_header("Content-Type", res.headers.get("Content-Type", "application/json"))
                self.end_headers()
                self.wfile.write(body)
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self._set_cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(e.read())
        except Exception as e:
            self.send_response(502)
            self._set_cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            err_json = json.dumps({"error": f"Cannot reach Ollama at {OLLAMA_BASE}: {e}"})
            self.wfile.write(err_json.encode())

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(length) if length > 0 else None
        target = f"{OLLAMA_BASE}{self.path}"
        try:
            req = urllib.request.Request(
                target,
                data=post_data,
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=180) as res:
                self.send_response(res.status)
                self._set_cors()
                self.send_header("Content-Type", res.headers.get("Content-Type", "application/json"))
                self.end_headers()
                while True:
                    chunk = res.read(512)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self._set_cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(e.read())
        except Exception as e:
            self.send_response(502)
            self._set_cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            err_json = json.dumps({"error": f"Ollama execution error: {e}"})
            self.wfile.write(err_json.encode())

    def log_message(self, format, *args):
        if len(args) > 1 and str(args[1]).startswith(("4", "5")):
            super().log_message(format, *args)


def main():
    print("=" * 60)
    print("  FORGEOPTIMA AI - Local Ollama Bridge Companion")
    print("=" * 60)
    print(f"  Target: {OLLAMA_BASE}")
    print(f"  Listening on: http://localhost:{PORT}")
    print("  Status: Ready for browser connection with full CORS support.")
    print("  Press Ctrl+C to stop.")
    print("=" * 60)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), OllamaBridgeHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping bridge companion.")
        sys.exit(0)


if __name__ == "__main__":
    main()
