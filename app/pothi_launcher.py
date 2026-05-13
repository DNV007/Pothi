#!/usr/bin/env python3
"""Cross-platform Pothi launcher and local HTTP server.

This module owns the single launcher flow used by Linux, macOS, and
Windows wrappers. It starts and stops the local server, keeps a pidfile
in temp, and serves the app directory from this package.
"""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import tempfile
import re
import time
import urllib.error
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


BUILD_ID = os.environ.get("POTHI_BUILD", "20260513-docx-format")
if getattr(sys, "frozen", False):
    MEIPASS = Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
    APP_DIR = MEIPASS / "app"
else:
    APP_DIR = Path(__file__).resolve().parent
USER = os.environ.get("USER") or os.environ.get("USERNAME") or "pothi"
PORT = int(os.environ.get("POTHI_PORT", "8765"))
URL = f"http://127.0.0.1:{PORT}/"
PIDFILE = Path(tempfile.gettempdir()) / f"pothi.{USER}.pid"
BUILD_RE = re.compile(r'<meta\s+name="pothi-build"\s+content="([^"]+)"', re.I)


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        try:
            out = subprocess.check_output(
                ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                text=True,
                stderr=subprocess.DEVNULL,
            ).strip()
        except Exception:
            return False
        return str(pid) in out
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def read_pid() -> int | None:
    try:
        return int(PIDFILE.read_text().strip())
    except Exception:
        return None


def cleanup_stale_pid() -> None:
    pid = read_pid()
    if pid is not None and not pid_alive(pid):
        try:
            PIDFILE.unlink()
        except FileNotFoundError:
            pass


def server_is_pothi(url: str | None = None) -> bool:
    target = url or URL
    try:
        with urllib.request.urlopen(target, timeout=1) as resp:
            html = resp.read(65536).decode("utf-8", "ignore")
    except Exception:
        return False
    return "Pothi" in html and "js/app.js" in html


def server_build(url: str | None = None) -> str | None:
    target = url or URL
    try:
        with urllib.request.urlopen(target, timeout=1) as resp:
            html = resp.read(65536).decode("utf-8", "ignore")
    except Exception:
        return None
    match = BUILD_RE.search(html)
    return match.group(1) if match else None


def port_pids(port: int) -> list[int]:
    if os.name == "nt":
        try:
            out = subprocess.check_output(
                ["netstat", "-ano"],
                text=True,
                stderr=subprocess.DEVNULL,
            )
        except Exception:
            return []
        pids: set[int] = set()
        for line in out.splitlines():
            if f":{port} " not in line or "LISTENING" not in line.upper():
                continue
            parts = line.split()
            if not parts:
                continue
            pid = parts[-1]
            if pid.isdigit():
                pids.add(int(pid))
        return sorted(pids)

    for cmd in (["lsof", "-ti", f"tcp:{port}"], ["fuser", "-n", "tcp", str(port)]):
        try:
            out = subprocess.check_output(cmd, text=True, stderr=subprocess.DEVNULL)
        except Exception:
            continue
        pids = {int(token) for token in re.findall(r"\d+", out)}
        if pids:
            return sorted(pids)
    return []


def kill_port_occupants(port: int) -> None:
    for pid in port_pids(port):
        if pid_alive(pid):
            _terminate_pid(pid)


def reclaim_stale_servers() -> None:
    seen: set[int] = set()
    for port in (8766, PORT):
        if port in seen:
            continue
        seen.add(port)
        url = f"http://127.0.0.1:{port}/"
        build = server_build(url)
        if port == PORT and build == BUILD_ID:
            continue
        if server_is_pothi(url):
            kill_port_occupants(port)
            time.sleep(0.2)


def open_url(url: str | None = None) -> None:
    target = url or URL
    try:
        webbrowser.open(target, new=2, autoraise=True)
    except Exception:
        print(f"Open your browser to: {target}")


def launcher_command(*args: str) -> list[str]:
    if getattr(sys, "frozen", False):
        return [sys.executable, *args]
    return [sys.executable, str(Path(__file__).resolve()), *args]


def serve(port: int = PORT) -> int:
    os.chdir(APP_DIR)

    class Handler(SimpleHTTPRequestHandler):
        def log_message(self, format: str, *args) -> None:  # noqa: A003
            return

    class Server(ThreadingHTTPServer):
        allow_reuse_address = True

    httpd = Server(("127.0.0.1", port), Handler)
    try:
        print(f"Pothi serving at http://127.0.0.1:{port}/")
        httpd.serve_forever()
    except KeyboardInterrupt:
        return 0
    finally:
        httpd.server_close()
    return 0


def start() -> int:
    cleanup_stale_pid()
    reclaim_stale_servers()
    pid = read_pid()
    if pid is not None and pid_alive(pid) and server_is_pothi():
        print(f"Pothi already running at {URL}")
        open_url()
        return 0

    if pid is not None and not pid_alive(pid):
        try:
            PIDFILE.unlink()
        except FileNotFoundError:
            pass

    if server_is_pothi():
        current_build = server_build()
        if current_build == BUILD_ID:
            print(f"Pothi already running at {URL}")
            open_url()
            return 0
        kill_port_occupants(PORT)
        time.sleep(0.2)

    popen_kwargs = {
        "cwd": str(APP_DIR),
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "stdin": subprocess.DEVNULL,
    }
    if os.name == "nt":
        popen_kwargs["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        popen_kwargs["start_new_session"] = True
    proc = subprocess.Popen(
        launcher_command("serve", "--port", str(PORT)),
        **popen_kwargs,
    )
    PIDFILE.write_text(str(proc.pid))

    deadline = time.time() + 2.0
    while time.time() < deadline:
        if not pid_alive(proc.pid):
            break
        if server_is_pothi():
            print(f"Pothi started at {URL}")
            open_url()
            return 0
        time.sleep(0.1)

    if pid_alive(proc.pid):
        _terminate_pid(proc.pid)
    try:
        PIDFILE.unlink()
    except FileNotFoundError:
        pass
    print(f"Could not start Pothi on {URL}")
    print("That port is probably already occupied.")
    return 1


def _terminate_pid(pid: int) -> None:
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass


def stop() -> int:
    cleanup_stale_pid()
    pid = read_pid()
    if pid is None or not pid_alive(pid):
        if server_is_pothi():
            kill_port_occupants(PORT)
            try:
                PIDFILE.unlink()
            except FileNotFoundError:
                pass
            print("Pothi stopped.")
            return 0
        try:
            PIDFILE.unlink()
        except FileNotFoundError:
            pass
        print("Pothi is not running.")
        return 0
    if not server_is_pothi():
        try:
            PIDFILE.unlink()
        except FileNotFoundError:
            pass
        print("Pothi is not running.")
        return 0

    _terminate_pid(pid)
    try:
        PIDFILE.unlink()
    except FileNotFoundError:
        pass
    print("Pothi stopped.")
    return 0


def status() -> int:
    cleanup_stale_pid()
    pid = read_pid()
    if pid is not None and pid_alive(pid) and server_is_pothi():
        print(f"Running at {URL}  (pid {pid})")
    elif server_is_pothi():
        print(f"Running at {URL}  (pid unknown)")
    else:
        print("Not running.")
    return 0


def open_existing() -> int:
    cleanup_stale_pid()
    pid = read_pid()
    if (pid is not None and pid_alive(pid) and server_is_pothi()) or server_is_pothi():
        open_url()
        return 0
    print("Not running. Run: pothi start")
    return 1


def main(argv: list[str] | None = None) -> int:
    global PORT, URL
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("command", nargs="?", default="start")
    parser.add_argument("--port", dest="port", type=int, default=PORT)
    args, _ = parser.parse_known_args(argv)
    PORT = int(args.port)
    URL = f"http://127.0.0.1:{PORT}/"

    cmd = args.command
    if cmd == "serve":
        return serve(PORT)
    if cmd == "start":
        return start()
    if cmd == "stop":
        return stop()
    if cmd == "status":
        return status()
    if cmd == "open":
        return open_existing()

    print(
        "pothi — local-first reference manager launcher\n"
        "Usage:\n"
        "  pothi            start (default) — start server + open browser\n"
        "  pothi start      same as above\n"
        "  pothi open       open browser to a running server\n"
        "  pothi stop       stop the server\n"
        "  pothi status     show running state\n"
        "  pothi serve      serve the app directory (internal)\n"
        "Environment:\n"
        f"  POTHI_PORT       port to bind on 127.0.0.1 (default {PORT})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
