"""Dex Buddy 插件 SDK 接口层 1.0.4。拷进插件 lib/ 后：
工作台里由 Node 注入 DEX_BUDDY_MODELS_URL，走宿主（谁用谁付钱）。
独立跑再拷同目录的 dex_buddy_standalone.py，用 DEX_BUDDY_API_KEY（开发者付钱）。
__version__ 只表示对外契约；契约没变就不必再拷本文件。
require_entitlement / navigate 在 Python 里始终直接返回；工作台真能力写在 index.js。
不要把 Key 打进 zip。
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

__version__ = "1.0.4"
DEFAULT_BASE = "https://www.dexbuddy.app"
DEFAULT_TIMEOUT = 600.0
MISSING_KEY = (
    "独立运行需要环境变量 DEX_BUDDY_API_KEY（账号里的用户 API Key，dbh_sk_ 开头）。"
    "写进本机 .env，不要放进插件设置，也不要打进 zip。装进 Dex Buddy 后会改走宿主，扣使用者的积分。"
)


class DexModelsError(RuntimeError):
    def __init__(self, code: str, message: str, status: int = 0) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


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
        # 本机代理不要走系统 HTTP_PROXY，否则工作台里的 Python 会卡住。
        handlers.append(urllib.request.ProxyHandler({}))
    opener = urllib.request.build_opener(*handlers)
    return opener.open(req, timeout=timeout)


class _ProxyCompletions:
    def __init__(self, client: "ProxyModels") -> None:
        self._client = client

    def create(self, body: Any, options: dict[str, Any] | None = None) -> Any:
        return self._client._post("/v1/chat/completions", body, options)


class _ProxyChat:
    def __init__(self, client: "ProxyModels") -> None:
        self.completions = _ProxyCompletions(client)


class _ProxyBilling:
    def __init__(self, client: "ProxyModels") -> None:
        self._client = client

    def quote(self, body: Any, options: dict[str, Any] | None = None) -> Any:
        return self._client._post("/v1/billing/quote", body, options)


class _ProxyImages:
    def __init__(self, client: "ProxyModels") -> None:
        self._client = client

    def generate(self, payload: dict[str, Any], options: dict[str, Any] | None = None) -> Any:
        return self._client._post("/images/generate", payload, options)


class ProxyModels:
    """工作台：只转发到 Node 注入的本机代理。"""

    def __init__(self, env: dict[str, str] | None = None) -> None:
        self._env = _env_map(env)
        self._timeout = _http_timeout(self._env)
        self.chat = _ProxyChat(self)
        self.billing = _ProxyBilling(self)
        self.images = _ProxyImages(self)

    def list(self) -> Any:
        return self._request("GET", "/v1/models")

    def _models_url(self) -> str:
        return _trim(self._env.get("DEX_BUDDY_MODELS_URL")).rstrip("/")

    def _headers(self, options: dict[str, Any] | None, json_body: bool) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if json_body:
            headers["Content-Type"] = "application/json"
        if options and isinstance(options.get("idempotencyKey"), str):
            token = options["idempotencyKey"].strip()
            if token:
                headers["Idempotency-Key"] = token
        return headers

    def _request(self, method: str, path: str, body: Any = None, options: dict[str, Any] | None = None) -> Any:
        base = self._models_url()
        if not base:
            raise DexModelsError("UNAUTHORIZED", "宿主模型代理不可用", 401)
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


def bind_models(env: dict[str, str] | None = None) -> Any:
    env_map = _env_map(env)
    if _trim(env_map.get("DEX_BUDDY_MODELS_URL")):
        return ProxyModels(env_map)
    # 懒加载，避免与 standalone 顶层互相 import。
    from dex_buddy_standalone import create_standalone_models

    return create_standalone_models(env_map)


def require_entitlement() -> None:
    return None


def navigate(href: str = "") -> None:
    """独立跑 / Python 子进程无工作台界面，静默成功。真跳转在 Node 里用 SDK navigate(ctx, href)。"""
    return None
