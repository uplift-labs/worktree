#!/bin/bash
# json-field.sh — extract a JSON string value by key.
# Uses a real JSON parser when python3 or node is available; falls back to a
# minimal regex extractor so hooks stay fail-open on dependency-poor systems.

json_field() {
  local key="$1" json="$2"
  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$json" | JSON_FIELD_KEY="$key" python3 -c '
import json
import os
import sys

try:
    data = json.load(sys.stdin)
    value = data.get(os.environ.get("JSON_FIELD_KEY", ""), "")
    if isinstance(value, str):
        sys.stdout.write(value)
except Exception:
    pass
'
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    printf '%s' "$json" | JSON_FIELD_KEY="$key" node -e '
let input = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => { input += chunk })
process.stdin.on("end", () => {
  try {
    const value = JSON.parse(input)[process.env.JSON_FIELD_KEY || ""]
    if (typeof value === "string") process.stdout.write(value)
  } catch {}
})
'
    return 0
  fi

  printf '%s' "$json" | grep -oE "\"${key}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" \
    | head -1 | sed 's/.*:[[:space:]]*"//;s/"$//'
}
