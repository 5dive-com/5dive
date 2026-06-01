
# -------- self-update (fetch installer + --upgrade, then restart agents) --------
#
# `5dive self-update` is the on-demand counterpart to the managed nightly
# soft-update, for OSS self-hosted boxes that have no scheduler of their own.
# It does two things:
#
#   1. Fetches install.sh and runs `--upgrade` — refreshes the 5dive CLI,
#      5dive-agent-start, hooks, skills, the systemd template, and the plugins
#      (via 5dive-refresh-plugins.sh). This reuses the same installer that
#      `uninstall` shells out to, so there's a single source of truth for
#      "what gets updated" rather than a second copy that drifts.
#
#   2. Restarts every running agent so the refreshed plugins/CLIs actually
#      load. A live agent keeps its old plugin (and shared CLI binary) in
#      memory until it restarts — that's the usual reason a plugin "still
#      shows the old version" after an upgrade.
#
# The agent AI CLIs themselves (claude/codex/grok/antigravity) self-update via
# their own vendor autoupdaters; the restart in step 2 is what loads the latest
# shared binary into each agent. Managed boxes have their own scheduler so they
# don't need this, but running it there is harmless — `--upgrade` and the
# restart loop are both idempotent.

# json_array <items...> — emit a compact JSON string array, "[]" when empty.
# Guards the empty-array case (printf with no args would otherwise emit a stray
# empty element).
json_array() {
  if [[ $# -eq 0 ]]; then
    echo '[]'
  else
    printf '%s\n' "$@" | jq -R . | jq -cs .
  fi
}

cmd_self_update() {
  [[ $# -eq 0 ]] || fail "$E_USAGE" "self-update takes no arguments"
  command -v curl >/dev/null 2>&1 || fail "$E_NOT_FOUND" "curl is required for 5dive self-update"

  local installer
  installer=$(mktemp) || fail "$E_GENERIC" "failed to create temp file"
  # shellcheck disable=SC2064
  trap "rm -f '$installer'" RETURN

  step "Fetching installer"
  curl -fsSL "https://raw.githubusercontent.com/5dive-com/5dive/main/install.sh" -o "$installer" \
    || fail "$E_GENERIC" "failed to fetch installer"

  step "Upgrading 5dive CLI + plugins"
  # Send installer chatter to stderr so JSON stdout stays parseable.
  bash "$installer" --upgrade >&2 || fail "$E_GENERIC" "upgrade failed"

  # Restart running agents so the refreshed plugins/CLIs load. Best-effort per
  # unit — one failed restart shouldn't abort the rest.
  local -a restarted=() failed=()
  local unit name
  if command -v systemctl >/dev/null 2>&1; then
    while read -r unit; do
      [[ -z "$unit" ]] && continue
      name="${unit#5dive-agent@}"; name="${name%.service}"
      if systemctl restart "$unit" 2>/dev/null; then
        step "restarted $name"
        restarted+=("$name")
      else
        warn "failed to restart agent '$name'"
        failed+=("$name")
      fi
    done < <(systemctl list-units '5dive-agent@*' --state=running --no-legend --plain 2>/dev/null | awk '{print $1}')
  fi

  local r f prose
  r=$(json_array "${restarted[@]}")
  f=$(json_array "${failed[@]}")
  prose="self-update complete — ${#restarted[@]} agent(s) restarted"
  (( ${#failed[@]} )) && prose+=", ${#failed[@]} failed to restart"
  ok "$prose" \
     '{restarted:$r, restarted_count:($r|length), failed:$f}' \
     --argjson r "$r" --argjson f "$f"
}
