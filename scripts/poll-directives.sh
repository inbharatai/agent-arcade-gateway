#!/bin/bash
# Poll the gateway for pending directives and print them
# Usage: source poll-directives.sh && poll_once
# Or:   watch_directives  (continuous polling)

GW="http://localhost:47890"

poll_once() {
  local result=$(curl -s "$GW/v1/directives" 2>/dev/null)
  local count=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('directives',[])))" 2>/dev/null || echo "0")

  if [ "$count" != "0" ] && [ "$count" != "" ]; then
    echo "$result" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for d in data.get('directives', []):
    print(f\"[{d['source']}] {d['instruction']}\")
    print(f\"  ID: {d['id']}\")
" 2>/dev/null
    return 0
  fi
  return 1
}

ack_directive() {
  curl -s -X POST "$GW/v1/directives/$1/ack" > /dev/null 2>&1
}

done_directive() {
  curl -s -X POST "$GW/v1/directives/$1/done" > /dev/null 2>&1
}
