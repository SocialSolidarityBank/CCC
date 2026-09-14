"""Google Sheets 저장소. 탭 2개: participants, sessions.

시트 ID는 env PROTOTYPE_SHEET_ID. 서비스 계정은 GOOGLE_APPLICATION_CREDENTIALS
파일 경로로만 주입하고 with_subject 로 ggbss.or.kr mailbox 를 대리한다.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone

from google.oauth2 import service_account
from googleapiclient.discovery import build

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

PARTICIPANT_HEADERS = ["participant_id", "name", "phone", "email", "birth_date", "created_at"]
SESSION_HEADERS = [
    "session_id", "participant_id", "occurred_at", "kind",
    "masked_text", "draft_json", "approved_at", "author", "created_at",
]


def _service():
    creds = service_account.Credentials.from_service_account_file(
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"], scopes=SCOPES
    ).with_subject(os.environ["GOOGLE_WORKSPACE_SUBJECT"])
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


def _sheet_id() -> str:
    sid = os.environ.get("PROTOTYPE_SHEET_ID", "").strip()
    if not sid:
        raise RuntimeError("PROTOTYPE_SHEET_ID missing")
    return sid


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _values(tab: str) -> list[list[str]]:
    svc = _service()
    res = svc.spreadsheets().values().get(
        spreadsheetId=_sheet_id(), range=f"{tab}!A:Z"
    ).execute()
    return res.get("values", [])


def _rows(tab: str, headers: list[str]) -> list[dict]:
    values = _values(tab)
    if not values:
        return []
    head = values[0]
    out = []
    for row in values[1:]:
        padded = row + [""] * (len(head) - len(row))
        out.append({h: padded[i] for i, h in enumerate(head)})
    return out


def _append(tab: str, headers: list[str], record: dict) -> None:
    svc = _service()
    svc.spreadsheets().values().append(
        spreadsheetId=_sheet_id(),
        range=f"{tab}!A1",
        valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
        body={"values": [[record.get(h, "") for h in headers]]},
    ).execute()


def _update_row(tab: str, headers: list[str], row_index_1based: int, record: dict) -> None:
    svc = _service()
    svc.spreadsheets().values().update(
        spreadsheetId=_sheet_id(),
        range=f"{tab}!A{row_index_1based}",
        valueInputOption="RAW",
        body={"values": [[record.get(h, "") for h in headers]]},
    ).execute()


# ── participants ──────────────────────────────────────────────

def list_participants() -> list[dict]:
    return _rows("participants", PARTICIPANT_HEADERS)


def get_participant(pid: str) -> dict | None:
    for row in list_participants():
        if row["participant_id"] == pid:
            return row
    return None


def create_participant(name: str, phone: str, email: str, birth_date: str) -> dict:
    rec = {
        "participant_id": f"p-{uuid.uuid4().hex[:8]}",
        "name": name,
        "phone": phone,
        "email": email,
        "birth_date": birth_date,
        "created_at": _now(),
    }
    _append("participants", PARTICIPANT_HEADERS, rec)
    return rec


# ── sessions ──────────────────────────────────────────────────

def list_sessions(participant_id: str | None = None) -> list[dict]:
    rows = _rows("sessions", SESSION_HEADERS)
    if participant_id:
        rows = [r for r in rows if r["participant_id"] == participant_id]
    rows.sort(key=lambda r: r.get("occurred_at", ""), reverse=True)
    return rows


def get_session(session_id: str) -> tuple[dict, int] | None:
    """(row, 시트 행 번호 1-based). 헤더가 1행이라 데이터는 2행부터."""
    values = _values("sessions")
    for i, row in enumerate(values[1:], start=2):
        head = values[0] if values else SESSION_HEADERS
        padded = row + [""] * (len(head) - len(row))
        rec = {h: padded[j] for j, h in enumerate(head)}
        if rec["session_id"] == session_id:
            return rec, i
    return None


def create_session(participant_id: str, occurred_at: str, kind: str, author: str) -> dict:
    rec = {
        "session_id": f"s-{uuid.uuid4().hex[:8]}",
        "participant_id": participant_id,
        "occurred_at": occurred_at,
        "kind": kind,
        "masked_text": "",
        "draft_json": "",
        "approved_at": "",
        "author": author,
        "created_at": _now(),
    }
    _append("sessions", SESSION_HEADERS, rec)
    return rec


def update_session(session_id: str, **fields) -> dict:
    found = get_session(session_id)
    if not found:
        raise KeyError(session_id)
    rec, row_no = found
    rec.update(fields)
    _update_row("sessions", SESSION_HEADERS, row_no, rec)
    return rec


def draft_of(rec: dict) -> dict | None:
    raw = rec.get("draft_json", "")
    return json.loads(raw) if raw else None
