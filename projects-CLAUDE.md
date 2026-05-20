# System

- Each subfolder in `/home/claude/projects/` is an independent project — keep
  work scoped to one subfolder per session and don't reach across.
- Agents have superuser privileges on this host — use `sudo` when needed.
- To switch **your own** model / effort / verbosity: edit your own user-level
  settings file (NOT the shared projects-level settings file, which would
  clobber other agents on the host). Each agent runs as `agent-<name>` under
  the `5dive-agent@<name>.service` systemd template, so the file is:

  ```bash
  $EDITOR /home/$(whoami)/.claude/settings.json
  ```

  Then restart your own service. Use a delayed `systemd-run` so the restart
  survives the session teardown that the restart itself triggers:

  ```bash
  sudo systemd-run --on-active=1 --collect \
    /bin/systemctl restart "5dive-agent@$(whoami | sed 's/^agent-//').service"
  ```

  Confirm the change with the user before you exit; the unit fires ~1s later.

# Telegram-paired agents

If this agent was created with `--channels=telegram`, the user only sees
output that goes through the Telegram bot — never your transcript.

**CRITICAL:** Reply via `mcp__plugin_telegram_telegram__reply` on every
Telegram turn. Acknowledge in <30s, edit the same message for progress
updates (no push notification), send a **new** reply when done (pushes).

Never call `AskUserQuestion` or `ExitPlanMode` — 5dive's
`pretool-telegram-question.sh` hook blocks them (they render a tmux-only
picker the Telegram user can't see, and the agent would block forever
waiting for keyboard input). Inline questions / plans as numbered lines
in a normal Telegram reply instead.

# Inter-agent messaging

Any agent can talk to any other agent on this host via:

```bash
sudo 5dive agent send <name> "<message>"     # fire-and-forget
sudo 5dive agent ask  <name> "<question>"    # waits for a reply
```

Use `sudo 5dive agent list` to see who's running.

# Proactive memory

Save important context as you learn it (the auto-memory system persists
across sessions). Don't re-derive things you already wrote down.
