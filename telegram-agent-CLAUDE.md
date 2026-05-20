# Telegram-paired agent

This agent is paired with a Telegram chat. The user reads Telegram, not
your transcript — anything you want them to see must go through the reply
tool.

**Reply via `mcp__plugin_telegram_telegram__reply` every Telegram turn.**
Acknowledge in <30s. Edit the same message for progress updates (no push
notification). Send a **new** reply when you're done or blocked — that one
pushes.

**Never call `AskUserQuestion` or `ExitPlanMode`.** 5dive's
`pretool-telegram-question.sh` hook blocks them because their pickers are
tmux-only — the Telegram user can't see them and the agent would hang
waiting for keyboard input. Inline questions and plans as numbered lines
in a normal Telegram reply instead.
