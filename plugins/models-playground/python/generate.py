#!/usr/bin/env python3
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "lib"))
from dex_models import bind_models  # noqa: E402


def pick_model(listed, kind, fallback):
    data = listed.get("data") if isinstance(listed, dict) else None
    if not isinstance(data, list):
        data = []
    for item in data:
        if isinstance(item, dict) and item.get("kind") == kind and isinstance(item.get("id"), str):
            return item["id"]
    return fallback


def main() -> None:
    payload = json.loads(sys.stdin.read() or "{}")
    models = bind_models()
    listed = models.list()
    kind = payload.get("kind") or "chat"
    if kind == "chat":
        prompt = payload.get("prompt") or "用一句话介绍 Dex Buddy"
        body = models.chat.completions.create(
            {
                "model": pick_model(listed, "chat", "dexbuddy-chat"),
                "messages": [{"role": "user", "content": prompt}],
            }
        )
        json.dump(body, sys.stdout, ensure_ascii=False)
        return
    if kind == "image":
        result = models.images.generate(
            {
                "model": pick_model(listed, "image", "dexbuddy-image"),
                "input": {"prompt": payload.get("prompt") or "一只白色独角兽，简约插画"},
                "outputPath": payload["outputPath"],
            }
        )
        json.dump(result, sys.stdout, ensure_ascii=False)
        return
    raise SystemExit("unknown kind")


if __name__ == "__main__":
    main()
