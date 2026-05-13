#!/usr/bin/env python3
"""Build a self-contained Pothi executable with PyInstaller.

The frozen binary embeds the app directory as data and reuses
app/pothi_launcher.py as the entrypoint.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
APP_DIR = ROOT / "app"
BUILD_DIR = ROOT / "build"
DIST_DIR = ROOT / "dist"
NAME = "Pothi" if os.name != "nt" else "Pothi"


def pyinstaller_runner() -> list[str] | None:
    try:
        subprocess.run(
            [sys.executable, "-m", "PyInstaller", "--version"],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return [sys.executable, "-m", "PyInstaller"]
    except Exception:
        exe = shutil.which("pyinstaller")
        if exe:
            return [exe]
    return None


def main() -> int:
    runner = pyinstaller_runner()
    if runner is None:
        print("PyInstaller is not installed. Install it first, then rerun this script.")
        return 1
    add_data = f"{APP_DIR}{os.pathsep}app"
    cmd = [
        *runner,
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name",
        NAME,
        "--distpath",
        str(DIST_DIR),
        "--workpath",
        str(BUILD_DIR),
        "--specpath",
        str(BUILD_DIR),
        "--add-data",
        add_data,
        str(APP_DIR / "pothi_launcher.py"),
    ]
    print("Running:", " ".join(cmd))
    return subprocess.call(cmd)


if __name__ == "__main__":
    raise SystemExit(main())
