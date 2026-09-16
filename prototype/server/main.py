"""프로토타입 API. 127.0.0.1 전용, 쿠키 세션 2역할."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

import pipeline
import sheets

SECRET = os.environ.get("PROTOTYPE_SECRET") or secrets.token_hex(32)
ACCOUNTS = {
    os.environ.get("PROTOTYPE_ADMIN_ID", "admin"): {
        "pw": os.environ.get("PROTOTYPE_ADMIN_PW", "admin-test"),
        "role": "admin",
        "label": "관리자",
    },
    os.environ.get("PROTOTYPE_STAFF_ID", "staff"): {
        "pw": os.environ.get("PROTOTYPE_STAFF_PW", "staff-test"),
        "role": "staff",
        "label": "실무자",
    },
}
SESSIONS: dict[str, dict] = {}  # token -> {id, role, label, exp}
SESSION_TTL = 12 * 3600


def _sign(payload: str) -> str:
    return hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()


def _issue(account_id: str) -> str:
    token = secrets.token_urlsafe(32)
    SESSIONS[token] = {**ACCOUNTS[account_id], "id": account_id, "exp": time.time() + SESSION_TTL}
    return token


def current_user(request: Request) -> dict:
    token = request.cookies.get("proto_session", "")
    sess = SESSIONS.get(token)
    if not sess or sess["exp"] < time.time():
        raise HTTPException(401, "로그인이 필요합니다")
    return sess




@asynccontextmanager
async def lifespan(app: FastAPI):
    missing = [k for k in ("AZURE_SPEECH_KEY", "OPENAI_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS",
                           "GOOGLE_WORKSPACE_SUBJECT", "PROTOTYPE_SHEET_ID") if not os.environ.get(k)]
    if missing:
        print(f"[prototype] missing env: {', '.join(missing)}")
    yield


app = FastAPI(lifespan=lifespan)


@app.middleware("http")
async def local_only(request: Request, call_next):
    if request.url.hostname not in {"127.0.0.1", "localhost"}:
        return JSONResponse({"error": "host_not_allowed"}, status_code=403)
    return await call_next(request)


@app.post("/api/login")
def login(body: dict):
    acc = ACCOUNTS.get(body.get("id", ""))
    if not acc or not hmac.compare_digest(acc["pw"], body.get("pw", "")):
        raise HTTPException(401, "아이디 또는 비밀번호가 맞지 않습니다")
    token = _issue(body["id"])
    resp = JSONResponse({"id": body["id"], "role": acc["role"], "label": acc["label"]})
    resp.set_cookie("proto_session", token, httponly=True, samesite="lax", max_age=SESSION_TTL)
    return resp


@app.post("/api/logout")
def logout(request: Request):
    SESSIONS.pop(request.cookies.get("proto_session", ""), None)
    resp = JSONResponse({"ok": True})
    resp.delete_cookie("proto_session")
    return resp


@app.get("/api/me")
def me(user: dict = Depends(current_user)):
    return {"id": user["id"], "role": user["role"], "label": user["label"]}


@app.get("/api/participants")
def participants(user: dict = Depends(current_user)):
    return sheets.list_participants()


@app.post("/api/participants")
def new_participant(body: dict, user: dict = Depends(current_user)):
    if user["role"] != "staff":
        raise HTTPException(403, "실무자만 당사자를 등록할 수 있습니다")
    return sheets.create_participant(
        body.get("name", ""), body.get("phone", ""), body.get("email", ""), body.get("birth_date", "")
    )


@app.get("/api/participants/{pid}")
def participant(pid: str, user: dict = Depends(current_user)):
    p = sheets.get_participant(pid)
    if not p:
        raise HTTPException(404, "당사자를 찾을 수 없습니다")
    sessions = sheets.list_sessions(pid)
    return {**p, "sessions": [
        {**s, "draft": sheets.draft_of(s), "form": sheets.form_of(s)} for s in sessions
    ]}


@app.post("/api/sessions")
def new_session(body: dict, user: dict = Depends(current_user)):
    if user["role"] != "staff":
        raise HTTPException(403, "실무자만 기록을 작성할 수 있습니다")
    return sheets.create_session(
        body["participant_id"], body["occurred_at"], body.get("kind", "basic"), user["id"]
    )


@app.post("/api/sessions/{sid}/process")
async def process(
    sid: str,
    user: dict = Depends(current_user),
    audio: UploadFile | None = File(None),
    memo: str = Form(""),
    text: str = Form(""),
    form: str = Form(""),
):
    if user["role"] != "staff":
        raise HTTPException(403, "실무자만 기록을 처리할 수 있습니다")
    found = sheets.get_session(sid)
    if not found:
        raise HTTPException(404, "회차를 찾을 수 없습니다")
    rec, _ = found
    participant = sheets.get_participant(rec["participant_id"])
    if not participant:
        raise HTTPException(404, "당사자를 찾을 수 없습니다")

    transcript = ""
    if audio is not None and audio.filename:
        data = await audio.read()
        suffix = os.path.splitext(audio.filename)[1] or ".bin"
        try:
            transcript = pipeline.transcribe(data, suffix)
        except pipeline.azure_stt.AzureSttError as e:
            raise HTTPException(502, f"STT 실패: {e.code}")
        finally:
            del data

    # text: 폼 화면이 미리 평탄화한 기록 본문(인테이크 답변·기록지 칸). memo: 수기 메모 단축 경로.
    masked_transcript = pipeline.mask(transcript, participant) if transcript else ""
    masked_body = pipeline.mask(text or memo, participant) if (text or memo).strip() else ""
    masked_text = "\n\n".join(t for t in (masked_body, masked_transcript) if t)

    update = {"masked_text": masked_text}
    if form.strip():
        try:
            form_value = json.loads(form)
            update["form_json"] = json.dumps(
                pipeline.mask_structure(form_value, participant), ensure_ascii=False
            )
        except json.JSONDecodeError:
            raise HTTPException(400, "form JSON 형식이 아닙니다")
    sheets.update_session(sid, **update)

    try:
        draft = pipeline.summarize(masked_transcript, masked_body or None)
    except Exception as e:
        return {"masked_text": masked_text, "draft": None, "ai_error": f"{type(e).__name__}"}

    sheets.update_session(sid, draft_json=json.dumps(draft, ensure_ascii=False))
    return {"masked_text": masked_text, "draft": draft}


@app.post("/api/sessions/{sid}/approve")
def approve(sid: str, user: dict = Depends(current_user)):
    if user["role"] != "staff":
        raise HTTPException(403, "실무자만 승인할 수 있습니다")
    found = sheets.get_session(sid)
    if not found:
        raise HTTPException(404, "회차를 찾을 수 없습니다")
    session, _ = found
    if not session.get("draft_json"):
        raise HTTPException(409, "승인할 AI 정리가 없습니다")
    rec = sheets.update_session(sid, approved_at=sheets._now())
    return {"approved_at": rec["approved_at"]}
