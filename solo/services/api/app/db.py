import hashlib
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Iterator

from .config import get_settings
from .timeutil import iso, parse_datetime, utc_now

SCHEMA = """
CREATE TABLE IF NOT EXISTS news_articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  link TEXT NOT NULL,
  source TEXT,
  category TEXT,
  published_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_news_published ON news_articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_last_seen ON news_articles(last_seen_at DESC);

CREATE TABLE IF NOT EXISTS paper_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  entry_price REAL NOT NULL,
  entry_at TEXT NOT NULL,
  exit_price REAL,
  exit_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')),
  stop_loss REAL,
  take_profit REAL,
  entry_fee REAL NOT NULL DEFAULT 0,
  exit_fee REAL NOT NULL DEFAULT 0,
  realized_pnl REAL,
  notes TEXT,
  quote_source TEXT,
  exit_quote_source TEXT,
  risk_snapshot_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_paper_status ON paper_trades(status, entry_at DESC);

CREATE TABLE IF NOT EXISTS risk_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('price_above', 'price_below', 'news_keyword')),
  symbol TEXT,
  threshold REAL,
  keyword TEXT,
  note TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_triggered_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
"""


class Database:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or get_settings().database_file
        self.path.parent.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=20)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def init(self) -> None:
        with self.connect() as connection:
            connection.executescript(SCHEMA)

    # ------------------------------- news ---------------------------------
    def upsert_articles(self, articles: list[dict]) -> dict[str, str]:
        if not articles:
            return {}
        now = iso(utc_now())
        ids = [str(article["id"]) for article in articles]
        with self.connect() as connection:
            connection.executemany(
                """
                INSERT INTO news_articles
                  (id, title, link, source, category, published_at, first_seen_at, last_seen_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  title = excluded.title,
                  link = excluded.link,
                  source = excluded.source,
                  category = excluded.category,
                  published_at = excluded.published_at,
                  last_seen_at = excluded.last_seen_at
                """,
                [
                    (
                        article["id"],
                        article["title"],
                        article["link"],
                        article.get("source") or "",
                        article.get("category") or "general",
                        article.get("published_at"),
                        now,
                        now,
                    )
                    for article in articles
                ],
            )
            placeholders = ",".join("?" for _ in ids)
            rows = connection.execute(
                f"SELECT id, first_seen_at FROM news_articles WHERE id IN ({placeholders})", ids
            ).fetchall()
        return {row["id"]: row["first_seen_at"] for row in rows}

    def recent_articles(self, hours: int = 36, limit: int = 300) -> list[dict]:
        cutoff = iso(utc_now() - timedelta(hours=max(1, hours)))
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM news_articles
                WHERE COALESCE(published_at, last_seen_at) >= ?
                ORDER BY COALESCE(published_at, last_seen_at) DESC
                LIMIT ?
                """,
                (cutoff, limit),
            ).fetchall()
        return [dict(row) for row in rows]

    # ------------------------------ paper ---------------------------------
    def create_trade(self, payload: dict[str, Any]) -> dict:
        columns = ", ".join(payload.keys())
        placeholders = ", ".join("?" for _ in payload)
        with self.connect() as connection:
            cursor = connection.execute(
                f"INSERT INTO paper_trades ({columns}) VALUES ({placeholders})",
                tuple(payload.values()),
            )
            row = connection.execute(
                "SELECT * FROM paper_trades WHERE id = ?", (cursor.lastrowid,)
            ).fetchone()
        return dict(row)

    def list_trades(self, status: str | None = None) -> list[dict]:
        query = "SELECT * FROM paper_trades"
        params: tuple[Any, ...] = ()
        if status:
            query += " WHERE status = ?"
            params = (status,)
        query += " ORDER BY entry_at DESC, id DESC"
        with self.connect() as connection:
            rows = connection.execute(query, params).fetchall()
        return [dict(row) for row in rows]

    def get_trade(self, trade_id: int) -> dict | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM paper_trades WHERE id = ?", (trade_id,)
            ).fetchone()
        return dict(row) if row else None

    def close_trade(self, trade_id: int, payload: dict[str, Any]) -> dict | None:
        assignments = ", ".join(f"{key} = ?" for key in payload)
        with self.connect() as connection:
            connection.execute(
                f"UPDATE paper_trades SET {assignments} WHERE id = ? AND status = 'OPEN'",
                (*payload.values(), trade_id),
            )
            row = connection.execute(
                "SELECT * FROM paper_trades WHERE id = ?", (trade_id,)
            ).fetchone()
        return dict(row) if row else None

    def closed_pnl_since(self, start: datetime) -> float:
        with self.connect() as connection:
            row = connection.execute(
                """
                SELECT COALESCE(SUM(realized_pnl), 0) AS pnl
                FROM paper_trades
                WHERE status = 'CLOSED' AND exit_at >= ?
                """,
                (iso(start),),
            ).fetchone()
        return float(row["pnl"] or 0)

    def all_closed_pnl(self) -> list[float]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT realized_pnl FROM paper_trades WHERE status = 'CLOSED' ORDER BY exit_at"
            ).fetchall()
        return [float(row["realized_pnl"] or 0) for row in rows]

    # ----------------------------- settings -------------------------------
    def get_settings_overrides(self) -> dict[str, Any]:
        with self.connect() as connection:
            rows = connection.execute("SELECT key, value_json FROM risk_settings").fetchall()
        return {row["key"]: json.loads(row["value_json"]) for row in rows}

    def save_settings_overrides(self, values: dict[str, Any]) -> None:
        now = iso(utc_now())
        with self.connect() as connection:
            connection.executemany(
                """
                INSERT INTO risk_settings (key, value_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                  value_json = excluded.value_json,
                  updated_at = excluded.updated_at
                """,
                [(key, json.dumps(value), now) for key, value in values.items()],
            )

    # ------------------------------- alerts -------------------------------
    def create_alert_rule(self, payload: dict[str, Any]) -> dict:
        columns = ", ".join(payload.keys())
        placeholders = ", ".join("?" for _ in payload)
        with self.connect() as connection:
            cursor = connection.execute(
                f"INSERT INTO alert_rules ({columns}) VALUES ({placeholders})",
                tuple(payload.values()),
            )
            row = connection.execute(
                "SELECT * FROM alert_rules WHERE id = ?", (cursor.lastrowid,)
            ).fetchone()
        return dict(row)

    def list_alert_rules(self) -> list[dict]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM alert_rules ORDER BY created_at DESC, id DESC"
            ).fetchall()
        return [dict(row) for row in rows]

    def get_alert_rule(self, rule_id: int) -> dict | None:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM alert_rules WHERE id = ?", (rule_id,)).fetchone()
        return dict(row) if row else None

    def delete_alert_rule(self, rule_id: int) -> bool:
        with self.connect() as connection:
            cursor = connection.execute("DELETE FROM alert_rules WHERE id = ?", (rule_id,))
        return cursor.rowcount > 0

    def mark_alert_triggered(self, rule_id: int, at: str) -> None:
        with self.connect() as connection:
            connection.execute(
                "UPDATE alert_rules SET last_triggered_at = ? WHERE id = ?",
                (at, rule_id),
            )

    # ------------------------------- audit --------------------------------
    def append_audit(self, action: str, payload: dict[str, Any], actor: str = "local") -> dict:
        at = iso(utc_now())
        payload_json = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            previous = connection.execute(
                "SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1"
            ).fetchone()
            prev_hash = previous["hash"] if previous else "GENESIS"
            digest = hashlib.sha256(
                f"{prev_hash}|{at}|{actor}|{action}|{payload_json}".encode("utf-8")
            ).hexdigest()
            connection.execute(
                """
                INSERT INTO audit_log (at, actor, action, payload_json, prev_hash, hash)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (at, actor, action, payload_json, prev_hash, digest),
            )
        return {"at": at, "actor": actor, "action": action, "hash": digest, "prev_hash": prev_hash}

    def audit_log(self, limit: int = 100) -> list[dict]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (max(1, min(limit, 500)),)
            ).fetchall()
        return [dict(row) for row in rows]

    def verify_audit_chain(self) -> bool:
        with self.connect() as connection:
            rows = connection.execute("SELECT * FROM audit_log ORDER BY id ASC").fetchall()
            previous = "GENESIS"
            for row in rows:
                digest = hashlib.sha256(
                    f"{previous}|{row['at']}|{row['actor']}|{row['action']}|{row['payload_json']}".encode(
                        "utf-8"
                    )
                ).hexdigest()
                if row["prev_hash"] != previous or row["hash"] != digest:
                    return False
                previous = row["hash"]
        return True


_db: Database | None = None


def get_db() -> Database:
    global _db
    if _db is None:
        _db = Database()
        _db.init()
    return _db


def reset_db_for_tests(path: Path) -> Database:
    global _db
    _db = Database(path)
    _db.init()
    return _db
