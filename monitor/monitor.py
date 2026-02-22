from __future__ import annotations

import argparse
import base64
import glob
import json
import os
import socket
import sqlite3
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable

from _version import __version__
from classify_file import classify_file
from db_config import ensure_database_directory


DEFAULT_FILE_TYPES = ".pdf,.tiff,.tif"
DEFAULT_GEMINI_MODEL = "gemini-flash-latest"
DEFAULT_SCAN_INTERVAL_SECONDS = 600
DEFAULT_STABLE_CHECK_COUNT = 3
DEFAULT_STABLE_CHECK_INTERVAL_SECONDS = 1.0
DEFAULT_STABLE_TIMEOUT_SECONDS = 120
DEFAULT_RETRY_MAX = 3
DEFAULT_MONITOR_EVENT_NOTIFY_ENABLED = True
DEFAULT_MONITOR_EVENT_NOTIFY_TIMEOUT_SECONDS = 3.0
DEFAULT_MONITOR_EVENT_NOTIFY_PATH = "/api/internal/documents-inserted"
DEFAULT_THUMBNAIL_ENABLED = False
DEFAULT_THUMBNAIL_SIZE = 250
DEFAULT_MONITOR_GEMINI_PROGRESS_INTERVAL_SECONDS = 60


def load_env_file() -> None:
    root = Path(__file__).resolve().parent.parent
    env_path = root / ".env"
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if not text or text.startswith("#") or "=" not in text:
            continue
        key, value = text.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def parse_file_types() -> set[str]:
    raw = os.getenv("MONITOR_FILE_TYPES", DEFAULT_FILE_TYPES)
    values = [item.strip().lower() for item in raw.split(",") if item.strip()]
    normalized = set()
    for value in values:
        normalized.add(value if value.startswith(".") else f".{value}")
    return normalized or {".pdf", ".tiff", ".tif"}


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def get_retry_max() -> int:
    raw = os.getenv("MONITOR_RETRY_MAX", str(DEFAULT_RETRY_MAX)).strip()
    try:
        value = int(raw)
        return max(0, value)
    except ValueError:
        return DEFAULT_RETRY_MAX


def parse_env_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    text = value.strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    return default


def parse_env_float(value: str | None, default: float) -> float:
    if value is None:
        return default
    try:
        return float(value.strip())
    except ValueError:
        return default


def parse_env_int(value: str | None, default: int) -> int:
    if value is None:
        return default
    try:
        return int(value.strip())
    except ValueError:
        return default


def _is_self_url(url: str) -> bool:
    """Return True if the URL's host resolves to a local address of this machine."""
    try:
        from urllib.parse import urlparse

        parsed = urlparse(url)
        hostname = parsed.hostname or ""
        if not hostname:
            return False
        # Always local for loopback names/addresses
        if hostname in {"localhost", "127.0.0.1", "::1"}:
            return True
        # Resolve hostname and compare against all local interface addresses
        try:
            remote_addrs = {info[4][0] for info in socket.getaddrinfo(hostname, None)}
        except OSError:
            return False
        try:
            local_addrs = {addr for _, addr in socket.getaddrinfo(socket.gethostname(), None)}
            local_addrs |= {
                info[4][0]
                for info in socket.getaddrinfo(socket.getfqdn(), None)
            }
        except OSError:
            local_addrs = set()
        # Include all addresses bound to network interfaces via socket
        return bool(remote_addrs & local_addrs)
    except Exception:  # noqa: BLE001
        return False


def resolve_monitor_event_notify_url() -> str:
    configured = os.getenv("MONITOR_EVENT_NOTIFY_URL", "").strip()
    if configured:
        return configured

    is_https = parse_env_bool(os.getenv("API_HTTPS"), default=False)
    scheme = "https" if is_https else "http"
    host = os.getenv("API_HOST", "127.0.0.1").strip() or "127.0.0.1"
    if host in {"0.0.0.0", "::", "[::]"}:
        host = "127.0.0.1"

    port_raw = os.getenv("API_PORT", "3001").strip() or "3001"
    try:
        port = int(port_raw)
    except ValueError:
        port = 3001

    return f"{scheme}://{host}:{port}{DEFAULT_MONITOR_EVENT_NOTIFY_PATH}"


def print_startup_environment(args: argparse.Namespace, db_path: Path, file_types: set[str]) -> None:
    mode = "help"
    if args.as_service:
        mode = "service"
    elif args.scan:
        mode = "scan"
    elif args.scandir:
        mode = "scandir"
    elif args.prompt:
        mode = "prompt"
    elif args.list_documentclass:
        mode = "list-documentclass"

    monitor_dirs: list[str] = []
    if args.dir:
        monitor_dirs.append(str(Path(args.dir)))
    else:
        env_main_dir = os.getenv("MONITOR_DIR", "").strip()
        if env_main_dir:
            monitor_dirs.append(env_main_dir)
        index = 1
        while True:
            key = f"MONITOR_DIR_{index}"
            value = os.getenv(key, "").strip()
            if not value:
                break
            monitor_dirs.append(value)
            index += 1

    print("[monitor] startup configuration:", file=sys.stderr)
    print(f"[monitor] mode={mode}", file=sys.stderr)
    print(f"[monitor] db_path={db_path}", file=sys.stderr)
    print(f"[monitor] APP_ENV={os.getenv('APP_ENV', '')}", file=sys.stderr)
    print(f"[monitor] DATABASE_PATH={os.getenv('DATABASE_PATH', '')}", file=sys.stderr)
    print(f"[monitor] DATABASE_URL={os.getenv('DATABASE_URL', '')}", file=sys.stderr)
    print(f"[monitor] GEMINI_API_MODEL={os.getenv('GEMINI_API_MODEL', '')}", file=sys.stderr)
    print(f"[monitor] GEMINI_GENNERATION_TEMPERATURE={os.getenv('GEMINI_GENNERATION_TEMPERATURE', '')}", file=sys.stderr)
    gemini_progress_interval_seconds = max(
        5,
        parse_env_int(
            os.getenv("MONITOR_GEMINI_PROGRESS_INTERVAL_SECONDS"),
            DEFAULT_MONITOR_GEMINI_PROGRESS_INTERVAL_SECONDS,
        ),
    )
    print(
        f"[monitor] MONITOR_GEMINI_PROGRESS_INTERVAL_SECONDS={gemini_progress_interval_seconds}",
        file=sys.stderr,
    )
    print(f"[monitor] MONITOR_FILE_TYPES={','.join(sorted(file_types))}", file=sys.stderr)
    print(f"[monitor] MONITOR_RETRY_MAX={get_retry_max()}", file=sys.stderr)
    thumbnail_enabled = parse_env_bool(os.getenv("THUMBNAIL"), default=DEFAULT_THUMBNAIL_ENABLED)
    thumbnail_size = max(64, parse_env_int(os.getenv("THUMBNAIL_SIZE"), DEFAULT_THUMBNAIL_SIZE))
    print(f"[monitor] THUMBNAIL={thumbnail_enabled}", file=sys.stderr)
    print(f"[monitor] THUMBNAIL_SIZE={thumbnail_size}", file=sys.stderr)
    notify_enabled = parse_env_bool(
        os.getenv("MONITOR_EVENT_NOTIFY_ENABLED"), default=DEFAULT_MONITOR_EVENT_NOTIFY_ENABLED
    )
    print(f"[monitor] MONITOR_EVENT_NOTIFY_ENABLED={notify_enabled}", file=sys.stderr)
    print(f"[monitor] MONITOR_EVENT_NOTIFY_URL={resolve_monitor_event_notify_url()}", file=sys.stderr)
    print(
        f"[monitor] MONITOR_EVENT_NOTIFY_TIMEOUT_SECONDS={parse_env_float(os.getenv('MONITOR_EVENT_NOTIFY_TIMEOUT_SECONDS'), DEFAULT_MONITOR_EVENT_NOTIFY_TIMEOUT_SECONDS)}",
        file=sys.stderr,
    )
    print(f"[monitor] MONITOR_DIRS={monitor_dirs}", file=sys.stderr)


def wait_file_stable(file_path: Path) -> bool:
    stable_check_count = int(os.getenv("MONITOR_STABLE_CHECK_COUNT", str(DEFAULT_STABLE_CHECK_COUNT)))
    stable_check_interval = float(
        os.getenv("MONITOR_STABLE_CHECK_INTERVAL_SECONDS", str(DEFAULT_STABLE_CHECK_INTERVAL_SECONDS))
    )
    timeout_seconds = float(os.getenv("MONITOR_STABLE_TIMEOUT_SECONDS", str(DEFAULT_STABLE_TIMEOUT_SECONDS)))

    start = time.time()
    unchanged_count = 0
    previous_size = -1

    while time.time() - start < timeout_seconds:
        if not file_path.exists() or not file_path.is_file():
            time.sleep(stable_check_interval)
            continue

        try:
            current_size = file_path.stat().st_size
            with file_path.open("rb"):
                pass
        except OSError:
            time.sleep(stable_check_interval)
            continue

        if current_size == previous_size:
            unchanged_count += 1
        else:
            unchanged_count = 0
            previous_size = current_size

        if unchanged_count >= stable_check_count:
            return True

        time.sleep(stable_check_interval)

    return False


class MonitorService:
    def __init__(self, db_path: Path, file_types: set[str]):
        self.db_path = db_path
        self.file_types = file_types
        self.gemini_progress_interval_seconds = max(
            5,
            parse_env_int(
                os.getenv("MONITOR_GEMINI_PROGRESS_INTERVAL_SECONDS"),
                DEFAULT_MONITOR_GEMINI_PROGRESS_INTERVAL_SECONDS,
            ),
        )
        self.thumbnail_enabled = parse_env_bool(os.getenv("THUMBNAIL"), default=DEFAULT_THUMBNAIL_ENABLED)
        self.thumbnail_size = max(64, parse_env_int(os.getenv("THUMBNAIL_SIZE"), DEFAULT_THUMBNAIL_SIZE))
        self.event_notify_enabled = parse_env_bool(
            os.getenv("MONITOR_EVENT_NOTIFY_ENABLED"), default=DEFAULT_MONITOR_EVENT_NOTIFY_ENABLED
        )
        self.event_notify_url = resolve_monitor_event_notify_url()
        self.event_notify_token = os.getenv("MONITOR_EVENT_NOTIFY_TOKEN", "").strip()
        self.event_notify_timeout_seconds = parse_env_float(
            os.getenv("MONITOR_EVENT_NOTIFY_TIMEOUT_SECONDS"), DEFAULT_MONITOR_EVENT_NOTIFY_TIMEOUT_SECONDS
        )
        self.processing_lock = threading.Lock()
        self.stop_event = threading.Event()
        self.new_entry_event = threading.Event()  # enqueue_file() が Queue 挙入したときにセット
        self.worker_thread: threading.Thread | None = None
        self.queue_retry_thread: threading.Thread | None = None

    def classify_file_with_timeout(self, target: Path, prompt_text: str) -> dict:
        result_holder: list[dict] = []
        error_holder: list[BaseException] = []

        def classify_worker() -> None:
            try:
                result_holder.append(classify_file(target, prompt_text))
            except BaseException as exc:  # noqa: BLE001
                error_holder.append(exc)

        worker = threading.Thread(target=classify_worker, daemon=True)
        worker.start()

        started_at = time.time()
        next_progress_at = started_at + self.gemini_progress_interval_seconds

        while worker.is_alive():
            now = time.time()
            elapsed = now - started_at

            if now >= next_progress_at:
                print(
                    "[monitor][gemini] waiting response: "
                    f"file={target.name} elapsed={elapsed:.2f}s"
                )
                next_progress_at = now + self.gemini_progress_interval_seconds

            worker.join(timeout=1.0)

        if error_holder:
            raise error_holder[0]
        if not result_holder:
            raise RuntimeError(f"Gemini request finished without response payload: file={target.name}")
        return result_holder[0]

    def _create_thumbnail_base64(self, source_path: Path) -> str | None:
        try:
            import fitz  # type: ignore[import-not-found]
        except Exception as exc:  # noqa: BLE001
            print(f"[monitor] thumbnail skipped: PyMuPDF is required ({exc})", file=sys.stderr)
            return None

        target_size = self.thumbnail_size

        try:
            with fitz.open(str(source_path)) as doc:
                if doc.page_count == 0:
                    return None

                page = doc.load_page(0)
                rect = page.rect
                max_edge = max(float(rect.width), float(rect.height), 1.0)
                scale = min(1.0, float(target_size) / max_edge)
                matrix = fitz.Matrix(scale, scale)
                pixmap = page.get_pixmap(matrix=matrix, alpha=False)

            image_bytes = pixmap.tobytes("jpg")
            encoded = base64.b64encode(image_bytes).decode("ascii")
            return encoded
        except Exception as exc:  # noqa: BLE001
            print(f"[monitor] thumbnail create failed: file={source_path} error={type(exc).__name__}: {exc}", file=sys.stderr)
            return None

    def attach_thumbnail_if_enabled(self, source_path: Path, result: dict) -> None:
        if not self.thumbnail_enabled:
            return

        started_at = time.time()
        print(f"[monitor][thumbnail] start: file={source_path.name} size={self.thumbnail_size}")
        thumbnail_b64 = self._create_thumbnail_base64(source_path)

        if thumbnail_b64:
            result["thumbnailImage"] = thumbnail_b64
            print(
                f"[monitor][thumbnail] end: file={source_path.name} success=True bytes={len(thumbnail_b64)} elapsed={time.time() - started_at:.2f}s"
            )
            return

        print(f"[monitor][thumbnail] end: file={source_path.name} success=False elapsed={time.time() - started_at:.2f}s")

    def notify_document_inserted(self, document_id: str, source_path: Path, reason: str) -> None:
        if not self.event_notify_enabled:
            return

        started_at = time.time()
        succeeded = False
        print(
            f"[monitor][event] notify start: document_id={document_id} reason={reason} url={self.event_notify_url}"
        )

        payload = {
            "event": "documents_inserted",
            "documentId": document_id,
            "sourcePath": str(source_path),
            "reason": reason,
            "occurredAt": now_iso(),
        }

        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "Content-Length": str(len(body)),
        }
        if self.event_notify_token:
            headers["X-Monitor-Event-Token"] = self.event_notify_token

        request = urllib.request.Request(
            self.event_notify_url,
            data=body,
            headers=headers,
            method="POST",
        )

        # Skip SSL certificate verification when notifying ourselves
        ssl_context: ssl.SSLContext | None = None
        if self.event_notify_url.startswith("https") and _is_self_url(self.event_notify_url):
            ssl_context = ssl.create_default_context()
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE
            print(
                f"[monitor][event] SSL certificate verification disabled (self-referential URL): {self.event_notify_url}"
            )

        try:
            with urllib.request.urlopen(request, timeout=self.event_notify_timeout_seconds, context=ssl_context) as response:
                status_code = int(getattr(response, "status", 0) or response.getcode() or 0)
                print(
                    f"[monitor][event] notify progress: document_id={document_id} status={status_code}"
                )
                if status_code >= 400:
                    print(
                        f"[monitor] event notify failed: status={status_code} url={self.event_notify_url} document_id={document_id}",
                        file=sys.stderr,
                    )
                else:
                    succeeded = True
        except urllib.error.HTTPError as exc:
            print(
                f"[monitor][event] notify progress: document_id={document_id} status={exc.code}"
            )
            print(
                f"[monitor] event notify HTTP error: status={exc.code} url={self.event_notify_url} document_id={document_id}",
                file=sys.stderr,
            )
        except Exception as exc:  # noqa: BLE001
            print(
                f"[monitor] event notify error: url={self.event_notify_url} document_id={document_id} error={type(exc).__name__}: {exc}",
                file=sys.stderr,
            )
        finally:
            elapsed = time.time() - started_at
            print(
                f"[monitor][event] notify end: document_id={document_id} success={succeeded} elapsed={elapsed:.2f}s"
            )

    def open_db(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        return conn

    def list_document_classes(self) -> list[str]:
        with self.open_db() as conn:
            rows = conn.execute(
                "SELECT DocumentClassID FROM DocumentClasses ORDER BY Priority, DocumentClassID"
            ).fetchall()
        return [str(row["DocumentClassID"]) for row in rows]

    def build_classification_prompt(self) -> str:
        prompt_path = Path(__file__).resolve().parent / "classify_file_prompt.md"
        base_prompt = prompt_path.read_text(encoding="utf-8")

        with self.open_db() as conn:
            rows = conn.execute(
                """
                SELECT DocumentClassID, Prompt
                FROM DocumentClasses
                WHERE Enabled = 1
                ORDER BY Priority, DocumentClassID
                """
            ).fetchall()

        sections: list[str] = [base_prompt.rstrip()]
        for row in rows:
            document_class_id = str(row["DocumentClassID"])
            prompt_text = str(row["Prompt"] or "")
            if not prompt_text.strip():
                continue

            section = (
                "\n-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=ypl\n\n"
                f"### {document_class_id}\n\n"
                f"DocumentClassID  {document_class_id}\n\n"
                f"{prompt_text.rstrip()}\n"
            )
            sections.append(section)

        return "\n".join(sections).strip() + "\n"

    def enqueue_file(self, file_path: Path) -> None:
        if file_path.suffix.lower() not in self.file_types:
            return
        resolved = file_path.resolve()
        self.insert_queue_entry(str(resolved), retry=0)
        self.new_entry_event.set()
        print(f"[monitor] detected new file: {file_path}")

    def insert_queue_entry(self, source_path: str, retry: int = 0) -> int:
        with self.open_db() as conn:
            existing = conn.execute(
                "SELECT EntryID FROM Queue WHERE SourcePath = ? ORDER BY EntryID LIMIT 1",
                (source_path,),
            ).fetchone()

            if existing is not None:
                entry_id = int(existing["EntryID"])
                conn.execute(
                    "UPDATE Queue SET Retry = ?, LastFailure = NULL WHERE EntryID = ?",
                    (retry, entry_id),
                )
                conn.commit()
                return entry_id

            cursor = conn.execute(
                "INSERT INTO Queue (Retry, LastFailure, SourcePath) VALUES (?, NULL, ?)",
                (retry, source_path),
            )
            conn.commit()
            return int(cursor.lastrowid)

    def mark_queue_failure(self, entry_id: int) -> None:
        with self.open_db() as conn:
            conn.execute(
                "UPDATE Queue SET LastFailure = ? WHERE EntryID = ?",
                (now_iso(), entry_id),
            )
            conn.commit()

    def delete_queue_entry(self, entry_id: int) -> None:
        with self.open_db() as conn:
            conn.execute("DELETE FROM Queue WHERE EntryID = ?", (entry_id,))
            conn.commit()

    def insert_unknown_document_from_queue(self, source_path: Path, retry: int) -> None:
        resolved_path = source_path.resolve()
        received_at = now_iso()
        if resolved_path.exists() and resolved_path.is_file():
            received_at = datetime.fromtimestamp(resolved_path.stat().st_mtime).isoformat(timespec="seconds")

        payload = json.dumps(
            {
                "sourceFile": resolved_path.name,
                "status": "retry_max_exceeded",
                "retry": retry,
                "note": "classification failed repeatedly",
            },
            ensure_ascii=False,
        )
        document_id = str(uuid.uuid4())

        with self.open_db() as conn:
            conn.execute(
                """
                INSERT INTO Documents (
                    ID, Active, SourcePath, DateCreated, DateReceived, Title,
                    Sender, SenderOrganization, Recipient, RecipientOrganization,
                    DocumentClassID, DocumentData
                ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    document_id,
                    str(resolved_path),
                    now_iso(),
                    received_at,
                    resolved_path.stem,
                    "",
                    "",
                    "",
                    "",
                    None,
                    payload,
                ),
            )
            conn.commit()

        self.notify_document_inserted(document_id=document_id, source_path=resolved_path, reason="retry_max_exceeded")

    def upsert_document(self, source_path: Path, result: dict) -> str:
        document_class_raw = str(result.get("documentClassId") or result.get("type") or "").strip()
        unknown_markers = {"", "unclassified", "unknown", "none", "null", "不明", "判定不能"}
        document_class = None if document_class_raw.lower() in unknown_markers else document_class_raw
        content_properties = result.get("content_properties") if isinstance(result.get("content_properties"), dict) else {}
        typed_properties = result.get("typed_properties") if isinstance(result.get("typed_properties"), dict) else {}
        fax_properties = result.get("fax_properties") if isinstance(result.get("fax_properties"), dict) else {}

        sender_name = fax_properties.get("senderName")
        if sender_name is None:
            sender_name = content_properties.get("senderName")

        sender_fax_number = fax_properties.get("senderFaxNumber")
        if sender_fax_number is None:
            sender_fax_number = content_properties.get("senderFaxNumber")

        recipient_name = fax_properties.get("recipientName")
        if recipient_name is None:
            recipient_name = content_properties.get("recipientName")

        recipient_fax_number = fax_properties.get("recipientFaxNumber")
        if recipient_fax_number is None:
            recipient_fax_number = content_properties.get("recipientFaxNumber")

        title = str(
            content_properties.get("title")
            or typed_properties.get("title")
            or result.get("title")
            or source_path.stem
        )
        sender = str(sender_name or sender_fax_number or "")
        sender_org = str(sender_fax_number or "")
        recipient = str(
            recipient_name
            or recipient_fax_number
            or ""
        )
        recipient_org = str(recipient_fax_number or "")
        received_at = str(fax_properties.get("transmissionTimestamp") or content_properties.get("timestamp") or now_iso())
        payload = json.dumps(result, ensure_ascii=False)
        document_id = str(uuid.uuid4())

        with self.open_db() as conn:
            if document_class is not None:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO DocumentClasses (DocumentClassID, Name, Prompt)
                    VALUES (?, ?, '')
                    """,
                    (document_class, document_class),
                )

            conn.execute(
                """
                INSERT INTO Documents (
                    ID, Active, SourcePath, DateCreated, DateReceived, Title,
                    Sender, SenderOrganization, Recipient, RecipientOrganization,
                    DocumentClassID, DocumentData
                ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    document_id,
                    str(source_path),
                    now_iso(),
                    received_at,
                    title,
                    sender,
                    sender_org,
                    recipient,
                    recipient_org,
                    document_class,
                    payload,
                ),
            )
            conn.commit()

        self.notify_document_inserted(document_id=document_id, source_path=source_path, reason="classified")
        return document_id

    def _invoke_plugin_handler(self, document_id: str, result: dict) -> None:
        """result の documentClassId に対応する plugins/docClassHandler_<ID>.py が存在すれば
        それをロードして handle_document(document) を呼び出す。"""
        document_class_raw = str(result.get("documentClassId") or result.get("type") or "").strip()
        unknown_markers = {"", "unclassified", "unknown", "none", "null", "不明", "判定不能"}
        if document_class_raw.lower() in unknown_markers:
            return

        plugin_dir = Path(__file__).resolve().parent.parent / "plugins"
        plugin_path = plugin_dir / f"docClassHandler_{document_class_raw}.py"
        if not plugin_path.exists():
            return

        import importlib.util

        try:
            spec = importlib.util.spec_from_file_location(
                f"docClassHandler_{document_class_raw}", plugin_path
            )
            if spec is None or spec.loader is None:
                print(f"[monitor][plugin] failed to load spec: {plugin_path}", file=sys.stderr)
                return
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)  # type: ignore[union-attr]

            if not hasattr(module, "handle_document"):
                print(f"[monitor][plugin] handle_document not found: {plugin_path}", file=sys.stderr)
                return

            with self.open_db() as conn:
                row = conn.execute(
                    "SELECT * FROM Documents WHERE ID = ?",
                    (document_id,),
                ).fetchone()

            if row is None:
                print(
                    f"[monitor][plugin] document not found in DB: document_id={document_id}",
                    file=sys.stderr,
                )
                return

            document = dict(row)
            print(f"[monitor][plugin] invoke: handler={plugin_path.name} document_id={document_id}")
            module.handle_document(document)
            print(f"[monitor][plugin] done: handler={plugin_path.name} document_id={document_id}")
        except Exception as exc:  # noqa: BLE001
            print(
                f"[monitor][plugin] error: handler={plugin_path.name} document_id={document_id} "
                f"error={type(exc).__name__}: {exc}",
                file=sys.stderr,
            )

    def process_single_file(self, file_path: Path, queue_entry_id: int | None = None, retry: int = 0) -> bool:
        target = file_path.resolve()
        started_at = time.time()
        succeeded = False

        if not target.exists() or not target.is_file():
            if queue_entry_id is not None:
                self.delete_queue_entry(queue_entry_id)
                print(f"[monitor] queue entry removed (file not found): {target}", file=sys.stderr)
            return False
        if target.suffix.lower() not in self.file_types:
            if queue_entry_id is not None:
                self.delete_queue_entry(queue_entry_id)
                print(f"[monitor] queue entry removed (unsupported file type): {target}", file=sys.stderr)
            return False

        if queue_entry_id is None:
            queue_entry_id = self.insert_queue_entry(str(target), retry=retry)

        try:
            if not wait_file_stable(target):
                raise RuntimeError(f"file did not become stable: {target}")

            prompt_text = self.build_classification_prompt()
            gemini_model = os.getenv("GEMINI_API_MODEL", DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL
            file_size = target.stat().st_size if target.exists() else 0
            print(
                "[monitor][gemini] request start: "
                f"file={target.name} size={file_size}bytes model={gemini_model} "
                f"prompt_chars={len(prompt_text)} retry={retry} queue_entry_id={queue_entry_id}"
            )

            gemini_started_at = time.time()
            try:
                result = self.classify_file_with_timeout(target, prompt_text)
            except Exception as gemini_exc:  # noqa: BLE001
                gemini_elapsed = time.time() - gemini_started_at
                print(
                    "[monitor][gemini] request failed: "
                    f"file={target.name} elapsed={gemini_elapsed:.2f}s "
                    f"error={type(gemini_exc).__name__}: {gemini_exc}"
                )
                raise

            gemini_elapsed = time.time() - gemini_started_at
            payload_keys = sorted(result.keys())
            print(
                "[monitor][gemini] response received: "
                f"file={target.name} elapsed={gemini_elapsed:.2f}s "
                f"documentClassId={result.get('documentClassId')} "
                f"confidence={result.get('confidence')} keys={payload_keys}"
            )

            self.attach_thumbnail_if_enabled(target, result)

            document_id = self.upsert_document(target, result)
            self.delete_queue_entry(queue_entry_id)
            print(f"[monitor] processed: {target}")
            succeeded = True
            self._invoke_plugin_handler(document_id, result)
            return True
        except Exception as exc:  # noqa: BLE001
            self.mark_queue_failure(queue_entry_id)
            print(f"[monitor] failed: {target} ({exc})")
            return False
        finally:
            elapsed = time.time() - started_at
            print(f"[monitor] finished: {target} success={succeeded} elapsed={elapsed:.2f}s")

    def process_failed_queue_entries(self) -> None:
        """LastFailure IS NOT NULL かつ LastFailure から DEFAULT_SCAN_INTERVAL_SECONDS 秒以上
        経過したエントリをリトライ対象として処理する。

        リトライ上限を超えたエントリは unknown document として登録して削除する。
        それ以外は Retry をインクリメントして LastFailure = NULL にリセットし、
        new_entry_event をセットすることで file_worker_loop に処理を委ねる。
        直接 process_single_file を呼び出さないことで、file_worker_loop との
        二重処理（重複 Document 挿入）を防ぐ。
        """
        retry_max = get_retry_max()
        # LastFailure からの経過時間がループ待機間隔以上のもののみリトライ対象にする
        threshold = (datetime.now() - timedelta(seconds=DEFAULT_SCAN_INTERVAL_SECONDS)).isoformat(timespec="seconds")

        with self.open_db() as conn:
            rows = conn.execute(
                """
                SELECT EntryID, Retry, SourcePath
                FROM Queue
                WHERE LastFailure IS NOT NULL
                  AND LastFailure <= ?
                ORDER BY EntryID
                """,
                (threshold,),
            ).fetchall()

        enqueued = 0
        for row in rows:
            entry_id = int(row["EntryID"])
            retry = int(row["Retry"]) + 1
            source_path = Path(str(row["SourcePath"]))

            if retry > retry_max:
                self.insert_unknown_document_from_queue(source_path, retry)
                self.delete_queue_entry(entry_id)
                print(
                    f"[monitor] queue retry exceeded max ({retry_max}), registered unknown document and removed queue entry: {source_path}"
                )
                continue

            with self.open_db() as conn:
                conn.execute(
                    "UPDATE Queue SET Retry = ?, LastFailure = NULL WHERE EntryID = ?",
                    (retry, entry_id),
                )
                conn.commit()

            enqueued += 1
            print(f"[monitor] queue retry scheduled: retry={retry} path={source_path}")

        if enqueued:
            # file_worker_loop に処理を委ねる（直接 process_single_file は呼ばない）
            self.new_entry_event.set()

    def scan_directory_once(self, directory: Path) -> None:
        for file_path in iter_target_files([directory], self.file_types):
            self.process_single_file(file_path)

    def run_scan_file(self, file_path: Path) -> None:
        self.process_single_file(file_path)

    def start_worker(self) -> None:
        def file_worker_loop() -> None:
            """Queue テーブルの未処理エントリ (Retry=0 かつ LastFailure IS NULL) を
            1 件ずつ順次処理する。

            enqueue_file() が new_entry_event をセットするのでイベント驱動で起動する。
            wait の timeout は
            - サービス再起動時にテーブルに残留したエントリを素早く植取るために必要。
            """
            # 起動直後に一度察査することでクラッシュ前の残留エントリを消化する
            self.new_entry_event.set()

            while not self.stop_event.is_set():
                # イベントを待機。タイムアウト後もドレインして残留エントリを必ず確認する
                self.new_entry_event.wait(timeout=5.0)
                self.new_entry_event.clear()

                # 未処理エントリを上から順に 1 件ずつ取り出して処理（キューが空になるまで継続）
                # Retry 値に関係なく LastFailure IS NULL のものを全件対象にすることで、
                # リトライ開始後にクラッシュした場合 (Retry>0, LastFailure IS NULL) も取りこぼさない
                while not self.stop_event.is_set():
                    with self.open_db() as conn:
                        row = conn.execute(
                            """
                            SELECT EntryID, Retry, SourcePath
                            FROM Queue
                            WHERE LastFailure IS NULL
                            ORDER BY EntryID
                            LIMIT 1
                            """
                        ).fetchone()

                    if row is None:
                        break

                    entry_id = int(row["EntryID"])
                    retry = int(row["Retry"])
                    source_path = Path(str(row["SourcePath"]))

                    with self.processing_lock:
                        self.process_single_file(source_path, queue_entry_id=entry_id, retry=retry)

        def queue_retry_loop() -> None:
            """失敗キュー (Queue テーブルの LastFailure IS NOT NULL) のリトライを定期的に実行する。

            失敗エントリを LastFailure = NULL にリセットして new_entry_event をセットするだけで、
            実際のファイル処理は file_worker_loop に委ねる。
            そのため processing_lock を保持する必要はない。
            """
            # 起動直後に一度実行することでプロセス再起動前の失敗済みエントリを即時消化する
            self.process_failed_queue_entries()

            while not self.stop_event.is_set():
                # 1 秒刻みで待機することで stop_event を素早く検知できる
                for _ in range(DEFAULT_SCAN_INTERVAL_SECONDS):
                    if self.stop_event.is_set():
                        return
                    time.sleep(1)

                self.process_failed_queue_entries()

        self.worker_thread = threading.Thread(
            target=file_worker_loop, name="file-worker", daemon=True
        )
        self.worker_thread.start()

        self.queue_retry_thread = threading.Thread(
            target=queue_retry_loop, name="queue-retry", daemon=True
        )
        self.queue_retry_thread.start()

    def stop_worker(self) -> None:
        self.stop_event.set()
        if self.worker_thread is not None:
            self.worker_thread.join(timeout=5.0)
        if self.queue_retry_thread is not None:
            self.queue_retry_thread.join(timeout=5.0)


def iter_target_files(directories: Iterable[Path], file_types: set[str]) -> Iterable[Path]:
    for directory in directories:
        if not directory.exists() or not directory.is_dir():
            continue

        for path in directory.rglob("*"):
            if path.is_file() and path.suffix.lower() in file_types:
                yield path


def read_watch_directories(dir_option: str | None) -> list[Path]:
    if dir_option:
        return [Path(dir_option)]

    values: list[str] = []
    main_dir = os.getenv("MONITOR_DIR", "").strip()
    if main_dir:
        values.append(main_dir)

    index = 1
    while True:
        key = f"MONITOR_DIR_{index}"
        value = os.getenv(key, "").strip()
        if not value:
            break
        values.append(value)
        index += 1

    return [Path(value) for value in values]


def resolve_scan_targets(scan_argument: str) -> list[Path]:
    pattern = scan_argument.strip()
    if not pattern:
        return []

    has_wildcard = glob.has_magic(pattern)
    if not has_wildcard:
        return [Path(pattern)]

    matched_paths = glob.glob(pattern, recursive=True)
    unique_files: list[Path] = []
    seen: set[str] = set()

    for raw_path in matched_paths:
        candidate = Path(raw_path)
        if not candidate.exists() or not candidate.is_file():
            continue

        resolved = str(candidate.resolve())
        if resolved in seen:
            continue

        seen.add(resolved)
        unique_files.append(candidate)

    return unique_files


def run_service(monitor: MonitorService, directories: list[Path]) -> None:
    try:
        from watchdog.events import FileSystemEventHandler
        from watchdog.observers import Observer
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError("watchdog package is required for --as-service") from exc

    class NewFileHandler(FileSystemEventHandler):
        def _enqueue_if_target_file(self, raw_path: str | None) -> None:
            if not raw_path:
                return
            path = Path(raw_path)
            if path.suffix.lower() in monitor.file_types:
                monitor.enqueue_file(path)

        def on_created(self, event):  # type: ignore[override]
            if event.is_directory:
                return
            self._enqueue_if_target_file(getattr(event, "src_path", None))

        def on_moved(self, event):  # type: ignore[override]
            if event.is_directory:
                return
            self._enqueue_if_target_file(getattr(event, "dest_path", None))

    observer = Observer()
    handler = NewFileHandler()

    for directory in directories:
        directory.mkdir(parents=True, exist_ok=True)
        observer.schedule(handler, str(directory), recursive=True)
        print(f"[monitor] watching: {directory}")

    monitor.start_worker()
    observer.start()
    print("[monitor] service started")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("[monitor] stopping...")
    finally:
        observer.stop()
        observer.join(timeout=5)
        monitor.stop_worker()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Directory monitoring and document registration service")
    parser.add_argument("--prompt", action="store_true", help="Print composed classification prompt and exit")
    parser.add_argument("--as-service", action="store_true", help="Run as resident directory monitor")
    parser.add_argument("--list-documentclass", action="store_true", help="List DocumentClassID in DB")
    parser.add_argument("--scan", type=str, help="Process one or more files (wildcards supported) and exit")
    parser.add_argument("--scandir", type=str, help="Process files under directory and exit")
    parser.add_argument("--dir", type=str, help="Directory path")
    return parser


def main() -> int:
    load_env_file()

    print(f" Yokinsoft Paperless for FAX  v.{__version__}", file=sys.stderr)
    print(" (c) Yokinsoft", file=sys.stderr)
    print("", file=sys.stderr)

    os.environ.setdefault("GEMINI_API_MODEL", DEFAULT_GEMINI_MODEL)

    parser = build_parser()
    args = parser.parse_args()

    db_path = ensure_database_directory()
    file_types = parse_file_types()
    print_startup_environment(args, db_path, file_types)
    monitor = MonitorService(db_path=db_path, file_types=file_types)

    if args.prompt:
        prompt = monitor.build_classification_prompt()
        try:
            print(prompt, end="")
        except UnicodeEncodeError:
            sys.stdout.buffer.write(prompt.encode("utf-8"))
        return 0

    if args.list_documentclass:
        classes = monitor.list_document_classes()
        for item in classes:
            print(item)
        return 0

    if args.scan:
        targets = resolve_scan_targets(args.scan)
        if not targets:
            parser.error("--scan did not match any file")

        for target in targets:
            monitor.run_scan_file(target)
        return 0

    if args.scandir:
        monitor.scan_directory_once(Path(args.scandir))
        return 0

    if args.dir and not args.as_service:
        monitor.scan_directory_once(Path(args.dir))
        return 0

    if args.as_service:
        directories = read_watch_directories(args.dir)
        if not directories:
            parser.error("--as-service requires --dir or MONITOR_DIR settings")
        run_service(monitor, directories)
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
