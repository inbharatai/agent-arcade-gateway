# Voice Feedback & Multi-Agent System - Quick Start Guide

This guide shows you how to enable voice feedback and run multiple AI agents in parallel.

## 🎙️ Voice Feedback

### What's Fixed

All agents now announce their actions via voice synthesis:

- ✅ **Console Agent** announces when thinking, writing, and completing tasks
- ✅ **Claude Code Agent** announces tool usage and progress
- ✅ **Multi-Agent System** announces coordination and task distribution
- ✅ **All specialized agents** (Architect, Coder, Tester, etc.) provide voice updates

### How to Enable Voice

1. **Start the system**:
   ```bash
   cd packages/gateway
   bun run dev
   ```

2. **Open the Console**:
   ```bash
   cd packages/web
   bun run dev
   ```

   Navigate to http://localhost:3003

3. **Unlock audio** (Chrome requirement):
   - Click anywhere in the browser window
   - Or type something in the chat input

4. **Enable voice in settings**:
   - Click the ⚙️ settings icon
   - Go to **Audio** tab
   - Ensure "Voice Enabled" is checked
   - Adjust voice volume as needed

### Voice Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Voice Enabled | ✓ | Master switch for voice narration |
| Voice Volume | 70% | Volume for voice announcements (0-100%) |
| Sound Enabled | ✓ | Master audio switch |
| SFX Enabled | ✓ | Sound effects (beeps, chimes) |

### What Agents Say

**Console Agent:**
- "Thinking about your request: [task]"
- "Generating response with Claude Sonnet"
- "Task complete. [summary]"
- "Encountered an error: [error]"

**Claude Code Agent:**
- "Starting task: [instruction]"
- "Using ReadFile"
- "Using BashTool"
- "Task completed successfully"

**Specialized Agents:**
- "Architect ready to assist with system design"
- "Coder using WriteFile"
- "Tester running tests"
- "Reviewer analyzing code quality"

---

## 🤖 Multi-Agent System

### What You Get

5 specialized AI agents that work in parallel:

| Agent | What It Does |
|-------|--------------|
| 🏗️ **Architect** | Plans system design and architecture |
| 💻 **Coder** | Writes and implements code |
| 🧪 **Tester** | Creates and runs tests |
| 🔍 **Reviewer** | Reviews code for quality and security |
| 🐛 **Debugger** | Fixes bugs and troubleshoots issues |

### Quick Start

#### Option 1: Run Everything Together

```bash
cd packages/gateway

# Set environment variables
export GATEWAY_URL=http://localhost:47890
export SESSION_SIGNING_SECRET=your-secret-key-here

# Start gateway + both agent systems
bun run all-agents
```

This starts:
- Gateway server (port 47890)
- Directive Bridge (single-agent tasks)
- Multi-Agent Orchestrator (parallel multi-agent tasks)

#### Option 2: Run Separately

**Terminal 1 - Gateway:**
```bash
cd packages/gateway
bun run dev
```

**Terminal 2 - Single Agent Bridge:**
```bash
cd packages/gateway
export GATEWAY_URL=http://localhost:47890
export SESSION_SIGNING_SECRET=your-secret-key-here
bun run directive-bridge
```

**Terminal 3 - Multi-Agent Orchestrator:**
```bash
cd packages/gateway
export GATEWAY_URL=http://localhost:47890
export SESSION_SIGNING_SECRET=your-secret-key-here
export MAX_PARALLEL_AGENTS=5
bun run multi-agent
```

**Terminal 4 - Web UI:**
```bash
cd packages/web
bun run dev
```

Then open http://localhost:3003

### Using Multi-Agent System

#### Via Console Chat

Just include "multi-agent" or "parallel" in your request:

```
"Use multi-agent system to build a REST API with authentication"
"Execute this in parallel: design, implement, test user registration"
"Multi-agent: create a todo app with database and tests"
```

#### What Happens

1. **Task Decomposition**: Orchestrator analyzes your request
2. **Agent Assignment**: Assigns subtasks to specialized agents
3. **Parallel Execution**: All agents work simultaneously
4. **Voice Updates**: Each agent announces its progress
5. **Result Aggregation**: Combines all outputs into one report

#### Example Flow

**Input:**
```
"Multi-agent: implement user authentication with JWT tokens and write tests"
```

**What You'll See:**

1. 🎯 **Orchestrator**: "Decomposing task into specialized subtasks"
2. 🏗️ **Architect**: "Planning authentication architecture"
3. 💻 **Coder**: "Implementing JWT authentication"
4. 🧪 **Tester**: "Writing authentication tests"
5. 🎯 **Orchestrator**: "Task complete: 3 agents succeeded"

**Watch in Arcade Canvas:**
- All 4 agents appear as characters on screen
- See their states change (thinking → tool → idle)
- Watch progress bars fill up
- Hear each agent's voice announcements

---

## 🎮 Visual Monitoring

### Agent Arcade Canvas

Open the Agent Arcade panel to watch agents work:

1. Navigate to http://localhost:3003
2. Click **🎮 Agent Arcade** button
3. See all active agents as pixel art characters
4. Click an agent to see detailed stats:
   - Current task
   - Tools used
   - Trust score
   - Error count
   - Active time

### Agent States

| State | Visual | Voice |
|-------|--------|-------|
| 💭 Thinking | Blue glow | "Starting my task" |
| 🔧 Tool | Orange flash | "Using [tool name]" |
| ✅ Done | Green pulse | "Task completed successfully" |
| ❌ Error | Red shake | "Error: [message]" |
| ⏳ Waiting | Yellow pulse | "Waiting for input" |

---

## 🔧 Configuration

### Environment Variables

**Gateway & Agents:**
```bash
export GATEWAY_URL=http://localhost:47890
export SESSION_SIGNING_SECRET=your-secret-key-here
export MAX_PARALLEL_AGENTS=5
export AGENT_TIMEOUT_MS=180000
```

**Custom Models:**
```bash
export DIRECTIVE_MODEL=claude-opus-4-6    # Use Opus for single-agent
export ANTHROPIC_API_KEY=sk-ant-...      # Required for Claude CLI
```

### Adjust Agent Behavior

Edit `packages/gateway/src/multi-agent-orchestrator.ts`:

```typescript
// Change agent models
const AGENT_SPECS: AgentSpec[] = [
  {
    id: 'architect-agent',
    name: '🏗️ Architect',
    model: 'claude-opus-4-6', // Use Opus for architecture
    // ...
  },
]

// Change timeouts
const AGENT_TIMEOUT_MS = 300000 // 5 minutes per agent

// Change max parallel agents
const MAX_PARALLEL_AGENTS = 10
```

---

## 🐛 Troubleshooting

### Voice Not Working

**Problem**: No voice announcements

**Solutions**:
1. Click in browser window (Chrome requires user gesture)
2. Check Console settings → Audio → Voice Enabled
3. Check browser console for errors
4. Try in Firefox or Safari (better Web Speech API support)

### Agents Not Spawning

**Problem**: Agents don't appear in Arcade Canvas

**Solutions**:
1. Check gateway is running: `curl http://localhost:47890/health`
2. Verify bridge/orchestrator are running (check terminal for logs)
3. Ensure SESSION_SIGNING_SECRET matches everywhere
4. Check browser console for connection errors

### Multi-Agent Tasks Not Running

**Problem**: Regular agents run but multi-agent doesn't

**Solutions**:
1. Include "multi-agent" or "parallel" in your request
2. Check orchestrator logs: `[multi-agent]` prefix
3. Verify Claude CLI is installed: `claude --version`
4. Check ANTHROPIC_API_KEY is set

### Agents Timeout

**Problem**: "Agent timed out" errors

**Solutions**:
```bash
export AGENT_TIMEOUT_MS=300000  # Increase to 5 minutes
export DIRECTIVE_TIMEOUT_MS=300000
```

---

## 📊 Performance Tips

### Optimize for Speed

```bash
# Use faster Sonnet model
export DIRECTIVE_MODEL=claude-sonnet-4-5

# Reduce parallel agents for complex tasks
export MAX_PARALLEL_AGENTS=3

# Increase timeout for complex operations
export AGENT_TIMEOUT_MS=600000  # 10 minutes
```

### Optimize for Quality

```bash
# Use Opus for better reasoning
export DIRECTIVE_MODEL=claude-opus-4-6

# More agents for comprehensive coverage
export MAX_PARALLEL_AGENTS=5

# Longer timeout for thorough work
export AGENT_TIMEOUT_MS=600000
```

---

## 🚀 Advanced Usage

### Custom Agent Types

Create your own specialized agents in `multi-agent-orchestrator.ts`:

```typescript
const SECURITY_AGENT: AgentSpec = {
  id: 'security-agent',
  name: '🔒 Security Expert',
  role: 'security',
  characterClass: 'guardian',
  specialization: 'Security auditing and vulnerability detection',
  model: 'claude-opus-4-6',
}

AGENT_SPECS.push(SECURITY_AGENT)
```

### Agent-to-Agent Communication (Coming Soon)

```typescript
// Future: Agents can request help from each other
architect.requestHelp('coder-agent', 'Implement this design pattern')
```

### Persistent Agent Memory (Coming Soon)

```typescript
// Future: Agents remember past executions
agent.remember('Last time I used PostgreSQL for this pattern')
```

---

## 📖 Full Documentation

- **Multi-Agent System**: `packages/gateway/MULTI-AGENT.md`
- **Gateway API**: `packages/gateway/README.md`
- **Console UI**: `packages/web/README.md`

---

## ✅ What's Been Fixed

### Voice Feedback ✅
- Console agent announces thinking, writing, completion
- Claude Code agent announces tool usage and progress
- Multi-agent orchestrator announces coordination
- All specialized agents provide voice updates
- Messages use natural language (not generic states)

### Multi-Agent System ✅
- 5 specialized agent types (Architect, Coder, Tester, Reviewer, Debugger)
- Automatic task decomposition based on keywords
- Parallel execution (up to 5 agents simultaneously)
- Result aggregation into comprehensive reports
- Individual voice announcements per agent
- Visual monitoring in Arcade Canvas

### Integration ✅
- All agents appear in Agent Arcade canvas
- Voice synthesis for every agent action
- Coordinated telemetry for multi-agent tasks
- Session signing for secure communication
- Error handling and recovery

---

## 🎉 Try It Now!

1. **Start everything**:
   ```bash
   cd packages/gateway && bun run all-agents
   ```

2. **Open console**:
   ```bash
   cd packages/web && bun run dev
   ```
   Go to http://localhost:3003

3. **Test voice**:
   ```
   "Hello, can you help me?"
   ```
   You should hear: "Thinking about your request: Hello, can you help me?"

4. **Test multi-agent**:
   ```
   "Multi-agent: design and build a todo list app with tests"
   ```

   You'll see:
   - 3+ agents spawn in Arcade Canvas
   - Each agent announces its role
   - Progress updates as they work
   - Final aggregated report

Enjoy your voice-enabled multi-agent AI system! 🚀
