# OSS Launch Tasks

Pre-launch punch list for opening `5dive-cli` to the public. Items are ordered;
work top-down. Each completed task is **deleted** from this file (per the
working agreement). Commit message references the task title so history is
recoverable from `git log`.

Resume prompt: `continue OSS launch tasks from 5dive-cli/OSS_LAUNCH_TASKS.md — pick up the next pending item`

---

## P0 — Auth & expose-to-public (the thing the user asked about)

> Item numbers are stable — completed items are removed but the surviving
> items keep their original IDs so they're easy to refer to in chat / commits.

---

## P2 — UI quality polish (subset of UI_TASKS.md that gates a credible launch)

These reference `ui/UI_TASKS.md` — do not duplicate; mark them done there too.

### 19. UI_TASKS T05 — agent detail full tab set (Config / Pair / Send / Logs)
Logs / Send / Stats / Config tabs landed; remaining gap is a dedicated **Pair** tab (visible when channels=telegram/discord) plus a **Follow** toggle on the Logs tab. Telegram access lives inside Config today — split it out into the Pair tab.

---

## P3 — Day-2 (post-launch, ordered by likely demand)

### 23. Docker `docker run` one-liner for tire-kickers who don't want root install
### 24. `--user` mode (tmux-managed, no systemd)
### 25. Offline / air-gapped install (release tarball + manual steps)
### 26b. UI_TASKS T11 — "Install" button in Health for missing type binaries (T10 health page itself is done)
### 28b. UI_TASKS T12 — telegram auto-discover button (access-list management is done in Config tab)
### 29b. UI_TASKS T13 — mobile polish: confirm modal full-screen + card stacking at narrow widths (sidebar+bottom-tab shell already done)
### 30. OIDC / SSO adapter (Authelia / Authentik compatible)
