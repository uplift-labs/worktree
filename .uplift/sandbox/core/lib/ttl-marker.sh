#!/bin/bash
# ttl-marker.sh — filesystem marker primitives with explicit TTL.
#
# Markers are small files whose mtime acts as a heartbeat and whose first line
# is "<value> <created_epoch> [<initial_head>]". The optional third field is
# the git HEAD of the session's branch at marker creation time — it lets
# lifecycle Phase 3 distinguish "session did work and merged" from "session
# never committed anything" when both leave branch == main.
#
# The TTL is always passed explicitly by the caller — no hardcoded defaults.
# With the heartbeat system (core/lib/heartbeat.sh), mtime is refreshed every
# 1s while the owning process is alive. Lifecycle checks the heartbeat sidecar
# PID (<marker>.hb) before applying TTL — a live heartbeat overrides staleness.
#
# Public functions:
#   sb_marker_safe_id <session-id>                echo safe marker filename
#   sb_marker_path <git-common-dir> <session-id>  echo marker path
#   sb_marker_write <path> <value> [<initial_head>]
#                                                write "<value> <epoch> [<head>]"
#   sb_marker_read_value <path>                  echo first whitespace field
#   sb_marker_read_epoch <path>                  echo second whitespace field
#   sb_marker_read_initial_head <path>           echo third field (empty if legacy)
#   sb_marker_touch <path>                       heartbeat: refresh mtime
#   sb_marker_is_fresh <path> <ttl-seconds>      exit 0 = fresh, 1 = stale/missing
#   sb_marker_prune_stale <glob> <ttl-seconds>   delete stale files matching glob

sb_marker_safe_id() {
  local value="$1"
  printf '%s' "$value" | tr -c 'a-zA-Z0-9-' '-'
}

sb_marker_path() {
  local common="$1" session="$2" safe safe_path legacy_path
  safe=$(sb_marker_safe_id "$session")
  [ -n "$safe" ] || return 1
  safe_path="$common/sandbox-markers/$safe"

  # Backward compatibility for already-live markers written before marker
  # filenames were sanitized. Only consider legacy names that cannot escape the
  # marker directory; new markers are always written to the safe path.
  case "$session" in
    */*|*\\*|.|..) ;;
    *)
      legacy_path="$common/sandbox-markers/$session"
      if [ "$legacy_path" != "$safe_path" ] && [ -f "$legacy_path" ]; then
        printf '%s' "$legacy_path"
        return 0
      fi
      ;;
  esac

  printf '%s' "$safe_path"
}

sb_marker_write() {
  local path="$1" value="$2" initial_head="${3:-}"
  local tmp="$path.tmp.$$"
  # Surface mkdir failures — a silent failure here cascades into worktree
  # loss via lifecycle Phase 2 reaping an unprotected sandbox.
  mkdir -p "$(dirname "$path")" || return 1
  if [ -n "$initial_head" ]; then
    printf '%s %s %s' "$value" "$(date +%s)" "$initial_head" > "$tmp" \
      || { rm -f "$tmp" 2>/dev/null; return 1; }
  else
    printf '%s %s' "$value" "$(date +%s)" > "$tmp" \
      || { rm -f "$tmp" 2>/dev/null; return 1; }
  fi
  # Atomic rename — guarantees the marker is either absent or complete,
  # never partially written even if the process crashes mid-write.
  mv -f "$tmp" "$path" || { rm -f "$tmp" 2>/dev/null; return 1; }
  return 0
}

sb_marker_read_value() {
  local path="$1"
  [ -f "$path" ] || return 1
  awk '{print $1}' "$path" 2>/dev/null
}

sb_marker_read_epoch() {
  local path="$1"
  [ -f "$path" ] || return 1
  awk '{print $2}' "$path" 2>/dev/null
}

sb_marker_read_initial_head() {
  local path="$1"
  [ -f "$path" ] || return 1
  awk '{print $3}' "$path" 2>/dev/null
}

sb_marker_touch() {
  local path="$1"
  [ -f "$path" ] && touch "$path" 2>/dev/null
}

sb_marker_is_fresh() {
  local path="$1" ttl="$2"
  [ -f "$path" ] || return 1
  local mtime now age
  mtime=$(stat -c %Y "$path" 2>/dev/null || stat -f %m "$path" 2>/dev/null || echo 0)
  now=$(date +%s)
  age=$((now - mtime))
  [ "$age" -lt "$ttl" ]
}

sb_marker_prune_stale() {
  local glob="$1" ttl="$2"
  local mins=$(( (ttl + 59) / 60 ))
  local dir pattern
  dir=$(dirname "$glob")
  pattern=$(basename "$glob")
  find "$dir" -maxdepth 1 -name "$pattern" -type f -mmin "+$mins" -delete 2>/dev/null || true
}
