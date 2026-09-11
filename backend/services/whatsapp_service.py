"""
Custom WhatsApp Provider API integration for Step Solar.

The provider's endpoint URL and (optionally) the exact JSON schema are both
configured through environment variables, so switching providers never
requires a code change:

    CUSTOM_WHATSAPP_API_URL     - endpoint that receives the WhatsApp payload
                                  (POST, JSON). Defaults to the Step Solar
                                  WaCRM public API
                                  (https://whatsapp.stepsolar.in/api/v1/messages).
                                  Set to empty to disable the feature.
    CUSTOM_WHATSAPP_API_KEY     - WaCRM API key (wacrm_live_…). Required unless
                                  WHATSAPP_AUTH_MODE=none. Create in WaCRM
                                  Settings → API keys (shown once).
    WHATSAPP_API_KEY_HEADER     - header name for the key. Default "Authorization".
    WHATSAPP_AUTH_MODE          - "bearer" (WaCRM default), "apikey", or "none".
    WHATSAPP_SENDER_ID          - business sender id / from number (optional).
    WHATSAPP_PAYLOAD_TEMPLATE   - (optional) JSON template with {{placeholder}}
                                  substitution. When unset the WaCRM body
                                  {to, type, text, name} is sent. Placeholders:
                                  {{event}} {{lead_id}} {{lead_code}}
                                  {{customer_name}} {{phone}} {{sender_id}}
                                  {{timestamp}} {{stage_key}} {{stage_label}}
                                  {{message}} {{extra}} {{base_url}}
                                  {{media_url}} {{filename}}
    WHATSAPP_MAX_ATTEMPTS       - max send attempts per message (default 3).
    WHATSAPP_REQUEST_TIMEOUT_SECONDS - HTTP timeout per attempt (default 10).

All of the above can instead (or additionally) be set at runtime by an Admin
through the CRM "WhatsApp settings" panel (stored in the Mongo `settings`
collection). Runtime values take precedence over environment variables and
apply immediately via `set_runtime_config()` without a redeploy.

Delivery is logged to the Mongo `whatsapp_logs` collection with a status of
PENDING / SUCCESS / FAILED and an attempt counter. Failed messages are retried
via `retry_failed_messages` (exposed through the admin API) up to
WHATSAPP_MAX_ATTEMPTS.

Every event maps to a documented life-cycle milestone of the lead:
LEAD_CAPTURED, SITE_SURVEY_SCHEDULED, SURVEY_COMPLETED, QUOTATION_SENT,
DOCS_VERIFIED, DISCOM_APPLIED, MATERIAL_DISPATCHED, INSTALLATION_IN_PROGRESS,
NET_METERING_PENDING, COMMISSIONED, SUBSIDY_DISBURSED.
"""
from __future__ import annotations

import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------- #
# Event catalogue — every life-cycle milestone that can trigger a WhatsApp msg
# --------------------------------------------------------------------------- #
WHATSAPP_EVENTS = [
    "LEAD_CAPTURED",
    "SITE_SURVEY_SCHEDULED",
    "SURVEY_COMPLETED",
    "QUOTATION_SENT",
    "DOCS_VERIFIED",
    "DISCOM_APPLIED",
    "MATERIAL_DISPATCHED",
    "INSTALLATION_IN_PROGRESS",
    "NET_METERING_PENDING",
    "COMMISSIONED",
    "SUBSIDY_DISBURSED",
    "DOCUMENT_SENT",
]

# Human-friendly default text for each event (used as the {{message}}
# placeholder and as the fallback `text` body).
_EVENT_MESSAGES = {
    "LEAD_CAPTURED": (
        "Thank you {name}! Step Solar has received your enquiry ({code}). "
        "Our team will contact you shortly to schedule a free site survey."
    ),
    "SITE_SURVEY_SCHEDULED": (
        "Hi {name}, your Step Solar site survey for {code} is scheduled "
        "for {when}. Our engineer will reach out to confirm the slot."
    ),
    "SURVEY_COMPLETED": (
        "Hi {name}, the site survey for {code} is complete. We are preparing "
        "your customised quotation."
    ),
    "QUOTATION_SENT": (
        "Hi {name}, your quotation for {code} is ready! Click {link} to review. "
        "Our team is available for any questions."
    ),
    "DOCS_VERIFIED": (
        "Hi {name}, the documents for {code} have been verified. We are "
        "proceeding with the DISCOM application."
    ),
    "DISCOM_APPLIED": (
        "Hi {name}, your DISCOM application for {code} has been submitted. "
        "We will keep you posted on the approval."
    ),
    "MATERIAL_DISPATCHED": (
        "Hi {name}, the solar material for {code} has been dispatched and "
        "is on its way to your site. Installation will begin shortly."
    ),
    "INSTALLATION_IN_PROGRESS": (
        "Hi {name}, installation for {code} is in progress at your site."
    ),
    "NET_METERING_PENDING": (
        "Hi {name}, your {code} system is installed and waiting for the "
        "net-metering approval from DISCOM."
    ),
    "COMMISSIONED": (
        "Congratulations {name}! Your {code} solar system is commissioned "
        "and generating clean energy. Thank you for choosing Step Solar."
    ),
    "SUBSIDY_DISBURSED": (
        "Hi {name}, the subsidy amount for {code} has been disbursed to "
        "your account. Thank you for choosing Step Solar."
    ),
    "DOCUMENT_SENT": (
        "Hi {name}, your {doc} for {code} is ready. Please check the "
        "document shared by Step Solar."
    ),
}


# --------------------------------------------------------------------------- #
# Config
#
# Settings are resolved at send time with this precedence:
#   1. DB-backed runtime config — set by an Admin through the CRM "WhatsApp
#      settings" panel, stored in the `settings` collection.
#   2. Environment variables — defaults / seed values.
# `set_runtime_config()` is called at startup and whenever the Admin saves
# settings from the CRM, so config changes apply immediately without redeploy.
# --------------------------------------------------------------------------- #
_runtime_cfg: Dict[str, Any] = {}

WACRM_MESSAGES_URL = "https://whatsapp.stepsolar.in/api/v1/messages"


def set_runtime_config(cfg: Optional[Dict[str, Any]]) -> None:
    """Replace the DB-backed runtime config (from the `settings` collection).

    Keys missing from `cfg` fall back to the env-based getters below. Calling
    with None/{} drops back to pure environment configuration.
    """
    global _runtime_cfg
    _runtime_cfg = dict(cfg or {})


def get_runtime_config() -> Dict[str, Any]:
    """Current DB-backed runtime config (what an Admin saved in the CRM)."""
    return dict(_runtime_cfg)


def _from_runtime(key: str, default: Any) -> Any:
    val = _runtime_cfg.get(key)
    return default if val is None else val


def base_url() -> str:
    """Public base URL used to build customer tracking links."""
    return str(
        _from_runtime("base_url", os.environ.get("STEPSOLAR_BASE_URL", "https://admin.stepsolar.in"))
    ).strip().rstrip("/")


def whatsapp_api_url() -> str:
    if "api_url" in _runtime_cfg:
        return str(_runtime_cfg.get("api_url") or "").strip()
    if "CUSTOM_WHATSAPP_API_URL" in os.environ:
        return str(os.environ.get("CUSTOM_WHATSAPP_API_URL") or "").strip()
    return WACRM_MESSAGES_URL


def whatsapp_enabled() -> bool:
    """True when a provider URL is set and auth is usable (key, or auth_mode=none)."""
    if not whatsapp_api_url():
        return False
    if _api_key():
        return True
    mode = str(_from_runtime("auth_mode", os.environ.get("WHATSAPP_AUTH_MODE", "")) or "").strip().lower()
    return mode == "none"


def _api_key() -> str:
    return str(_from_runtime("api_key", os.environ.get("CUSTOM_WHATSAPP_API_KEY", ""))).strip()


def _key_header() -> str:
    val = _from_runtime("key_header", os.environ.get("WHATSAPP_API_KEY_HEADER", "Authorization"))
    return str(val).strip() or "Authorization"


def _auth_mode() -> str:
    mode = str(_from_runtime("auth_mode", os.environ.get("WHATSAPP_AUTH_MODE", "")) or "").strip().lower()
    if mode:
        return mode
    return "bearer" if _api_key() else "none"


def _sender_id() -> str:
    return str(_from_runtime("sender_id", os.environ.get("WHATSAPP_SENDER_ID", ""))).strip()


def _max_attempts() -> int:
    val = _from_runtime("max_attempts", os.environ.get("WHATSAPP_MAX_ATTEMPTS", "3"))
    try:
        return max(1, int(val))
    except (ValueError, TypeError):
        return 3


def _timeout_seconds() -> int:
    val = _from_runtime("timeout_seconds", os.environ.get("WHATSAPP_REQUEST_TIMEOUT_SECONDS", "10"))
    try:
        return max(1, int(val))
    except (ValueError, TypeError):
        return 10


def _payload_template() -> Optional[Dict[str, Any]]:
    raw = str(_from_runtime("payload_template", os.environ.get("WHATSAPP_PAYLOAD_TEMPLATE", "")) or "").strip()
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            logger.warning("WHATSAPP_PAYLOAD_TEMPLATE is not a JSON object; ignoring.")
            return None
        return parsed
    except json.JSONDecodeError as e:
        logger.warning("WHATSAPP_PAYLOAD_TEMPLATE is not valid JSON (%s); ignoring.", e)
        return None


def _provider_error_message(text: str) -> str:
    """Prefer WaCRM `{error: {message}}` over the raw HTTP body."""
    raw = (text or "").strip()
    if not raw:
        return "send_failed"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return raw[:300]
    err = data.get("error") if isinstance(data, dict) else None
    if isinstance(err, dict):
        msg = err.get("message") or err.get("code")
        if msg:
            return str(msg)[:300]
    if isinstance(err, str) and err:
        return err[:300]
    return raw[:300]


def _mask_secret(secret: str) -> str:
    if not secret:
        return ""
    if len(secret) <= 4:
        return "•" * len(secret)
    return "••••••••" + secret[-4:]


def effective_config(mask_key: bool = True) -> Dict[str, Any]:
    """Resolved provider config used at send time (runtime over env)."""
    tmpl = _payload_template()
    key = _api_key()
    return {
        "api_url": whatsapp_api_url(),
        "key_header": _key_header(),
        "auth_mode": _auth_mode(),
        "sender_id": _sender_id(),
        "max_attempts": _max_attempts(),
        "timeout_seconds": _timeout_seconds(),
        "payload_template": json.dumps(tmpl, ensure_ascii=False) if tmpl else "",
        "base_url": base_url(),
        "api_key_set": bool(key),
        "api_key_masked": _mask_secret(key) if mask_key else key,
        "wacrm_base_url": wacrm_origin(),
        "wacrm_api_key_set": bool(_wacrm_api_key()),
        "wacrm_api_key_masked": _mask_secret(_wacrm_api_key()) if mask_key else _wacrm_api_key(),
    }


# --------------------------------------------------------------------------- #
# Payload building — default envelope + optional env-provided JSON template
# --------------------------------------------------------------------------- #
def _normalise_phone(phone: Any) -> str:
    """Return an E.164 number with a leading +, or "" if there are no digits.

    Indian 10-digit mobiles (6–9…) become +91XXXXXXXXXX. Values that already
    include a country code are kept as +<digits>. WaCRM / Meta accept this
    form on POST /api/v1/messages (`to`).
    """
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
    if not digits:
        return ""
    if digits.startswith("00"):
        digits = digits[2:]
    if len(digits) == 11 and digits.startswith("0") and digits[1] in "6789":
        digits = digits[1:]
    if len(digits) == 10 and digits[0] in "6789":
        digits = "91" + digits
    if not digits or digits[0] == "0":
        return ""
    return "+" + digits


def _event_message(event: str, lead: Dict[str, Any], extra: Dict[str, Any]) -> str:
    template = _EVENT_MESSAGES.get(event, "Step Solar update for {name} ({code}).")
    name = lead.get("full_name") or lead.get("name") or "there"
    code = lead.get("code") or ""
    when = extra.get("when") or ""
    link = extra.get("link") or ""
    text = template.format(
        name=name.split(" ")[0] if name else "there",
        code=code,
        when=when,
        link=link,
        doc=extra.get("doc") or extra.get("document_type") or "document",
    )
    if link and link not in text:
        text = f"{text} {link}".strip()
    return text


def _stage_of(lead: Dict[str, Any], event: str) -> Dict[str, Any]:
    key = event.lower().replace("-", "_")
    for s in (lead.get("stages") or []):
        if str(s.get("key", "")).replace("-", "_").lower() == key:
            return s
    return {}


def _media_kind(extra: Dict[str, Any]) -> str:
    kind = str(extra.get("media_type") or extra.get("type") or "").strip().lower()
    if kind in {"image", "video", "document", "audio"}:
        return kind
    filename = str(extra.get("filename") or "").strip().lower()
    if filename.endswith((".jpg", ".jpeg", ".png", ".gif", ".webp")):
        return "image"
    if filename.endswith((".mp4", ".mov", ".webm")):
        return "video"
    if filename.endswith((".mp3", ".ogg", ".wav", ".m4a")):
        return "audio"
    return "document"


def _default_payload(lead: Dict[str, Any], event: str, extra: Dict[str, Any]) -> Dict[str, Any]:
    """WaCRM public API body: POST /api/v1/messages `{to, type, text, name, ...}`."""
    phone = _normalise_phone(lead.get("phone") or extra.get("phone"))
    name = str(lead.get("full_name") or lead.get("name") or "").strip()
    text = str(extra.get("message") or _event_message(event, lead, extra) or "")
    payload: Dict[str, Any] = {
        "to": phone,
        "type": "text",
        "text": text,
    }
    if name:
        payload["name"] = name

    media_url = str(extra.get("media_url") or "").strip()
    if media_url.startswith("http://") or media_url.startswith("https://"):
        payload["type"] = _media_kind(extra)
        payload["media_url"] = media_url
        filename = str(extra.get("filename") or "").strip()
        if filename:
            payload["filename"] = filename
    return payload


def _substitute_placeholders(template: Dict[str, Any], context: Dict[str, str]) -> Dict[str, Any]:
    """Recursively substitute {{placeholder}} tokens in a template dict."""
    def _sub(v: Any) -> Any:
        if isinstance(v, dict):
            return {k: _sub(val) for k, val in v.items()}
        if isinstance(v, list):
            return [_sub(item) for item in v]
        if isinstance(v, str):
            out = v
            for key, val in context.items():
                out = out.replace("{{" + key + "}}", val)
            return out
        return v

    return _sub(template)


def build_payload(lead: Dict[str, Any], event: str, extra: Dict[str, Any]) -> Dict[str, Any]:
    """Build the exact request body for the configured provider."""
    template = _payload_template()
    if template is None:
        return _default_payload(lead, event, extra)

    phone = _normalise_phone(lead.get("phone") or extra.get("phone"))
    stage = _stage_of(lead, event)
    context = {
        "event": event,
        "lead_id": str(lead.get("id") or ""),
        "lead_code": str(lead.get("code") or ""),
        "customer_name": str(lead.get("full_name") or lead.get("name") or ""),
        "phone": phone,
        "sender_id": _sender_id(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "stage_key": str(extra.get("stage_key") or stage.get("key") or ""),
        "stage_label": str(extra.get("stage_label") or stage.get("label") or ""),
        "message": str(extra.get("message") or _event_message(event, lead, extra)),
        "extra": json.dumps(extra, ensure_ascii=False, default=str),
        "base_url": base_url(),
        "media_url": str(extra.get("media_url") or ""),
        "filename": str(extra.get("filename") or ""),
    }
    return _substitute_placeholders(template, context)


# --------------------------------------------------------------------------- #
# Sending + delivery logging (whatsapp_logs collection)
# --------------------------------------------------------------------------- #
async def _post(phone: str, payload: Dict[str, Any], log_id: str) -> Dict[str, Any]:
    """POST the payload to the configured provider and return the outcome."""
    import httpx

    url = whatsapp_api_url()
    headers = {"Content-Type": "application/json"}
    if _auth_mode() == "bearer" and _api_key():
        headers[_key_header()] = f"Bearer {_api_key()}"
    elif _auth_mode() == "apikey" and _api_key():
        headers[_key_header()] = _api_key()

    # Send the provider body as-is. WaCRM rejects unknown wrapper fields
    # (id/phone) — `to` must already be on the payload.
    body = payload if isinstance(payload, dict) else payload
    if isinstance(body, dict) and phone and not str(body.get("to") or "").strip():
        body = {**body, "to": phone}
    try:
        async with httpx.AsyncClient(timeout=_timeout_seconds()) as client:
            resp = await client.post(url, json=body, headers=headers)
        text = (resp.text or "")[:500]
        if 200 <= resp.status_code < 300:
            return {"ok": True, "status_code": resp.status_code, "response": text}
        logger.warning(
            "WhatsApp provider returned HTTP %s for message %s: %s",
            resp.status_code, log_id, text,
        )
        return {
            "ok": False,
            "status_code": resp.status_code,
            "response": _provider_error_message(text),
        }
    except Exception as e:  # noqa: BLE001
        logger.warning("WhatsApp send failed for message %s: %s", log_id, e)
        return {"ok": False, "status_code": None, "response": str(e)}


async def send_whatsapp(
    whatsapp_logs,
    lead: Dict[str, Any],
    event: str,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Send one WhatsApp message for a lead/event and log delivery.

    Returns {"ok": bool, "status": "SUCCESS"|"FAILED"|"SKIPPED", ...}. Always
    returns without raising; a broken provider never breaks CRM operations.
    """
    if event not in WHATSAPP_EVENTS:
        logger.warning("Unknown WhatsApp event %s; skipping send.", event)
        return {"ok": False, "status": "SKIPPED", "error": "unknown_event"}

    extra = dict(extra or {})
    payload = build_payload(lead, event, extra)

    log_doc = {
        "id": str(uuid.uuid4()),
        "lead_id": lead.get("id"),
        "lead_code": lead.get("code"),
        "event": event,
        "stage_key": extra.get("stage_key") or (
            payload.get("lead", {}).get("stageKey") if isinstance(payload.get("lead"), dict) else None
        ),
        "recipient": (
            _normalise_phone(payload.get("to"))
            if isinstance(payload, dict)
            else ""
        ) or _normalise_phone(lead.get("phone") or extra.get("phone")),
        "sender_id": _sender_id() or None,
        "payload": payload,
        "status": "PENDING",
        "http_status": None,
        "provider_response": None,
        "attempts": 1,
        "max_attempts": _max_attempts(),
        "error": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_attempt_at": datetime.now(timezone.utc).isoformat(),
    }

    if not whatsapp_enabled():
        log_doc["status"] = "SKIPPED"
        log_doc["error"] = "whatsapp_disabled"
        try:
            await whatsapp_logs.insert_one(log_doc)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to persist WhatsApp log")
        return {"ok": False, "status": "SKIPPED", "error": "whatsapp_disabled"}

    if not log_doc["recipient"]:
        log_doc["status"] = "FAILED"
        log_doc["error"] = "no_phone"
        try:
            await whatsapp_logs.insert_one(log_doc)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to persist WhatsApp log")
        return {"ok": False, "status": "FAILED", "error": "no_phone"}

    try:
        await whatsapp_logs.insert_one(log_doc)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to persist WhatsApp log (continuing send)")
        log_doc.pop("_id", None)

    outcome = await _post(log_doc["recipient"], payload, log_doc["id"])
    status = "SUCCESS" if outcome["ok"] else "FAILED"
    update = {
        "status": status,
        "http_status": outcome["status_code"],
        "provider_response": outcome.get("response"),
        "error": None if outcome["ok"] else outcome.get("response"),
        "last_attempt_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await whatsapp_logs.update_one({"id": log_doc["id"]}, {"$set": update})
    except Exception:  # noqa: BLE001
        logger.exception("Failed to update WhatsApp log %s", log_doc["id"])

    return {
        "ok": outcome["ok"],
        "status": status,
        "log_id": log_doc["id"],
        "error": None if outcome["ok"] else (outcome.get("response") or "send_failed"),
    }


async def notify_stage_event(
    whatsapp_logs,
    lead: Dict[str, Any],
    event: str,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Feature-flagged trigger used from the CRM when a milestone is reached."""
    if not whatsapp_enabled():
        return {"ok": False, "status": "SKIPPED", "error": "whatsapp_disabled"}
    return await send_whatsapp(whatsapp_logs, lead, event, extra)


async def retry_failed_messages(
    whatsapp_logs,
    lead_id: Optional[str] = None,
    limit: int = 50,
) -> Dict[str, Any]:
    """Re-send FAILED WhatsApp messages whose attempts are below the cap."""
    query: Dict[str, Any] = {
        "status": "FAILED",
        "attempts": {"$lt": _max_attempts()},
    }
    if lead_id:
        query["lead_id"] = lead_id

    cursor = whatsapp_logs.find(query).limit(limit)
    retried = 0
    succeeded = 0
    errors: list[str] = []
    async for log_doc in cursor:
        log_id = log_doc["id"]
        lead_data = log_doc.get("payload") or {}
        lead_for_send = {
            "id": log_doc.get("lead_id"),
            "code": log_doc.get("lead_code"),
            "full_name": (
                lead_data.get("recipient", {}).get("name")
                if isinstance(lead_data.get("recipient"), dict) else ""
            ),
            "phone": log_doc.get("recipient"),
        }
        event = log_doc.get("event") or "LEAD_CAPTURED"
        extra = lead_data.get("data") or {}

        outcome = await _post(log_doc.get("recipient") or "", lead_data, log_id)
        new_status = "SUCCESS" if outcome["ok"] else "FAILED"
        new_attempts = int(log_doc.get("attempts", 1)) + 1
        await whatsapp_logs.update_one(
            {"id": log_id},
            {"$set": {
                "status": new_status,
                "http_status": outcome["status_code"],
                "provider_response": outcome.get("response"),
                "error": None if outcome["ok"] else outcome.get("response"),
                "attempts": new_attempts,
                "last_attempt_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        retried += 1
        if outcome["ok"]:
            succeeded += 1
        elif new_attempts >= _max_attempts():
            errors.append(f"{log_id} (exhausted after {new_attempts} attempts)")
        time.sleep(0.1)

    return {"retried": retried, "succeeded": succeeded, "failed": retried - succeeded, "errors": errors[:20]}


# --------------------------------------------------------------------------- #
# WaCRM live thread (inbox) — used by CRM + field-app chat popups
# --------------------------------------------------------------------------- #
def _wacrm_api_key() -> str:
    """Key used for WaCRM inbox GETs. Falls back to the provider send key."""
    explicit = str(_from_runtime("wacrm_api_key", os.environ.get("WACRM_API_KEY", ""))).strip()
    return explicit or _api_key()


def wacrm_origin() -> str:
    explicit = str(_from_runtime("wacrm_base_url", os.environ.get("WACRM_BASE_URL", ""))).strip().rstrip("/")
    if explicit:
        return explicit
    url = whatsapp_api_url().rstrip("/")
    for suffix in ("/api/v1/messages", "/api/v1"):
        if url.endswith(suffix):
            url = url[: -len(suffix)]
            break
    return url.rstrip("/")


def _wacrm_headers() -> Dict[str, str]:
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    key = _wacrm_api_key()
    if _auth_mode() == "bearer" and key:
        headers[_key_header()] = f"Bearer {key}"
    elif _auth_mode() == "apikey" and key:
        headers[_key_header()] = key
    return headers


def _phone_digits(phone: Any) -> str:
    return "".join(ch for ch in str(phone or "") if ch.isdigit())


def _phones_match(a: Any, b: Any) -> bool:
    d1, d2 = _phone_digits(a), _phone_digits(b)
    if not d1 or not d2:
        return False
    if d1 == d2:
        return True
    n = min(10, len(d1), len(d2))
    return n >= 8 and d1[-n:] == d2[-n:]


def _public_message(raw: Dict[str, Any]) -> Dict[str, Any]:
    text = raw.get("content_text") or raw.get("text") or ""
    if not text and raw.get("template_name"):
        text = str(raw.get("template_name"))
    if not text and raw.get("media_url"):
        text = raw.get("filename") or raw.get("content_type") or "attachment"
    return {
        "id": raw.get("id"),
        "direction": raw.get("direction") or (
            "inbound" if raw.get("sender_type") == "customer" else "outbound"
        ),
        "text": text,
        "media_url": raw.get("media_url"),
        "content_type": raw.get("content_type") or "text",
        "status": raw.get("status") or "",
        "created_at": raw.get("created_at"),
    }


async def _wacrm_get(path: str) -> Dict[str, Any]:
    import httpx

    origin = wacrm_origin()
    if not origin:
        return {"ok": False, "status_code": None, "data": None, "error": "whatsapp_disabled"}
    url = origin + path
    try:
        async with httpx.AsyncClient(timeout=_timeout_seconds()) as client:
            resp = await client.get(url, headers=_wacrm_headers())
        text = (resp.text or "")[:2000]
        parsed: Any = None
        try:
            parsed = json.loads(resp.text) if resp.text else None
        except json.JSONDecodeError:
            parsed = None
        if 200 <= resp.status_code < 300:
            return {"ok": True, "status_code": resp.status_code, "data": parsed, "error": None}
        return {
            "ok": False,
            "status_code": resp.status_code,
            "data": parsed,
            "error": _provider_error_message(text),
        }
    except Exception as e:  # noqa: BLE001
        logger.warning("WaCRM GET %s failed: %s", path, e)
        return {"ok": False, "status_code": None, "data": None, "error": str(e)}


async def fetch_chat_thread(lead: Dict[str, Any]) -> Dict[str, Any]:
    """Load the WaCRM conversation for a lead phone (empty list if none yet)."""
    phone = _normalise_phone(lead.get("phone"))
    empty = {
        "ok": True,
        "enabled": True,
        "phone": phone,
        "conversation_id": None,
        "contact_id": None,
        "messages": [],
    }
    if not whatsapp_enabled():
        return {**empty, "ok": False, "enabled": False, "error": "whatsapp_disabled"}
    if not phone:
        return {**empty, "ok": False, "error": "no_phone"}

    from urllib.parse import quote

    search = _phone_digits(phone)[-10:] or _phone_digits(phone)
    contacts_out = await _wacrm_get(f"/api/v1/contacts?search={quote(search)}&limit=50")
    if not contacts_out["ok"]:
        return {**empty, "ok": False, "error": contacts_out.get("error") or "contacts_failed"}

    rows = (contacts_out.get("data") or {}).get("data") if isinstance(contacts_out.get("data"), dict) else []
    contact = next(
        (c for c in (rows or []) if isinstance(c, dict) and _phones_match(c.get("phone"), phone)),
        None,
    )
    if not contact:
        return empty

    contact_id = contact.get("id")
    conv_out = await _wacrm_get(f"/api/v1/conversations?contact_id={quote(str(contact_id))}&limit=20")
    if not conv_out["ok"]:
        return {**empty, "ok": False, "contact_id": contact_id, "error": conv_out.get("error")}

    conv_rows = (conv_out.get("data") or {}).get("data") if isinstance(conv_out.get("data"), dict) else []
    conv = (conv_rows or [None])[0] if conv_rows else None
    if not isinstance(conv, dict):
        return {**empty, "contact_id": contact_id}

    conv_id = conv.get("id")
    msg_out = await _wacrm_get(f"/api/v1/conversations/{conv_id}/messages?limit=80")
    if not msg_out["ok"]:
        return {
            **empty,
            "ok": False,
            "contact_id": contact_id,
            "conversation_id": conv_id,
            "error": msg_out.get("error"),
        }
    items = (msg_out.get("data") or {}).get("data") if isinstance(msg_out.get("data"), dict) else []
    messages = [_public_message(m) for m in (items or []) if isinstance(m, dict)]
    messages.reverse()
    return {
        "ok": True,
        "enabled": True,
        "phone": phone,
        "conversation_id": conv_id,
        "contact_id": contact_id,
        "messages": messages,
    }


async def send_chat_text(lead: Dict[str, Any], text: str) -> Dict[str, Any]:
    """Send a free-form WhatsApp text via WaCRM POST /api/v1/messages."""
    if not whatsapp_enabled():
        return {"ok": False, "error": "whatsapp_disabled"}
    body = (text or "").strip()
    if not body:
        return {"ok": False, "error": "empty_message"}
    phone = _normalise_phone(lead.get("phone"))
    if not phone:
        return {"ok": False, "error": "no_phone"}
    payload: Dict[str, Any] = {"to": phone, "type": "text", "text": body}
    name = str(lead.get("full_name") or lead.get("name") or "").strip()
    if name:
        payload["name"] = name
    log_id = str(uuid.uuid4())
    outcome = await _post(phone, payload, log_id)
    conversation_id = None
    message_id = None
    raw = outcome.get("response") or ""
    try:
        parsed = json.loads(raw) if raw else {}
        data = parsed.get("data") if isinstance(parsed, dict) else None
        if isinstance(data, dict):
            conversation_id = data.get("conversation_id")
            message_id = data.get("message_id")
    except json.JSONDecodeError:
        parsed = None
    if not outcome.get("ok"):
        return {"ok": False, "error": outcome.get("response") or "send_failed"}
    return {
        "ok": True,
        "conversation_id": conversation_id,
        "message_id": message_id,
        "phone": phone,
    }
