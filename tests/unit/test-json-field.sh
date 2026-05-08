#!/bin/bash
# Unit tests for adapter JSON field extraction with escaped JSON strings.

set -u
SELF="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SELF/../.." && pwd)"
. "$ROOT/tests/lib/assert.sh"

read_field() {
  local lib="$1" key="$2" json="$3"
  bash -c '. "$1"; json_field "$2" "$3"' _ "$lib" "$key" "$json"
}

JSON='{"session_id":"ses-123","file_path":"C:\\Temp\\quoted \"file\".txt","source":"startup"}'
EXPECTED='C:\Temp\quoted "file".txt'

echo "== Claude Code json_field handles escaped strings =="
OUT=$(read_field "$ROOT/adapters/claude-code/lib/json-field.sh" file_path "$JSON")
assert_eq "Claude file_path unescaped" "$EXPECTED" "$OUT"

echo "== Codex json_field handles escaped strings =="
OUT=$(read_field "$ROOT/adapters/codex/lib/json-field.sh" file_path "$JSON")
assert_eq "Codex file_path unescaped" "$EXPECTED" "$OUT"

echo "== missing/non-string fields fail open as empty =="
OUT=$(read_field "$ROOT/adapters/codex/lib/json-field.sh" missing "$JSON")
assert_eq "missing field empty" "" "$OUT"
OUT=$(read_field "$ROOT/adapters/claude-code/lib/json-field.sh" count '{"count":1}')
assert_eq "non-string field empty" "" "$OUT"

test_summary
