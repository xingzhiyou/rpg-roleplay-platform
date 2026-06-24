"""harness forced-function-call 降级兜底测试。

群反馈(uid115):子代理在中转(op/xf/…)上反复「无法解析→回退规则检索」,而同渠道 GM 正常。
根因=子代理发的是强制 function-call 请求,中转对这种「请求形态」回 403/不支持;GM 只发纯
对话所以正常。修复=_openai_function_call 把原来仅对 400 的 tools→json_object 兜底,扩展到
所有「请求形态拒绝」码(400/403/404/405/422),而 401/429/5xx/超时仍向上抛(凭据/限流/上游)。

实测官方 DeepSeek 也对 tools 回 400 → 被该兜底救活 → 正常;故此路径是子代理稳定性的关键缝。
"""
import urllib.error

import pytest

from agents import _harness

TOOL_SCHEMA = {
    "name": "emit_payload",
    "description": "x",
    "input_schema": {"type": "object", "properties": {}},
}


def _patch_common(monkeypatch):
    """打桩 resolve_api_key(给 key + base_url),并把 json_object 兜底替换成哨兵。"""
    import platform_app.user_credentials as uc

    monkeypatch.setattr(
        uc, "resolve_api_key",
        lambda uid, aid: {"key": "k", "base_url_override": "https://relay.example/v1"},
    )
    state = {"json_mode_called": False}

    def fake_json_mode(*a, **kw):
        state["json_mode_called"] = True
        return ("FALLBACK_JSON_OBJECT", {"input_tokens": 0, "output_tokens": 0})

    monkeypatch.setattr(_harness, "_openai_compat_json_mode", fake_json_mode)
    return state


def _raise_http(code):
    def _f(req, *, timeout):
        raise urllib.error.HTTPError(
            getattr(req, "full_url", "http://relay.example/v1/chat/completions"),
            code, "err", None, None,
        )
    return _f


def _call():
    return _harness._openai_function_call(
        "relay", "some-model", "sys prompt", "user prompt",
        TOOL_SCHEMA, 1, 30, 1200,
    )


@pytest.mark.parametrize("code", [400, 403, 404, 405, 422])
def test_tools_shape_reject_falls_back_to_json_mode(monkeypatch, code):
    """请求形态被拒(含中转最常见的 403)→ 自动降级到 json_object 兼容模式,不再硬失败。"""
    state = _patch_common(monkeypatch)
    monkeypatch.setattr(_harness, "_no_redirect_urlopen", _raise_http(code))

    text, _usage = _call()

    assert text == "FALLBACK_JSON_OBJECT", f"HTTP {code} 应降级到 json_object"
    assert state["json_mode_called"] is True


@pytest.mark.parametrize("code", [401, 429, 500, 502, 503])
def test_auth_rate_upstream_errors_raise_not_swallowed(monkeypatch, code):
    """凭据/限流/上游故障一律向上抛,交 provider_errors 分类;绝不静默降级(避免掩盖真因)。"""
    state = _patch_common(monkeypatch)
    monkeypatch.setattr(_harness, "_no_redirect_urlopen", _raise_http(code))

    with pytest.raises(urllib.error.HTTPError):
        _call()

    assert state["json_mode_called"] is False, f"HTTP {code} 不应触发 json_object 降级"
