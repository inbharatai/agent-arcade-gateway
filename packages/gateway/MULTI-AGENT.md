# Multi-Agent Orchestration System

The Agent Arcade Gateway now includes a powerful multi-agent orchestration system that coordinates multiple specialized AI agents working in parallel to complete complex tasks.

## Features

- **Specialized Agents**: 5 different agent types with unique expertise
- **Parallel Execution**: Multiple agents work simultaneously
- **Voice Feedback**: Each agent announces what it's doing via voice synthesis
- **Task Decomposition**: Automatically breaks down complex tasks into subtasks
- **Result Aggregation**: Combines outputs from all agents into a comprehensive report

## Agent Types

| Agent | Role | Specialization | Character Class |
|-------|------|----------------|-----------------|
| 🏗️ Architect | Planner | System design and architecture planning | Sage |
| 💻 Coder | Executor | Code implementation and file operations | Warrior |
| 🧪 Tester | Validator | Testing and quality assurance | Scout |
| 🔍 Reviewer | Reviewer | Code review and best practices | Sage |
| 🐛 Debugger | Debugger | Bug fixing and troubleshooting | Healer |

## Setup

### 1. Start the Gateway

```bash
cd packages/gateway
bun run dev
```

### 2. Start the Multi-Agent Orchestrator

In a separate terminal:

```bash
export GATEWAY_URL=http://localhost:47890
export SESSION_SIGNING_SECRET=your-secret-here
export MAX_PARALLEL_AGENTS=5

bun run packages/gateway/src/multi-agent-orchestrator.ts
```

### 3. Start the Directive Bridge (Optional)

For single-agent tasks:

```bash
export GATEWAY_URL=http://localhost:47890
export SESSION_SIGNING_SECRET=your-secret-here

bun run packages/gateway/src/directive-bridge.ts
```

## Usage

### Via Console

1. Open the Arcade Console at http://localhost:3003
2. Type a complex task that requires multiple agents:
   - "Use multi-agent system to implement user authentication"
   - "Execute this in parallel with multiple agents"
   - "Multi-agent: design, implement, and test a new feature"

### Via API

Send a directive to the gateway:

```bash
curl -X POST http://localhost:47890/v1/directives \
  -H "Content-Type: application/json" \
  -d '{
    "instruction": "Multi-agent: Build a REST API with authentication, database integration, and comprehensive tests"
  }'
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_URL` | `http://localhost:47890` | Gateway server URL |
| `SESSION_SIGNING_SECRET` | `""` | Secret for signing session requests |
| `MAX_PARALLEL_AGENTS` | `5` | Maximum agents executing simultaneously |
| `AGENT_TIMEOUT_MS` | `180000` | Timeout per agent in milliseconds (3 min) |
| `ORCHESTRATOR_SESSION_ID` | `multi-agent-session` | Session ID for orchestrator telemetry |

## Task Decomposition

The orchestrator automatically decomposes tasks based on keywords:

- **Design/Architecture/Plan** → Architect Agent
- **Implement/Code/Write/Create** → Coder Agent
- **Test/QA** → Tester Agent
- **Review/Quality/Refactor** → Reviewer Agent
- **Bug/Fix/Debug/Error** → Debugger Agent

Example:
```
Input: "Design and implement user authentication with tests"
Output:
  → Architect: Plan the authentication architecture
  → Coder: Implement the authentication system
  → Tester: Write and run authentication tests
```

## Voice Feedback

Each agent announces its actions via voice synthesis:

- **Spawn**: "Architect ready to assist with system design"
- **Thinking**: "Starting my task"
- **Tool Use**: "Using ReadFile"
- **Success**: "Task completed successfully"
- **Error**: "Error: timeout exceeded"

Voice can be controlled in the Arcade Console settings panel.

## Monitoring

All agents appear in the Agent Arcade visual canvas:

1. Open http://localhost:3003
2. Click the "🎮 Agent Arcade" panel
3. Watch agents appear, execute tasks, and report completion
4. Each agent shows:
   - Name and specialization
   - Current state (thinking/tool/idle/error)
   - Progress indicator
   - Trust score

## Advanced: Custom Agent Specs

Edit `multi-agent-orchestrator.ts` to add custom agents:

```typescript
const CUSTOM_AGENT: AgentSpec = {
  id: 'custom-agent',
  name: '⚡ Custom Agent',
  role: 'specialist',
  characterClass: 'wizard',
  specialization: 'Your custom specialization',
  model: 'claude-opus-4-6', // Use a more powerful model
}

// Add to AGENT_SPECS array
AGENT_SPECS.push(CUSTOM_AGENT)
```

## Troubleshooting

### Agents Not Appearing

1. Check gateway is running: `curl http://localhost:47890/health`
2. Verify orchestrator is running: check console for "[multi-agent]" logs
3. Ensure SESSION_SIGNING_SECRET matches between gateway and orchestrator

### Voice Not Working

1. Click anywhere in the browser to unlock audio (Chrome requirement)
2. Check voice is enabled in Console settings (⚙️ → Audio)
3. Verify `voiceEnabled: true` in browser localStorage

### Agents Timing Out

Increase timeout: `export AGENT_TIMEOUT_MS=300000` (5 minutes)

## Architecture

```
┌─────────────────┐
│  Arcade Console │
│   (Web UI)      │
└────────┬────────┘
         │ HTTP/SSE
         ▼
┌─────────────────┐      ┌──────────────────┐
│     Gateway     │◄────►│ Multi-Agent      │
│   (Express +    │      │ Orchestrator     │
│   Socket.IO)    │      │                  │
└────────┬────────┘      └────────┬─────────┘
         │                         │
         │ Telemetry               │ Claude CLI
         ▼                         ▼
┌─────────────────┐      ┌──────────────────┐
│  Agent Arcade   │      │  5x Specialized  │
│     Canvas      │      │     Agents       │
│  (Pixel Render) │      │  🏗️💻🧪🔍🐛      │
└─────────────────┘      └──────────────────┘
```

## Examples

### Simple Task
```
"Fix the bug in user login"
→ Debugger Agent: Debug and fix issues in user login
```

### Complex Task
```
"Multi-agent: Design a microservices architecture for e-commerce,
implement the order service, write integration tests, and review for
security vulnerabilities"

→ Architect: Plan microservices architecture
→ Coder: Implement order service
→ Tester: Write integration tests
→ Reviewer: Review for security issues
```

### Parallel Research
```
"Research three different database options and recommend the best one"
→ Multiple agents research in parallel
→ Orchestrator aggregates findings
```

## Performance

- **Startup**: ~1-2 seconds per agent
- **Execution**: Parallel (5 agents × 3 min = 3 min total, not 15 min)
- **Memory**: ~200MB per agent process
- **Throughput**: Up to 5 concurrent tasks

## Roadmap

- [ ] AI-powered task decomposition (use LLM to split tasks)
- [ ] Agent-to-agent communication (agents can request help)
- [ ] Dynamic agent spawning (create new agent types on demand)
- [ ] Result synthesis (LLM combines agent outputs intelligently)
- [ ] Failure recovery (retry failed subtasks with different agents)
- [ ] Agent memory persistence (agents remember past executions)

## License

MIT - See main repository LICENSE file
