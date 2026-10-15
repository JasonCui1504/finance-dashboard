#!/bin/zsh
for n in server refresh; do
  launchctl bootout "gui/$UID/com.finance.dashboard.$n" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/com.finance.dashboard.$n.plist"
done
