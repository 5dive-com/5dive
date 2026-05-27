
ensure_state() {
  require_root
  mkdir -p "$STATE_DIR" "$ENV_DIR"
  chown root:claude "$STATE_DIR" "$ENV_DIR"
  chmod 2750 "$STATE_DIR" "$ENV_DIR"
  if [[ ! -f "$REGISTRY" ]]; then
    jq -cn --argjson v "$REGISTRY_SCHEMA_VERSION" \
      '{schemaVersion:$v, agents:{}}' > "$REGISTRY"
  else
    # v0 -> current migration. Pre-version registries had no top-level
    # schemaVersion; stamp it in place. Pure jq so no extra deps needed.
    local current
    current=$(jq -r '.schemaVersion // 0' "$REGISTRY" 2>/dev/null || echo 0)
    if (( current < REGISTRY_SCHEMA_VERSION )); then
      local tmp
      tmp=$(mktemp "${REGISTRY}.XXXXXX")
      jq --argjson v "$REGISTRY_SCHEMA_VERSION" '.schemaVersion = $v' "$REGISTRY" > "$tmp"
      chown root:claude "$tmp"
      chmod 640 "$tmp"
      mv "$tmp" "$REGISTRY"
    fi
  fi
  chown root:claude "$REGISTRY"
  chmod 640 "$REGISTRY"
  # Touch the lock file so flock -x has a target even on first run.
  [[ -f "$REGISTRY_LOCK" ]] || : > "$REGISTRY_LOCK"
  chown root:claude "$REGISTRY_LOCK"
  chmod 640 "$REGISTRY_LOCK"
  # Group-writable tasks/org store (unlike the rest of STATE_DIR, which is
  # root-only): the shared task queue is meant to be used by every agent
  # without sudo. 2770 + setgid keeps the db and its -wal/-shm sidecars
  # owned by group claude and writable across agent users. tasks_db_init
  # (re)applies the schema lazily on first use.
  mkdir -p "$TASKS_DIR"
  chown root:claude "$TASKS_DIR"
  chmod 2770 "$TASKS_DIR"
  audit_init
}

# Initialise the append-only audit log. Readable by group `claude` so the
# dashboard process (which runs as `claude`) can `tail` it without sudo.
