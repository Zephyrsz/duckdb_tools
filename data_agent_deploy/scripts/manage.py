"""Start and stop only this deployment's local processes."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.request import urlopen

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
RUN = ROOT / ".run"
RUN.mkdir(exist_ok=True)
PORT = int(os.getenv("PORT", "8787"))
RDS_PORT = int(os.getenv("RDS_API_PORT", "8766"))
SERVICES = {
    "rds": ([str(ROOT / ".venv/bin/python"), "-m", "rds_api"], ROOT, f"http://127.0.0.1:{RDS_PORT}/health"),
    "api": (["node", str(ROOT / "openmuse/dist/apps/server/src/index.js")], ROOT / "openmuse", f"http://127.0.0.1:{PORT}/api/health"),
    "web": ([str(ROOT / ".venv/bin/python"), "-m", "http.server", "8081", "--bind", "127.0.0.1", "--directory", str(ROOT / "openmuse/apps/mobile/dist/web")], ROOT, "http://127.0.0.1:8081"),
}


def process_identity(pid):
    try:
        value = subprocess.check_output(["ps", "-p", str(pid), "-o", "state=", "-o", "lstart=", "-o", "command="], text=True).strip()
        return None if value.startswith("Z") else value
    except subprocess.CalledProcessError:
        return None


def owned_pid(name):
    file = RUN / f"{name}.json"
    if not file.exists():
        return None
    state = json.loads(file.read_text())
    pid = int(state["pid"])
    # macOS resolves a venv executable to the framework Python path in ps output.
    # Compare the recorded start time and actual command, which also rejects recycled PIDs.
    identity = process_identity(pid)
    if not identity or identity != state.get("identity"):
        return None
    return pid


def ready(url):
    try:
        with urlopen(url, timeout=1) as response:
            return response.status == 200
    except (URLError, TimeoutError, OSError):
        return False


def missing_chat_config():
    missing = []
    if not os.getenv("CPK_INTELLIGENCE_API_KEY", "").strip():
        missing.append("CPK_INTELLIGENCE_API_KEY")
    model = os.getenv("MODEL", "").strip()
    if not model:
        missing.append("MODEL")
    else:
        provider = model.split("/", 1)[0].split(":", 1)[0].lower()
        key = {"openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY", "google": "GOOGLE_API_KEY", "gemini": "GOOGLE_API_KEY"}.get(provider)
        if key and not os.getenv(key, "").strip():
            missing.append(key)
    return missing


def start(name):
    command, cwd, url = SERVICES[name]
    pid = owned_pid(name)
    if pid:
        print(f"{name}: already running (PID {pid}) at {url}")
        return True
    if name == "api":
        missing = missing_chat_config()
        if missing:
            print(f"api: not started; configure {', '.join(missing)} in {ROOT / '.env'}")
            return False
        if not (ROOT / "openmuse/dist/apps/server/src/index.js").exists():
            print("api: build first: cd openmuse && corepack pnpm build:server")
            return False
    if name == "web" and not (ROOT / "openmuse/apps/mobile/dist/web/index.html").exists():
        print("web: build first: cd openmuse && corepack pnpm build:web")
        return False
    if ready(url):
        print(f"{name}: {url} is already in use by an unmanaged service; leaving it unchanged")
        return False
    log = RUN / f"{name}.log"
    with log.open("a") as output:
        process = subprocess.Popen(command, cwd=cwd, env=os.environ.copy(), stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
    identity = process_identity(process.pid)
    (RUN / f"{name}.json").write_text(json.dumps({"pid": process.pid, "identity": identity}))
    for _ in range(80):
        if process.poll() is not None:
            print(f"{name}: exited; inspect {log}")
            return False
        if ready(url):
            # Capture after Python's exec into the macOS framework executable has settled.
            (RUN / f"{name}.json").write_text(json.dumps({"pid": process.pid, "identity": process_identity(process.pid)}))
            print(f"{name}: ready at {url} (PID {process.pid})")
            return True
        time.sleep(0.25)
    print(f"{name}: still starting; inspect {log}")
    return False


def stop(name):
    pid = owned_pid(name)
    if pid:
        os.killpg(pid, signal.SIGTERM)
        print(f"{name}: sent SIGTERM to PID {pid}")
        for _ in range(100):
            if owned_pid(name) is None:
                return
            time.sleep(0.1)
        raise RuntimeError(f"{name} is still shutting down; inspect its log before restarting")
    else:
        print(f"{name}: no managed process running")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["start", "stop", "status"])
    parser.add_argument("service", nargs="?", default="all", choices=["all", *SERVICES])
    args = parser.parse_args()
    names = list(SERVICES) if args.service == "all" else [args.service]
    if args.action == "stop":
        for name in reversed(names):
            stop(name)
    elif args.action == "status":
        for name in names:
            print(f"{name}: {'running' if owned_pid(name) else 'not running'}; health={'ok' if ready(SERVICES[name][2]) else 'unavailable'}")
    else:
        results = [start(name) for name in names]
        sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
