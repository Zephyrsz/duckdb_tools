import importlib.util
from pathlib import Path
import socket
import sys

spec = importlib.util.spec_from_file_location("manage", Path(__file__).resolve().parents[1] / "scripts/manage.py")
manage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manage)


def test_manager_recognizes_and_stops_its_actual_python_process(tmp_path, monkeypatch):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    monkeypatch.setattr(manage, "RUN", tmp_path)
    program = tmp_path / "slow_shutdown.py"
    program.write_text(
        "import http.server,signal,time,sys\n"
        "signal.signal(signal.SIGTERM, lambda *_: (time.sleep(0.3), sys.exit(0)))\n"
        f"http.server.HTTPServer(('127.0.0.1', {port}), http.server.SimpleHTTPRequestHandler).serve_forever()\n"
    )
    monkeypatch.setitem(manage.SERVICES, "rds", (
        [sys.executable, str(program)],
        tmp_path, f"http://127.0.0.1:{port}",
    ))
    assert manage.start("rds")
    try:
        assert manage.owned_pid("rds") is not None
        manage.stop("rds")
        assert not manage.ready(f"http://127.0.0.1:{port}")
        assert manage.owned_pid("rds") is None
    finally:
        # Cleanup even if the recognition regression is still present.
        import json
        import os
        import signal
        pid = json.loads((tmp_path / "rds.json").read_text())["pid"]
        try:
            os.killpg(pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass
