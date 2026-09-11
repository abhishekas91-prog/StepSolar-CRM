"""Unit tests for WaCRM payload / E.164 phone normalisation."""
import os

import pytest

from services import whatsapp_service as wa


@pytest.fixture(autouse=True)
def _reset_runtime(monkeypatch):
    wa.set_runtime_config(None)
    for key in (
        "CUSTOM_WHATSAPP_API_URL",
        "CUSTOM_WHATSAPP_API_KEY",
        "WHATSAPP_AUTH_MODE",
        "WHATSAPP_PAYLOAD_TEMPLATE",
    ):
        monkeypatch.delenv(key, raising=False)
    yield
    wa.set_runtime_config(None)


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("9876543210", "+919876543210"),
        ("+91 98765 43210", "+919876543210"),
        ("919876543210", "+919876543210"),
        ("09876543210", "+919876543210"),
        ("+14155550123", "+14155550123"),
        ("0014155550123", "+14155550123"),
        ("", ""),
        (None, ""),
        ("0000", ""),
    ],
)
def test_normalise_phone_e164(raw, expected):
    assert wa._normalise_phone(raw) == expected


def test_default_payload_is_wacrm_shape():
    lead = {"id": "abc", "code": "SSE-0001", "full_name": "Rakesh Prasad", "phone": "9876543210"}
    payload = wa.build_payload(lead, "DOCUMENT_SENT", {"message": "Your quotation is ready."})
    assert payload == {
        "to": "+919876543210",
        "type": "text",
        "text": "Your quotation is ready.",
        "name": "Rakesh Prasad",
    }
    assert "phone" not in payload
    assert "id" not in payload
    assert "recipient" not in payload


def test_default_payload_includes_https_media():
    lead = {"full_name": "Asha", "phone": "9123456789"}
    payload = wa.build_payload(
        lead,
        "DOCUMENT_SENT",
        {
            "message": "Invoice attached",
            "media_url": "https://cdn.example.com/inv.pdf",
            "filename": "invoice.pdf",
        },
    )
    assert payload["type"] == "document"
    assert payload["media_url"] == "https://cdn.example.com/inv.pdf"
    assert payload["filename"] == "invoice.pdf"
    assert payload["to"] == "+919123456789"


def test_default_url_is_wacrm_without_env():
    assert wa.whatsapp_api_url() == wa.WACRM_MESSAGES_URL


def test_empty_env_url_disables():
    os.environ["CUSTOM_WHATSAPP_API_URL"] = ""
    assert wa.whatsapp_api_url() == ""
    assert wa.whatsapp_enabled() is False


def test_enabled_requires_api_key():
    os.environ["CUSTOM_WHATSAPP_API_URL"] = wa.WACRM_MESSAGES_URL
    assert wa.whatsapp_enabled() is False
    os.environ["CUSTOM_WHATSAPP_API_KEY"] = "wacrm_live_testkey"
    assert wa.whatsapp_enabled() is True


def test_auth_none_enables_without_key():
    os.environ["CUSTOM_WHATSAPP_API_URL"] = wa.WACRM_MESSAGES_URL
    os.environ["WHATSAPP_AUTH_MODE"] = "none"
    assert wa.whatsapp_enabled() is True


def test_payload_template_placeholders():
    os.environ["WHATSAPP_PAYLOAD_TEMPLATE"] = (
        '{"to":"{{phone}}","type":"text","text":"{{message}}","name":"{{customer_name}}"}'
    )
    lead = {"full_name": "Neha", "phone": "8877665544"}
    payload = wa.build_payload(lead, "LEAD_CAPTURED", {"message": "Hello"})
    assert payload == {
        "to": "+918877665544",
        "type": "text",
        "text": "Hello",
        "name": "Neha",
    }


def test_provider_error_message_parses_wacrm():
    raw = '{"error":{"code":"unauthorized","message":"Missing or invalid API key"}}'
    assert wa._provider_error_message(raw) == "Missing or invalid API key"


def test_wacrm_origin_strips_messages_path():
    os.environ["CUSTOM_WHATSAPP_API_URL"] = "https://whatsapp.stepsolar.in/api/v1/messages"
    assert wa.wacrm_origin() == "https://whatsapp.stepsolar.in"


def test_wacrm_origin_prefers_runtime_base():
    wa.set_runtime_config({"wacrm_base_url": "https://whatsapp.stepsolar.in"})
    assert wa.wacrm_origin() == "https://whatsapp.stepsolar.in"
