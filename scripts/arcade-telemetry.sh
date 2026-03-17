#!/bin/bash
# Arcade Telemetry Helper — sends Claude Code events to the gateway
# Usage: source arcade-telemetry.sh
#   arcade_think "task description"
#   arcade_tool "tool_name"
#   arcade_write "what I'm writing"
#   arcade_done "summary"
#   arcade_error "error message"
#   arcade_spawn_sub "agent-id" "Agent Name" "task"

GW="http://localhost:47890"
SID="copilot-live"
MAIN_AGENT="claude-code-main"

_arcade_post() {
  curl -s -X POST "$GW/v1/ingest" \
    -H "Content-Type: application/json" \
    -d "$1" > /dev/null 2>&1 &
}

arcade_think() {
  _arcade_post '{"type":"agent.state","agentId":"'"$MAIN_AGENT"'","sessionId":"'"$SID"'","payload":{"state":"thinking","task":"'"${1:-thinking}"'"},"meta":{"v":1,"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}}'
  _arcade_post '{"type":"agent.message","agentId":"'"$MAIN_AGENT"'","sessionId":"'"$SID"'","payload":{"text":"'"Task: ${1:-thinking}"'"},"meta":{"v":1,"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}}'
}

arcade_tool() {
  _arcade_post '{"type":"agent.tool","agentId":"'"$MAIN_AGENT"'","sessionId":"'"$SID"'","payload":{"name":"'"${1:-tool}"'","label":"'"${2:-$1}"'"},"meta":{"v":1,"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}}'
}

arcade_write() {
  _arcade_post '{"type":"agent.state","agentId":"'"$MAIN_AGENT"'","sessionId":"'"$SID"'","payload":{"state":"writing","task":"'"${1:-writing code}"'"},"meta":{"v":1,"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}}'
  _arcade_post '{"type":"agent.tool","agentId":"'"$MAIN_AGENT"'","sessionId":"'"$SID"'","payload":{"name":"code_edit","label":"'"${1:-editing}"'"},"meta":{"v":1,"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}}'
}

arcade_read() {
  _arcade_post '{"type":"agent.state","agentId":"'"$MAIN_AGENT"'","sessionId":"'"$SID"'","payload":{"state":"reading","task":"'"${1:-reading file}"'"},"meta":{"v":1,"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}}'
  _arcade_post '{"type":"agent.tool","agentId":"'"$MAIN_AGENT"'","sessionId":"'"$SID"'","payload":{"name":"file_read","label":"'"${1:-reading}"'"},"meta":{"v":1,"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}}'
}

arcade_done() {
  _arcade_post '{"type":"agent.state","agentId":"'"$MAIN_AGENT"'","sessionId":"'"$SID"'","payload":{"state":"idle"},"meta":{"v":1,"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}}'
  _arcade_post '{"type":"agent.message","agentId":"'"$MAIN_AGENT"'","sessionId":"'"$SID"'","payload":{"text":"'"Done: ${1:-completed}"'"},"meta":{"v":1,"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}}'
}

arcade_error() {
  _arcade_post '{"type":"agent.state","agentId":"'"$MAIN_AGENT"'","sessionId":"'"$SID"'","payload":{"state":"error"},"meta":{"v":1,"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}}'
  _arcade_post '{"type":"agent.message","agentId":"'"$MAIN_AGENT"'","sessionId":"'"$SID"'","payload":{"text":"'"Error: ${1:-unknown}"'"},"meta":{"v":1,"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}}'
}

arcade_spawn_sub() {
  local aid="${1:-sub-agent}"
  local name="${2:-Sub Agent}"
  local task="${3:-sub task}"
  _arcade_post '{"type":"agent.spawn","agentId":"'"$aid"'","sessionId":"'"$SID"'","payload":{"name":"'"$name"'","role":"sub-agent","aiModel":"claude-sonnet-4-6","task":"'"$task"'"},"meta":{"v":1,"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}}'
}

arcade_sub_state() {
  local aid="${1:-sub-agent}"
  local state="${2:-thinking}"
  local task="${3:-working}"
  _arcade_post '{"type":"agent.state","agentId":"'"$aid"'","sessionId":"'"$SID"'","payload":{"state":"'"$state"'","task":"'"$task"'"},"meta":{"v":1,"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}}'
}
