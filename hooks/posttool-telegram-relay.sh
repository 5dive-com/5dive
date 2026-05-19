#!/usr/bin/env bash
# PostToolUse hook: mid-turn safety net for Telegram-paired claude agents.
# Companion to stop-telegram-reply-check.sh — catches the case where the
# model emits text, runs tool calls, then emits MORE text without ever
# calling mcp__plugin_telegram_telegram__reply. The Stop hook only fires
# once at end-of-turn and (until the state-file integration) could only
# relay one text block. This hook fires after every tool call and relays
# any newly-appeared assistant text immediately so the user sees each
# message as it's produced.
#
# State coordination with the Stop hook:
#   /tmp/5dive-tg-relay-<sha1(transcript_path)>.state  contains
#     "<turn_start_index>|<relayed_text_count>". turn_start_index resets
#     state across turns; relayed_text_count tracks how many of the
#     turn's text blocks have already been pushed to Telegram. Both this
#     hook and the Stop hook read+update this file so they don't double-
#     send.
#
# Logic:
#   1. Brief sleep — let the harness's buffered write of the assistant
#      entry flush before we read the transcript.
#   2. Determine the current turn and pull its text blocks.
#   3. Skip if the turn had no Telegram inbound (nothing to slip on) or
#      if there's no chat_id / no TELEGRAM_BOT_TOKEN.
#   4. If the tool we just observed IS a Telegram tool (reply/react/
#      edit_message), mark all current texts as handled (the model
#      acknowledged via the proper channel — don't re-relay them).
#   5. Otherwise relay every text past the relayed counter, join them
#      with a blank line, prefix "(auto-relay)" so the user can tell the
#      agent slipped. Update the counter.
#
# Wired in $HOME/.claude/settings.json by inc/5dive-cli.sh's
# preseed_claude_agent when channels=telegram. Token from
# TELEGRAM_BOT_TOKEN in the agent's systemd env (see telegram-<name>.env).

set -u
payload=$(cat)

# Allow buffered transcript writes to settle before we read. Node's
# fs.appendFile() is async and the assistant entry can be in-flight when
# the hook fires; 50ms is enough headroom in practice.
sleep 0.05

TG_PREFIX='mcp__plugin_telegram_telegram__'

transcript_path=$(printf '%s' "$payload" | jq -r '.transcript_path // empty' 2>/dev/null)
tool_name=$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null)
[[ -z "$transcript_path" || ! -r "$transcript_path" ]] && exit 0

state_key=$(printf '%s' "$transcript_path" | sha1sum | cut -d' ' -f1)
state_file="/tmp/5dive-tg-relay-${state_key}.state"

# Stale-state GC: > 24h old means a crashed prior session. Drop it so
# stale counts don't suppress relays in a fresh turn.
if [[ -f "$state_file" ]]; then
  age=$(( $(date +%s) - $(stat -c %Y "$state_file" 2>/dev/null || echo 0) ))
  (( age > 86400 )) && rm -f "$state_file" 2>/dev/null || true
fi

analysis=$(jq -s --arg tg "$TG_PREFIX" '
  (
    [range(0; length)] as $idx
    | [
        $idx[] as $i
        | select(.[$i].type == "user" and (.[$i].message.content | type) == "string")
        | $i
      ]
    | last // 0
  ) as $turn_start
  | .[$turn_start:] as $turn
  | {
      turn_start: $turn_start,
      had_telegram_inbound: (
        [ $turn[]
          | select(.type == "user")
          | (.message.content | tostring)
          | contains("source=\"plugin:telegram:telegram\"")
        ] | any
      ),
      texts: (
        [ $turn[]
          | select(.type == "assistant")
          | (.message.content // [])
          | map(select(.type == "text") | .text) | join("\n")
          | select(length > 0)
        ]
      ),
      last_chat_id: (
        [ $turn[]
          | select(.type == "user")
          | (.message.content | tostring)
          | scan("source=\"plugin:telegram:telegram\" chat_id=\"([0-9]+)\"")
          | .[0]
        ] | last // ""
      )
    }
' "$transcript_path" 2>/dev/null)

[[ -z "$analysis" ]] && exit 0

turn_start=$(printf '%s' "$analysis" | jq -r '.turn_start // 0')
had_inbound=$(printf '%s' "$analysis" | jq -r '.had_telegram_inbound // false')
chat_id=$(printf '%s' "$analysis" | jq -r '.last_chat_id // ""')
total_texts=$(printf '%s' "$analysis" | jq -r '.texts | length')

[[ "$had_inbound" == "true" ]] || exit 0
[[ -n "$chat_id" ]] || exit 0

# Load prior state. Mismatched turn_start => new turn => start at 0.
relayed=0
if [[ -f "$state_file" ]]; then
  prev_start=""
  prev_count=""
  IFS='|' read -r prev_start prev_count < "$state_file" 2>/dev/null || true
  if [[ "$prev_start" == "$turn_start" ]]; then
    relayed="${prev_count:-0}"
  fi
fi

# Telegram tool call → model spoke through the proper channel. Mark all
# current texts as handled so neither this hook nor the Stop hook double-
# sends them. Always update state, even with no token (still need the
# bookkeeping for the next hook fire).
if [[ -n "$tool_name" && "$tool_name" == "$TG_PREFIX"* ]]; then
  printf '%s|%s' "$turn_start" "$total_texts" > "$state_file" 2>/dev/null || true
  exit 0
fi

# Non-Telegram tool: relay any new texts past the relayed counter.
[[ -n "${TELEGRAM_BOT_TOKEN:-}" ]] || exit 0
(( total_texts > relayed )) || exit 0

new_text=$(printf '%s' "$analysis" | jq -r --argjson n "$relayed" '
  .texts[$n:] | join("\n\n")
')
trimmed=$(printf '%s' "$new_text" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
[[ -n "$trimmed" ]] || exit 0

text="$trimmed"
if (( ${#text} > 4000 )); then
  text="${text:0:3960}… [truncated; see journalctl on the host]"
fi
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${chat_id}" \
  --data-urlencode "text=${text}" \
  -o /dev/null 2>/dev/null || true

printf '%s|%s' "$turn_start" "$total_texts" > "$state_file" 2>/dev/null || true
exit 0
