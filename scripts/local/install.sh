#!/bin/zsh
# Run this yourself. Installs launchd agents for the local-only dashboard:
#   com.finance.dashboard.server  - `next start` on 127.0.0.1:3100 at login
#   com.finance.dashboard.refresh - daily price refresh at 17:00 local time
#                                   (runs at next wake if the Mac was asleep)
#   com.finance.dashboard.llm     - the assistant's own Ollama server on
#                                   127.0.0.1:11435, cloud features off
#                                   (only if ~/.finance-ollama/bin/ollama is
#                                   installed — see README "Assistant")
# Remove them with scripts/local/uninstall.sh.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NPM="$(which npm)"; NODEDIR="$(dirname "$(which node)")"
AGENTS="$HOME/Library/LaunchAgents"; LOGS="$HOME/Library/Logs"
mkdir -p "$AGENTS"

# One-time: secret that authorizes the refresh script against the local server.
grep -q '^CRON_SECRET=' "$ROOT/.env.local" || \
  printf '\nCRON_SECRET=%s\n' "$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" >> "$ROOT/.env.local"

cd "$ROOT" && npm run build

cat > "$AGENTS/com.finance.dashboard.server.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.finance.dashboard.server</string>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$NODEDIR:/usr/bin:/bin</string></dict>
  <key>ProgramArguments</key><array>
    <string>$NPM</string><string>run</string><string>start</string><string>--</string>
    <string>-H</string><string>127.0.0.1</string><string>-p</string><string>3100</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOGS/finance-server.log</string>
  <key>StandardErrorPath</key><string>$LOGS/finance-server.log</string>
</dict></plist>
PLIST

cat > "$AGENTS/com.finance.dashboard.refresh.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.finance.dashboard.refresh</string>
  <key>ProgramArguments</key><array><string>$ROOT/scripts/local/refresh.sh</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>17</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$LOGS/finance-refresh.log</string>
  <key>StandardErrorPath</key><string>$LOGS/finance-refresh.log</string>
</dict></plist>
PLIST

# The assistant's model server: the official standalone Ollama build in its
# own directory (doesn't self-update; one stable path for the firewall rule),
# loopback only, Ollama cloud models and web search disabled, and its own
# model directory so it's separate from any Ollama.app install. Flash
# attention and an 8-bit KV cache halve the memory the long context needs
# (the assistant sends the whole database, up to llama3.1's 128k tokens).
OLLAMA="$HOME/.finance-ollama/bin/ollama"
AGENT_NAMES=(server refresh)
if [[ -x $OLLAMA ]]; then
  LLM_MODELS="$HOME/.finance-ollama/models"
  mkdir -p "$LLM_MODELS"
  cat > "$AGENTS/com.finance.dashboard.llm.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.finance.dashboard.llm</string>
  <key>EnvironmentVariables</key><dict>
    <key>OLLAMA_HOST</key><string>127.0.0.1:11435</string>
    <key>OLLAMA_NO_CLOUD</key><string>1</string>
    <key>OLLAMA_MODELS</key><string>$LLM_MODELS</string>
    <key>OLLAMA_FLASH_ATTENTION</key><string>1</string>
    <key>OLLAMA_KV_CACHE_TYPE</key><string>q8_0</string>
  </dict>
  <key>ProgramArguments</key><array><string>$OLLAMA</string><string>serve</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOGS/finance-llm.log</string>
  <key>StandardErrorPath</key><string>$LOGS/finance-llm.log</string>
</dict></plist>
PLIST
  AGENT_NAMES+=(llm)
else
  echo "$OLLAMA not found; skipping the assistant's model server (see README \"Assistant\")."
fi

for n in $AGENT_NAMES; do
  launchctl bootout "gui/$UID/com.finance.dashboard.$n" 2>/dev/null || true
  # bootout returns before the old job is fully gone; bootstrapping too soon
  # fails with "Bootstrap failed: 5: Input/output error".
  for _ in {1..50}; do
    launchctl print "gui/$UID/com.finance.dashboard.$n" >/dev/null 2>&1 || break
    sleep 0.2
  done
  launchctl bootstrap "gui/$UID" "$AGENTS/com.finance.dashboard.$n.plist"
done
echo "Dashboard: http://127.0.0.1:3100/dashboard"
