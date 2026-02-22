from __future__ import annotations

import os
import sqlite3
import hashlib
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)
except ImportError:
    pass  # python-dotenv not installed; rely on process environment variables


_DATA_DIR = Path(__file__).resolve().parents[1] / "data"

_ENV_SUFFIX: dict[str, str] = {
    "dev": "-dev",
    "stg": "-stg",
    "prod": "",
}


def _default_db_path() -> Path:
    env = os.getenv("APP_ENV", "dev").strip().lower()
    suffix = _ENV_SUFFIX.get(env, f"-{env}")
    return _DATA_DIR / f"yokinspaperless{suffix}.db"


def hash_password(password: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{password}".encode("utf-8")).hexdigest()


def get_db_path() -> Path:
    configured = os.getenv("DATABASE_PATH", "").strip()
    if configured:
        return Path(configured)
    return _default_db_path()


def create_schema(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")

    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS DocumentClasses (
            DocumentClassID TEXT PRIMARY KEY,
            Name TEXT NOT NULL,
            Priority INTEGER NOT NULL DEFAULT 0,
            Enabled INTEGER NOT NULL DEFAULT 1,
            Prompt TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS Users (
            UserName TEXT PRIMARY KEY,
            PasswordSalt TEXT NOT NULL,
            PasswordHash TEXT,
            Enabled INTEGER NOT NULL DEFAULT 1,
            IsAdmin INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS Documents (
            ID TEXT PRIMARY KEY,
            Active INTEGER NOT NULL DEFAULT 1,
            SourcePath TEXT NOT NULL,
            DateCreated TEXT NOT NULL,
            DateReceived TEXT NOT NULL,
            Title TEXT NOT NULL,
            Sender TEXT,
            SenderOrganization TEXT,
            Recipient TEXT,
            RecipientOrganization TEXT,
            DocumentClassID TEXT,
            DocumentData TEXT NOT NULL,
            FOREIGN KEY (DocumentClassID) REFERENCES DocumentClasses(DocumentClassID)
        );

        CREATE TABLE IF NOT EXISTS ApiKeys (
            ApiKeyID TEXT PRIMARY KEY,
            KeyName TEXT NOT NULL UNIQUE,
            KeyHash TEXT NOT NULL,
            CreatedAt TEXT NOT NULL,
            ExpiresAt TEXT,
            Enabled INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS Queue (
            EntryID INTEGER PRIMARY KEY AUTOINCREMENT,
            Retry INTEGER NOT NULL DEFAULT 0,
            LastFailure TEXT,
            SourcePath TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_documentclasses_priority ON DocumentClasses(Priority, DocumentClassID);
        CREATE INDEX IF NOT EXISTS idx_documents_active_received_id ON Documents(Active, DateReceived DESC, ID);
        CREATE INDEX IF NOT EXISTS idx_documents_docclass_active_received_id ON Documents(DocumentClassID, Active, DateReceived DESC, ID);
        CREATE INDEX IF NOT EXISTS idx_documents_docclass_received_id ON Documents(DocumentClassID, DateReceived DESC, ID);
        CREATE INDEX IF NOT EXISTS idx_documents_recipient ON Documents(Recipient);
        CREATE INDEX IF NOT EXISTS idx_queue_source_path ON Queue(SourcePath);
        """
    )


def seed_data(conn: sqlite3.Connection) -> None:
    conn.executemany(
        """
        INSERT OR REPLACE INTO DocumentClasses (DocumentClassID, Name, Priority, Enabled, Prompt)
        VALUES (?, ?, ?, ?, ?)
        """,
        [
            ("Invoice", "請求書", 10, 1, "請求書向けプロンプト"),
            ("Order", "注文書", 20, 1, "注文書向けプロンプト"),
            ("Notice", "通知書", 30, 1, "通知書向けプロンプト"),
        ],
    )

    admin_salt = "salt-admin"
    tanaka_salt = "salt-tanaka"
    suzuki_salt = "salt-suzuki"

    conn.executemany(
        """
        INSERT OR REPLACE INTO Users (UserName, PasswordSalt, PasswordHash, Enabled, IsAdmin)
        VALUES (?, ?, ?, ?, ?)
        """,
        [
            ("admin", admin_salt, hash_password("pass1234", admin_salt), 1, 1),
            ("tanaka", tanaka_salt, hash_password("pass1234", tanaka_salt), 1, 0),
            ("suzuki", suzuki_salt, hash_password("pass1234", suzuki_salt), 1, 0),
        ],
    )

    conn.executemany(
        """
        INSERT OR REPLACE INTO Documents (
            ID, Active, SourcePath, DateCreated, DateReceived, Title,
            Sender, SenderOrganization, Recipient, RecipientOrganization,
            DocumentClassID, DocumentData
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                "d-001",
                1,
                "",
                "2026-02-14T09:11:00",
                "2026-02-14T09:10:00",
                "請求書 2月分",
                "山田 太郎",
                "ABC商事",
                "営業部",
                "Yokinsoft",
                "Invoice",
                '{"documentClassId":"Invoice","confidence":0.96,"title":"請求書 2月分"}',
            ),
            (
                "d-002",
                1,
                "",
                "2026-02-13T15:25:00",
                "2026-02-13T15:24:00",
                "注文確認書",
                "佐藤 次郎",
                "XYZ物流",
                "購買部",
                "Yokinsoft",
                "Order",
                '{"documentClassId":"Order","confidence":0.89,"title":"注文確認書"}',
            ),
            (
                "d-003",
                0,
                "",
                "2026-02-12T11:01:00",
                "2026-02-12T11:00:00",
                "納期変更通知",
                "高橋 三郎",
                "QRS製作所",
                "製造部",
                "Yokinsoft",
                "Notice",
                '{"documentClassId":"Notice","confidence":0.92,"title":"納期変更通知"}',
            ),
        ],
    )


def print_summary(conn: sqlite3.Connection) -> None:
    tables = ["DocumentClasses", "Users", "Documents", "ApiKeys", "Queue"]
    for table in tables:
        count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"{table}: {count}")

    print("\nRecent active documents:")
    rows = conn.execute(
        """
        SELECT ID, DateReceived, Title, DocumentClassID
        FROM Documents
        WHERE Active = 1
        ORDER BY DateReceived DESC
        LIMIT 5
        """
    ).fetchall()

    for row in rows:
        print(f"- {row[0]} | {row[1]} | {row[2]} | {row[3]}")


def main() -> None:
    db_path = get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(db_path) as conn:
        create_schema(conn)
        seed_data(conn)
        conn.commit()
        print(f"Initialized DB: {db_path}")
        print_summary(conn)


if __name__ == "__main__":
    main()
