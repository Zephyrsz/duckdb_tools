from __future__ import annotations

import os
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterator

import duckdb


class DuckDBNotConnectedError(RuntimeError):
    """Raised when an operation needs DuckDB while the workbench is disconnected."""


class DuckDBBusyError(RuntimeError):
    """Raised when disconnect is requested while a database operation is active."""


class _ConnectionLease:
    """Compatibility wrapper for callers that historically called connect_db().close()."""

    def __init__(self, manager: DuckDBConnectionManager, connection: duckdb.DuckDBPyConnection):
        self._manager = manager
        self._connection = connection
        self._released = False

    def __getattr__(self, name: str):
        return getattr(self._connection, name)

    def close(self) -> None:
        if not self._released:
            self._released = True
            self._manager._release_operation()


class DuckDBConnectionManager:
    """Own the workbench's shared DuckDB connection and its lifecycle."""

    def __init__(self, path_provider: Callable[[], Path]):
        self._path_provider = path_provider
        self._state_lock = threading.RLock()
        self._operation_lock = threading.Lock()
        self._connection: duckdb.DuckDBPyConnection | None = None
        self._path: Path | None = None
        self._connected_at: datetime | None = None
        self._active_operations = 0
        self._manually_disconnected = False

    @staticmethod
    def auto_connect_enabled() -> bool:
        value = os.environ.get("DUCKDB_AUTO_CONNECT", "true").strip().lower()
        return value not in {"0", "false", "no", "off"}

    def configure(self, path: Path) -> None:
        path = Path(path)
        with self._state_lock:
            if self._path == path:
                return
            if self._active_operations:
                raise DuckDBBusyError("无法切换 DuckDB：当前有操作正在运行")
            if self._connection is not None:
                self._connection.close()
            self._connection = None
            self._connected_at = None
            self._path = path
            self._manually_disconnected = False

    def _ensure_configured(self) -> Path:
        path = Path(self._path_provider())
        self.configure(path)
        return path

    def connect(self) -> dict[str, object]:
        with self._state_lock:
            path = self._ensure_configured()
            if self._connection is None:
                path.parent.mkdir(parents=True, exist_ok=True)
                self._connection = duckdb.connect(str(path))
                self._connected_at = datetime.now(timezone.utc)
            self._manually_disconnected = False
            return self.status()

    def disconnect(self) -> dict[str, object]:
        with self._state_lock:
            self._ensure_configured()
            active_operations = self._active_operations
        # Never wait for the operation lock while holding state_lock. An operation
        # releases this lock before updating its state, so holding both can deadlock.
        if not self._operation_lock.acquire(blocking=False):
            raise DuckDBBusyError(f"无法断开 DuckDB：有 {active_operations} 个操作正在运行")
        try:
            with self._state_lock:
                if self._active_operations:
                    raise DuckDBBusyError(f"无法断开 DuckDB：有 {self._active_operations} 个操作正在运行")
                if self._connection is not None:
                    self._connection.close()
                    self._connection = None
                    self._connected_at = None
                self._manually_disconnected = True
                return self.status()
        finally:
            self._operation_lock.release()

    def status(self) -> dict[str, object]:
        with self._state_lock:
            path = self._ensure_configured()
            return {
                "connected": self._connection is not None,
                "database": str(path),
                "connected_at": self._connected_at.isoformat() if self._connected_at else None,
                "active_operations": self._active_operations,
                "auto_connect": self.auto_connect_enabled(),
            }

    def initialize(self) -> None:
        """Prepare the configured path and establish the default connection once."""
        with self._state_lock:
            self._ensure_configured()
            if self._connection is None and not self._manually_disconnected and self.auto_connect_enabled():
                self.connect()

    def _begin_operation(self) -> duckdb.DuckDBPyConnection:
        with self._state_lock:
            self._ensure_configured()
            if self._connection is None:
                raise DuckDBNotConnectedError("DuckDB 未连接，请先点击连接")
            self._active_operations += 1
            connection = self._connection
        try:
            self._operation_lock.acquire()
        except BaseException:
            with self._state_lock:
                self._active_operations = max(0, self._active_operations - 1)
            raise
        return connection

    def _release_operation(self) -> None:
        with self._state_lock:
            self._active_operations = max(0, self._active_operations - 1)
        self._operation_lock.release()

    @contextmanager
    def operation(self) -> Iterator[duckdb.DuckDBPyConnection]:
        connection = self._begin_operation()
        try:
            yield connection
        finally:
            self._release_operation()

    def lease(self) -> _ConnectionLease:
        connection = self._begin_operation()
        return _ConnectionLease(self, connection)
