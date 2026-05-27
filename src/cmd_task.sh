
# -------- 5dive task — host-shared task queue --------

_task_usage() {
  cat <<USAGE
5dive task — shared task queue (sqlite at ${STATE_DIR}/tasks/tasks.db)

  5dive task init                                    # one-time root bootstrap of the store
  5dive task add <title...> [--body=<text>] [--priority=low|medium|high|urgent]
                            [--assignee=<agent>] [--parent=<id|DIVE-N>] [--from=<who>]
  5dive task ls [--status=<s>] [--assignee=<agent>] [--mine] [--all]
                                                     # default: open tasks, priority-ordered
  5dive task show <id|DIVE-N>                        # full detail + subtasks + blockers
  5dive task assign <id|DIVE-N> <agent>
  5dive task start  <id|DIVE-N>                      # -> in_progress
  5dive task done   <id|DIVE-N>                      # -> done
  5dive task cancel <id|DIVE-N>                      # -> cancelled
  5dive task block   <id|DIVE-N> --by=<id|DIVE-N>    # add a blocks edge, mark blocked
  5dive task unblock <id|DIVE-N> [--by=<id|DIVE-N>]  # drop edge(s); back to todo if clear
  5dive task rm <id|DIVE-N>                          # delete (cascades subtasks + edges)

  status: todo | in_progress | blocked | done | cancelled
  Any agent (group claude) can run these without sudo. Add --json for machine output.
USAGE
}

cmd_task() {
  [[ $# -gt 0 ]] || { _task_usage; exit "$E_USAGE"; }
  local sub="$1"; shift
  case "$sub" in
    init)            cmd_task_init "$@" ;;
    add|new)         cmd_task_add "$@" ;;
    ls|list)         cmd_task_ls "$@" ;;
    show|view)       cmd_task_show "$@" ;;
    assign)          cmd_task_assign "$@" ;;
    start)           cmd_task_start "$@" ;;
    done|close)      cmd_task_done "$@" ;;
    cancel)          cmd_task_cancel "$@" ;;
    block)           cmd_task_block "$@" ;;
    unblock)         cmd_task_unblock "$@" ;;
    rm|delete)       cmd_task_rm "$@" ;;
    -h|--help|help)  _task_usage ;;
    *) fail "$E_USAGE" "unknown task command: $sub (try: 5dive task --help)" ;;
  esac
}

cmd_task_init() {
  require_root "task init"
  tasks_db_init
  ok "tasks store ready at $TASKS_DB" '{path:$p}' --arg p "$TASKS_DB"
}

cmd_task_add() {
  tasks_db_init
  local body="" priority="medium" assignee="" parent="" from=""
  local -a words=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --body=*)     body="${1#*=}" ;;
      --priority=*) priority="${1#*=}" ;;
      --assignee=*) assignee="${1#*=}" ;;
      --parent=*)   parent="${1#*=}" ;;
      --from=*)     from="${1#*=}" ;;
      --)           shift; words+=("$@"); break ;;
      -*)           fail "$E_USAGE" "unknown flag: $1" ;;
      *)            words+=("$1") ;;
    esac
    shift
  done
  local title="${words[*]:-}"
  [[ -n "$title" ]] || fail "$E_USAGE" "usage: 5dive task add <title...> [--body=] [--priority=] [--assignee=] [--parent=]"
  valid_task_priority "$priority" || fail "$E_VALIDATION" "bad priority '$priority' (low|medium|high|urgent)"
  local parent_sql="NULL"
  if [[ -n "$parent" ]]; then
    resolve_task_id "$parent"; parent_sql="$RESOLVED_TASK_ID"
  fi
  local creator; creator=$(task_actor "$from")
  local id
  id=$(db "INSERT INTO tasks (title, body, priority, assignee, created_by, parent_id)
           VALUES ($(sqlq "$title"), $(sqlq_or_null "$body"), $(sqlq "$priority"),
                   $(sqlq_or_null "$assignee"), $(sqlq "$creator"), ${parent_sql});
           SELECT last_insert_rowid();")
  ok "created DIVE-$id — $title" \
     '{id:($i|tonumber), ident:("DIVE-"+$i), title:$t, priority:$p, assignee:$a, created_by:$c}' \
     --arg i "$id" --arg t "$title" --arg p "$priority" --arg a "${assignee:-}" --arg c "$creator"
}

cmd_task_ls() {
  tasks_db_init
  local status="" assignee="" mine=0 all=0 from=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --status=*)   status="${1#*=}" ;;
      --assignee=*) assignee="${1#*=}" ;;
      --mine)       mine=1 ;;
      --all)        all=1 ;;
      --from=*)     from="${1#*=}" ;;
      -*)           fail "$E_USAGE" "unknown flag: $1" ;;
      *)            fail "$E_USAGE" "unexpected arg: $1" ;;
    esac
    shift
  done
  [[ $mine -eq 1 ]] && assignee=$(task_actor "$from")
  local where="1=1"
  if [[ -n "$status" ]]; then
    valid_task_status "$status" || fail "$E_VALIDATION" "bad status '$status' (todo|in_progress|blocked|done|cancelled)"
    where+=" AND status=$(sqlq "$status")"
  elif [[ $all -ne 1 ]]; then
    where+=" AND status NOT IN ('done','cancelled')"
  fi
  [[ -n "$assignee" ]] && where+=" AND assignee=$(sqlq "$assignee")"
  local order="ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at"
  if (( JSON_MODE )); then
    local rows
    rows=$(dbfmt -json "SELECT id, ident, title, status, priority, assignee, created_by, parent_id, created_at FROM tasks WHERE ${where} ${order};")
    [[ -n "$rows" ]] || rows="[]"
    jq -cn --argjson r "$rows" '{ok:true, data:{tasks:$r}}'
  else
    dbfmt -box "SELECT ident, status, priority, COALESCE(assignee,'-') AS assignee, title FROM tasks WHERE ${where} ${order};"
  fi
}

cmd_task_show() {
  tasks_db_init
  [[ $# -gt 0 ]] || fail "$E_USAGE" "usage: 5dive task show <id|DIVE-N>"
  resolve_task_id "$1"; local id="$RESOLVED_TASK_ID"
  if (( JSON_MODE )); then
    local task subs deps
    task=$(dbfmt -json "SELECT * FROM tasks WHERE id=${id};")
    subs=$(dbfmt -json "SELECT id,ident,title,status FROM tasks WHERE parent_id=${id} ORDER BY id;")
    deps=$(dbfmt -json "SELECT t.id,t.ident,t.title,t.status FROM task_deps d JOIN tasks t ON t.id=d.blocked_by WHERE d.task_id=${id} ORDER BY t.id;")
    [[ -n "$subs" ]] || subs="[]"
    [[ -n "$deps" ]] || deps="[]"
    jq -cn --argjson t "$task" --argjson s "$subs" --argjson b "$deps" \
      '{ok:true, data:{task:($t[0]), subtasks:$s, blocked_by:$b}}'
  else
    dbfmt -line "SELECT ident, title, status, priority, assignee, created_by, parent_id, created_at, started_at, done_at, body FROM tasks WHERE id=${id};"
    local subs
    subs=$(db "SELECT ident||'  ['||status||']  '||title FROM tasks WHERE parent_id=${id} ORDER BY id;")
    [[ -n "$subs" ]] && { echo; echo "subtasks:"; printf '%s\n' "$subs" | indent2; }
    local deps
    deps=$(db "SELECT t.ident||'  ['||t.status||']  '||t.title FROM task_deps d JOIN tasks t ON t.id=d.blocked_by WHERE d.task_id=${id} ORDER BY t.id;")
    [[ -n "$deps" ]] && { echo; echo "blocked by:"; printf '%s\n' "$deps" | indent2; }
  fi
}

cmd_task_assign() {
  tasks_db_init
  [[ $# -ge 2 ]] || fail "$E_USAGE" "usage: 5dive task assign <id|DIVE-N> <agent>"
  resolve_task_id "$1"; local id="$RESOLVED_TASK_ID"
  local who="$2"
  db "UPDATE tasks SET assignee=$(sqlq "$who") WHERE id=${id};"
  ok "DIVE-$id assigned to $who" '{id:($i|tonumber), assignee:$a}' --arg i "$id" --arg a "$who"
}

_task_status_cmd() {
  local newstatus="$1" extra="$2" verb="$3"; shift 3
  tasks_db_init
  [[ $# -gt 0 ]] || fail "$E_USAGE" "usage: 5dive task $verb <id|DIVE-N>"
  resolve_task_id "$1"; local id="$RESOLVED_TASK_ID"
  db "UPDATE tasks SET status=$(sqlq "$newstatus")${extra} WHERE id=${id};"
  ok "DIVE-$id $verb" '{id:($i|tonumber), status:$s}' --arg i "$id" --arg s "$newstatus"
}

cmd_task_start()  { _task_status_cmd in_progress ", started_at=COALESCE(started_at, datetime('now'))" start "$@"; }
cmd_task_done()   { _task_status_cmd done ", done_at=datetime('now')" done "$@"; }
cmd_task_cancel() { _task_status_cmd cancelled ", done_at=datetime('now')" cancel "$@"; }

cmd_task_block() {
  tasks_db_init
  local task="" by=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --by=*) by="${1#*=}" ;;
      -*)     fail "$E_USAGE" "unknown flag: $1" ;;
      *)      [[ -z "$task" ]] && task="$1" || fail "$E_USAGE" "unexpected arg: $1" ;;
    esac
    shift
  done
  [[ -n "$task" && -n "$by" ]] || fail "$E_USAGE" "usage: 5dive task block <id|DIVE-N> --by=<id|DIVE-N>"
  resolve_task_id "$task"; local tid="$RESOLVED_TASK_ID"
  resolve_task_id "$by";   local bid="$RESOLVED_TASK_ID"
  [[ "$tid" != "$bid" ]] || fail "$E_VALIDATION" "a task can't block itself"
  db "INSERT OR IGNORE INTO task_deps (task_id, blocked_by) VALUES (${tid}, ${bid});
      UPDATE tasks SET status='blocked' WHERE id=${tid} AND status NOT IN ('done','cancelled');"
  ok "DIVE-$tid blocked by DIVE-$bid" '{task:($t|tonumber), blocked_by:($b|tonumber)}' --arg t "$tid" --arg b "$bid"
}

cmd_task_unblock() {
  tasks_db_init
  local task="" by=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --by=*) by="${1#*=}" ;;
      -*)     fail "$E_USAGE" "unknown flag: $1" ;;
      *)      [[ -z "$task" ]] && task="$1" || fail "$E_USAGE" "unexpected arg: $1" ;;
    esac
    shift
  done
  [[ -n "$task" ]] || fail "$E_USAGE" "usage: 5dive task unblock <id|DIVE-N> [--by=<id|DIVE-N>]"
  resolve_task_id "$task"; local tid="$RESOLVED_TASK_ID"
  if [[ -n "$by" ]]; then
    resolve_task_id "$by"; local bid="$RESOLVED_TASK_ID"
    db "DELETE FROM task_deps WHERE task_id=${tid} AND blocked_by=${bid};"
  else
    db "DELETE FROM task_deps WHERE task_id=${tid};"
  fi
  db "UPDATE tasks SET status='todo'
      WHERE id=${tid} AND status='blocked'
        AND NOT EXISTS (SELECT 1 FROM task_deps WHERE task_id=${tid});"
  ok "DIVE-$tid unblocked" '{task:($t|tonumber)}' --arg t "$tid"
}

cmd_task_rm() {
  tasks_db_init
  [[ $# -gt 0 ]] || fail "$E_USAGE" "usage: 5dive task rm <id|DIVE-N>"
  resolve_task_id "$1"; local id="$RESOLVED_TASK_ID"
  db "DELETE FROM tasks WHERE id=${id};"
  ok "DIVE-$id deleted" '{id:($i|tonumber), deleted:true}' --arg i "$id"
}
