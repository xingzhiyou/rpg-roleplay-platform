from __future__ import annotations

import asyncio
import json


class _JsonRequest:
    def __init__(self, body: dict):
        self._body = body

    async def json(self):
        return self._body


def test_chunk_upload_import_does_not_validate_title_as_filename(monkeypatch):
    from platform_app.api import scripts as scripts_api

    calls: list[dict] = []

    def fake_import_script(user_id, file_item, **kwargs):
        calls.append({"user_id": user_id, "file_item": file_item, **kwargs})
        return {"script_id": 123, "chapter_count": 1}

    monkeypatch.setattr(scripts_api.script_import, "import_script", fake_import_script)

    response = asyncio.run(scripts_api.api_import_script(
        _JsonRequest({
            "upload_id": "upload_smoke_id",
            "title": "剧本标题没有后缀",
            "split_rule": "auto",
            "custom_pattern": "",
        }),
        user={"id": 7},
    ))

    assert response.status_code == 200
    assert json.loads(response.body)["script_id"] == 123
    assert calls == [{
        "user_id": 7,
        "file_item": {},
        "split_rule": "auto",
        "custom_pattern": "",
        "title": "剧本标题没有后缀",
        "upload_id": "upload_smoke_id",
    }]
