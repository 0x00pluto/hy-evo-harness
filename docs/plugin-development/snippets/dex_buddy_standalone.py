"""Dex Buddy 独立跑默认实现 STANDALONE_VERSION 1.0.3。
与宿主 host-egress 行为对齐；只在本机用 DEX_BUDDY_API_KEY 开发时需要。
工作台走宿主代理，不必拷本文件。实现细节变更只升 STANDALONE_VERSION，不强迫改接口 __version__。
"""

from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from dex_buddy_sdk import (
    DEFAULT_BASE,
    DEFAULT_TIMEOUT,
    MISSING_KEY,
    DexModelsError,
)

STANDALONE_VERSION = "1.0.3"


def _env_map(env: dict[str, str] | None) -> dict[str, str]:
    return dict(os.environ if env is None else env)


def _trim(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _http_timeout(env: dict[str, str]) -> float | None:
    raw = _trim(env.get("DEX_BUDDY_HTTP_TIMEOUT"))
    if not raw:
        return DEFAULT_TIMEOUT
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_TIMEOUT
    if value <= 0:
        return None
    return value


def _timeout_message(timeout: float | None) -> str:
    if timeout is None:
        waited = "0"
    elif timeout == int(timeout):
        waited = str(int(timeout))
    else:
        waited = str(timeout)
    return f"网关读取超时（已等待 {waited} 秒）"


def _from_network_error(err: BaseException, timeout: float | None) -> DexModelsError:
    reason = err.reason if isinstance(err, urllib.error.URLError) else err
    if isinstance(err, TimeoutError) or isinstance(reason, TimeoutError):
        return DexModelsError("NETWORK_ERROR", _timeout_message(timeout), 0)
    if isinstance(err, urllib.error.URLError):
        return DexModelsError("NETWORK_ERROR", str(err.reason or err), 0)
    return DexModelsError("NETWORK_ERROR", str(err), 0)


def _resolve_plugin_id() -> str:
    here = Path(__file__).resolve().parent
    candidates = [here.parent / "plugin.manifest.json", here / "plugin.manifest.json"]
    for file in candidates:
        if not file.is_file():
            continue
        try:
            parsed = json.loads(file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        plugin_id = parsed.get("id") if isinstance(parsed, dict) else None
        if isinstance(plugin_id, str) and plugin_id.strip():
            return plugin_id.strip()
    return ""


def _resolve_reference_upload(options: dict[str, Any] | None) -> str:
    mode = options.get("referenceUpload") if options else None
    if mode is None or mode == "signed":
        return "signed"
    if mode == "direct":
        return "direct"
    raise DexModelsError("INVALID_BODY", "referenceUpload 只能是 signed 或 direct", 400)


def _error_from_body(body: Any, status: int) -> DexModelsError:
    record = body if isinstance(body, dict) else None
    nested = record.get("error") if record else None
    if isinstance(nested, dict) and isinstance(nested.get("message"), str) and nested["message"].strip():
        code = nested["code"] if isinstance(nested.get("code"), str) and nested["code"].strip() else "BAD_RESPONSE"
        return DexModelsError(code, nested["message"], status)
    if record and isinstance(record.get("error"), str) and record["error"].strip():
        code = record["code"] if isinstance(record.get("code"), str) and record["code"].strip() else "BAD_RESPONSE"
        return DexModelsError(code, record["error"], status)
    return DexModelsError("BAD_RESPONSE", f"网关请求失败（{status}）", status)


def _urlopen(req: urllib.request.Request | str, timeout: float | None = DEFAULT_TIMEOUT):
    url = req.full_url if isinstance(req, urllib.request.Request) else req
    handlers = []
    if "127.0.0.1" in url or "localhost" in url:
        handlers.append(urllib.request.ProxyHandler({}))
    opener = urllib.request.build_opener(*handlers)
    return opener.open(req, timeout=timeout)


class _Completions:
    def __init__(self, client: "StandaloneModels") -> None:
        self._client = client

    def create(self, body: Any, options: dict[str, Any] | None = None) -> Any:
        return self._client._post("/v1/chat/completions", body, options)


class _Chat:
    def __init__(self, client: "StandaloneModels") -> None:
        self.completions = _Completions(client)


class _Billing:
    def __init__(self, client: "StandaloneModels") -> None:
        self._client = client

    def quote(self, body: Any, options: dict[str, Any] | None = None) -> Any:
        return self._client._post("/v1/billing/quote", body, options)


class _Images:
    def __init__(self, client: "StandaloneModels") -> None:
        self._client = client

    def generate(self, payload: dict[str, Any], options: dict[str, Any] | None = None) -> Any:
        return self._client._generate_image(payload, options)


class StandaloneModels:
    def __init__(self, env: dict[str, str] | None = None) -> None:
        self._env = _env_map(env)
        self._timeout = _http_timeout(self._env)
        self._plugin_id = _resolve_plugin_id()
        self.chat = _Chat(self)
        self.billing = _Billing(self)
        self.images = _Images(self)

    def list(self) -> Any:
        return self._request("GET", "/v1/models")

    def _gateway(self) -> str:
        return _trim(self._env.get("DEX_GATEWAY_BASE_URL")) or DEFAULT_BASE

    def _headers(self, options: dict[str, Any] | None, json_body: bool) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if json_body:
            headers["Content-Type"] = "application/json"
        key = _trim(self._env.get("DEX_BUDDY_API_KEY"))
        if not key:
            raise DexModelsError("UNAUTHORIZED", MISSING_KEY, 401)
        headers["Authorization"] = f"Bearer {key}"
        if self._plugin_id:
            headers["X-Plugin-Id"] = self._plugin_id
        if options and isinstance(options.get("idempotencyKey"), str):
            token = options["idempotencyKey"].strip()
            if token:
                headers["Idempotency-Key"] = token
        return headers

    def _request(self, method: str, path: str, body: Any = None, options: dict[str, Any] | None = None) -> Any:
        base = self._gateway().rstrip("/")
        url = f"{base}{path if path.startswith('/') else '/' + path}"
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(url, data=data, method=method, headers=self._headers(options, body is not None))
        try:
            with _urlopen(req, self._timeout) as response:
                raw = response.read().decode("utf-8")
                return json.loads(raw) if raw.strip() else None
        except urllib.error.HTTPError as err:
            raw = err.read().decode("utf-8") if err.fp else ""
            parsed: Any = None
            if raw.strip():
                try:
                    parsed = json.loads(raw)
                except json.JSONDecodeError:
                    parsed = None
            raise _error_from_body(parsed, err.code) from err
        except (TimeoutError, urllib.error.URLError) as err:
            raise _from_network_error(err, self._timeout) from err

    def _post(self, path: str, body: Any, options: dict[str, Any] | None) -> Any:
        return self._request("POST", path, body, options)

    def _generate_image(self, payload: dict[str, Any], options: dict[str, Any] | None) -> Any:
        model = _trim(payload.get("model"))
        output_path = _trim(payload.get("outputPath"))
        record = payload.get("input") if isinstance(payload.get("input"), dict) else {}
        prompt = _trim(record.get("prompt"))
        if not model:
            raise DexModelsError("INVALID_BODY", "缺少 model", 400)
        if not prompt:
            raise DexModelsError("INVALID_BODY", "缺少 prompt", 400)
        if not output_path or not os.path.isabs(output_path):
            raise DexModelsError("INVALID_BODY", "outputPath 必须是绝对路径", 400)
        local_images = [
            item.strip()
            for item in (record.get("input_images") or [])
            if isinstance(item, str) and item.strip()
        ]
        reference_upload = _resolve_reference_upload(options) if local_images else "signed"
        file_ids: list[str] = []
        file_urls: list[str] = []
        for file_path in local_images:
            issued = self._upload_reference(file_path, reference_upload)
            if reference_upload == "direct":
                file_ids.append(str(issued["id"]))
                continue
            download_url = issued.get("downloadUrl")
            if not isinstance(download_url, str) or not download_url.strip():
                raise DexModelsError("BAD_RESPONSE", "网关 files 凭证缺少 downloadUrl", 502)
            file_urls.append(download_url.strip())
        body: dict[str, Any] = {"model": model, "prompt": prompt}
        aspect = _trim(record.get("aspect_ratio"))
        if aspect:
            body["aspect_ratio"] = aspect
        if file_urls:
            body["fileUrls"] = file_urls
        if file_ids:
            body["fileIds"] = file_ids
        generated = self._post("/v1/images/generate", body, options)
        download_url = generated.get("downloadUrl") if isinstance(generated, dict) else None
        if not isinstance(download_url, str) or not download_url.strip():
            raise DexModelsError("BAD_RESPONSE", "网关生图结果无效", 502)
        try:
            with _urlopen(download_url, self._timeout) as response:
                data = response.read()
        except (TimeoutError, urllib.error.URLError) as err:
            raise _from_network_error(err, self._timeout) from err
        if not data:
            raise DexModelsError("BAD_RESPONSE", "生成图是空的", 502)
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)
        model_out = generated.get("model") if isinstance(generated, dict) else model
        return {"status": "succeeded", "output": output_path, "model": model_out if isinstance(model_out, str) else model}

    def _upload_reference(self, file_path: str, reference_upload: str) -> dict[str, Any]:
        data = Path(file_path).read_bytes()
        if not data:
            raise DexModelsError("INVALID_BODY", f"参考图是空的：{file_path}", 400)
        content_type = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
        file_key = f"ref:{hashlib.sha256(data).hexdigest()}"
        issued = self._post(
            "/v1/files",
            {"contentType": content_type, "contentLength": len(data)},
            {"idempotencyKey": file_key, "referenceUpload": reference_upload},
        )
        if not isinstance(issued, dict):
            raise DexModelsError("BAD_RESPONSE", "网关 files 凭证无效", 502)
        upload_url = issued.get("uploadUrl")
        token = issued.get("token")
        key = issued.get("key")
        file_id = issued.get("id")
        if not all(isinstance(item, str) and item.strip() for item in (upload_url, token, key, file_id)):
            raise DexModelsError("BAD_RESPONSE", "网关 files 凭证无效", 502)
        boundary = "----DexBuddyForm"
        filename = os.path.basename(file_path) or "image"
        chunks = [
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"token\"\r\n\r\n{token}\r\n".encode("utf-8"),
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"key\"\r\n\r\n{key}\r\n".encode("utf-8"),
            (
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
                f"Content-Type: {content_type}\r\n\r\n"
            ).encode("utf-8")
            + data
            + b"\r\n",
            f"--{boundary}--\r\n".encode("utf-8"),
        ]
        req = urllib.request.Request(
            str(upload_url),
            data=b"".join(chunks),
            method="POST",
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        try:
            with _urlopen(req, self._timeout) as response:
                response.read()
        except urllib.error.HTTPError as err:
            raise DexModelsError("UPSTREAM_ERROR", f"参考图上传失败（{err.code}）", err.code) from err
        except (TimeoutError, urllib.error.URLError) as err:
            raise _from_network_error(err, self._timeout) from err
        return issued


def create_standalone_models(env: dict[str, str] | None = None) -> StandaloneModels:
    return StandaloneModels(env)
