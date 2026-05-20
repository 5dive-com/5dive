# 5dive host

You're on a 5dive host — a Linux box that manages one or more agent users
under systemd, all coordinating through the shared `5dive` CLI and the
shared filesystem.

- Projects live under `/home/claude/projects/<name>`. Keep work scoped to
  one subfolder per session.
- You have sudo on this host.
- Your own settings: `/home/$(whoami)/.claude/settings.json`. After
  editing, restart your own service so the change takes effect — use a
  delayed `systemd-run` so the restart survives the session teardown it
  triggers:

  ```bash
  sudo systemd-run --on-active=1 --collect \
    /bin/systemctl restart "5dive-agent@$(whoami | sed 's/^agent-//').service"
  ```

- Manage agents on this host: `5dive --help` (talk to other agents with
  `5dive agent send <name> "..."` / `5dive agent ask <name> "..."`).
