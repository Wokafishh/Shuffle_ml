import sys
import json
import argparse
import threading
import webbrowser
import http.server
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("name", nargs="?", default=None)
    args = parser.parse_args()

    name = args.name
    if not name:
        name = input("Enter clip name (e.g., test): ").strip()
    if not name:
        print("Error: No name entered. Exiting.")
        return

    port = args.port

    video_path    = ROOT / "data" / "raw_videos"  / f"{name}.mp4"
    beats_path    = ROOT / "data" / "beats_out"   / f"{name}_beats.json"
    skeleton_path = ROOT / "data" / "skelett_out" / f"{name}_skelett.json"

    missing = [p for p in [video_path, beats_path, skeleton_path] if not p.exists()]
    if missing:
        print("\nWarning: Missing files for this clip:")
        for p in missing:
            print(f"  {p}")
        print("Attempting to load anyway...\n")

    shutdown_event = threading.Event()

    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            # ── Variabelanalys-API ─────────────────────────────────
            if self.path.startswith("/api/variables/"):
                clip = urllib.parse.unquote(self.path[len("/api/variables/"):])
                self._serve_variables(clip)
                return

            # ── Shutdown ───────────────────────────────────────────
            if self.path == "/shutdown":
                self.send_response(200)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b"ok")
                shutdown_event.set()
                return

            # ── Ping (keepalive) ───────────────────────────────────
            if self.path == "/ping":
                self.send_response(200)
                self.end_headers()
                return

            super().do_GET()

        def _serve_variables(self, clip: str):
            result_path = ROOT / "data" / "variabel_out" / f"{clip}_variabler.json"
            if not result_path.exists():
                err = json.dumps({"error": "No variable data found for this clip"}).encode()
                self.send_response(404)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(err)
                return

            payload = result_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(payload)

    try:
        server = http.server.HTTPServer(("localhost", port), Handler)
    except OSError:
        print(f"Error: Could not start server on port {port}. Is it already in use?")
        return

    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    url = (
        f"http://localhost:{port}/program/skelett_display/index.html"
        f"?name={urllib.parse.quote(name)}"
    )
    print(f"Serving '{name}' at: {url}")
    print("Close the browser tab to stop the server.\n")
    webbrowser.open(url)

    shutdown_event.wait()
    print("Browser closed — stopping server...")
    server.shutdown()


if __name__ == "__main__":
    main()