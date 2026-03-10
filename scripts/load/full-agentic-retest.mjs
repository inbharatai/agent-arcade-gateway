const webBase = process.env.WEB_URL || "http://localhost:3000";
const gatewayBase = process.env.GATEWAY_URL || "http://localhost:8787";
const sessionId = process.env.SESSION_ID || `copilot-live-${Date.now().toString(36)}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const agentProfiles = {
  planner: { name: "Planner", ai: "GPT-5.3-Codex", role: "architect", class: "commander", task: "Break down user request into steps" },
  coder: { name: "Coder", ai: "GPT-5.3-Codex", role: "developer", class: "developer", task: "Implement code changes per plan" },
  reviewer: { name: "Reviewer", ai: "GPT-5.3-Codex", role: "reviewer", class: "analyst", task: "Review edits for quality & regressions" },
  terminal: { name: "Terminal", ai: "Command Runner Policy", role: "ops", class: "operator", task: "Execute commands, tests, and builds" },
  watcher: { name: "File Watcher", ai: "Rule-based FS Observer", role: "observer", class: "researcher", task: "Monitor file changes & emit telemetry" },
  deployer: { name: "Deployer", ai: "Release Orchestrator", role: "release", class: "operator", task: "Prepare and verify release rollout" },
};

const allStates = ["idle", "thinking", "reading", "writing", "tool", "waiting", "moving", "error", "done"];
const tools = [
  "read_file", "grep_search", "edit_file", "run_command", "run_tests", "typecheck",
  "build", "inspect_logs", "open_browser", "validate_output", "emit_event",
];
const labels = [
  "Scanning workspace", "Planning patch", "Applying edit", "Running tests", "Investigating failure",
  "Re-running build", "Reviewing diff", "Checking logs", "Publishing status", "Completing task",
];

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${url} -> ${res.status} ${text}`);
  }
  return res.json();
}

async function getJson(url) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function readSseOnce(url, timeoutMs = 2500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok || !res.body) return { ok: false, status: res.status };
    const reader = res.body.getReader();
    const { value } = await reader.read();
    await reader.cancel();
    return { ok: true, bytes: value ? value.byteLength : 0 };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const debugBefore = await getJson(`${gatewayBase}/debug`);

  const capabilities = await getJson(`${gatewayBase}/v1/capabilities`);
  const token = await getJson(`${webBase}/api/session-token`);
  const sig = token.sessionSignature;

  await postJson(`${gatewayBase}/v1/connect`, {
    sessionId,
    sig,
    meta: {
      clientName: "Full Agentic Retest Client",
      aiModel: "GPT-5.3-Codex + mixed runtime",
      agentMap: Object.fromEntries(Object.entries(agentProfiles).map(([k, v]) => [k, v.ai])),
      taskMap: {
        planner: "task decomposition and sequencing",
        coder: "implementation and code edits",
        reviewer: "quality checks and regression scan",
        terminal: "commands, tests, build",
        watcher: "file/watch telemetry",
        deployer: "release and rollout checks",
      },
    },
  });

  const sendEv = async (agentId, type, payload, extraHeaders = {}) => {
    const ev = {
      v: 1,
      ts: Date.now(),
      sessionId,
      agentId,
      type,
      payload,
    };
    await postJson(`${gatewayBase}/v1/ingest`, ev, {
      "X-Session-Signature": sig,
      ...extraHeaders,
    });
  };

  // Simulate cross-origin browser client emit
  await sendEv("planner", "agent.message", { text: "External browser-origin event", level: "info" }, { Origin: "https://client-any-domain.example" });

  // Spawn all agents
  for (const [id, p] of Object.entries(agentProfiles)) {
    await sendEv(id, "agent.spawn", { name: p.name, role: p.role, characterClass: p.class, aiModel: p.ai, task: p.task });
  }

  // Hierarchy links
  await sendEv("planner", "agent.link", { parentAgentId: "planner", childAgentId: "coder" });
  await sendEv("planner", "agent.link", { parentAgentId: "planner", childAgentId: "reviewer" });
  await sendEv("planner", "agent.link", { parentAgentId: "planner", childAgentId: "terminal" });
  await sendEv("planner", "agent.link", { parentAgentId: "planner", childAgentId: "watcher" });
  await sendEv("planner", "agent.link", { parentAgentId: "planner", childAgentId: "deployer" });

  // Session boundaries
  await sendEv("planner", "session.start", { label: "full-agentic-retest" });

  const usage = {};
  for (const id of Object.keys(agentProfiles)) usage[id] = { actions: 0, tools: {} };

  // Stress-like randomized sequence using all event types
  const agentIds = Object.keys(agentProfiles);
  const totalBursts = 80;
  for (let i = 0; i < totalBursts; i++) {
    const agent = pick(agentIds);
    const state = pick(allStates);
    const tool = pick(tools);
    const label = pick(labels);
    const progress = Math.round((Math.random() * 0.9 + 0.05) * 100) / 100;

    await sendEv(agent, "agent.state", { state, label, progress });
    await sendEv(agent, "agent.tool", { name: tool, label, path: `workspace/${tool}` });
    await sendEv(agent, "agent.message", { text: `${agentProfiles[agent].name}: ${label}`, level: state === "error" ? "error" : "info" });
    await sendEv(agent, "agent.position", { x: rand(0, 11), y: rand(0, 7) });

    usage[agent].actions += 1;
    usage[agent].tools[tool] = (usage[agent].tools[tool] || 0) + 1;

    if (Math.random() < 0.2) {
      await sendEv("reviewer", "agent.message", { text: `Review checkpoint #${i + 1}`, level: "info", requiresInput: Math.random() < 0.4 });
    }

    await sleep(rand(60, 180));
  }

  await sendEv("planner", "session.end", { label: "full-agentic-retest" });

  // End all agents
  for (const id of agentIds) {
    await sendEv(id, "agent.end", { reason: "Retest complete", success: true });
  }

  // Validate SSE route responds
  const sseCheck = await readSseOnce(`${gatewayBase}/v1/stream?sessionId=${encodeURIComponent(sessionId)}&sig=${encodeURIComponent(sig)}`);

  const debugAfter = await getJson(`${gatewayBase}/debug`);
  const acceptedDelta = Number(debugAfter.metrics?.publishAccepted || 0) - Number(debugBefore.metrics?.publishAccepted || 0);
  const rejectedDelta = Number(debugAfter.metrics?.publishRejected || 0) - Number(debugBefore.metrics?.publishRejected || 0);
  const authFailDelta = Number(debugAfter.metrics?.authFailures || 0) - Number(debugBefore.metrics?.authFailures || 0);

  console.log(`FULL_RETEST:OK sessionId=${sessionId}`);
  console.log(`CAPABILITIES transport=${JSON.stringify(capabilities.transports)} auth=${JSON.stringify(capabilities.auth)}`);
  console.log(`SSE_CHECK ${JSON.stringify(sseCheck)}`);
  console.log(`METRICS_DELTA accepted=${acceptedDelta} rejected=${rejectedDelta} authFailures=${authFailDelta}`);
  console.log("AGENT_AI_MAP:");
  for (const [id, p] of Object.entries(agentProfiles)) {
    console.log(`- ${id} => ${p.ai}`);
  }
  console.log("AGENT_USAGE:");
  for (const id of agentIds) {
    console.log(`- ${id} actions=${usage[id].actions} tools=${JSON.stringify(usage[id].tools)}`);
  }
}

main().catch((err) => {
  console.error(`FULL_RETEST:ERROR ${err.message}`);
  process.exit(1);
});
