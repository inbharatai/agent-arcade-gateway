const session = process.env.SESSION_ID || "copilot-live";
const webBase = process.env.WEB_URL || "http://localhost:3000";
const gatewayBase = process.env.GATEWAY_URL || "http://localhost:8787";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const agentProfiles = {
  "copilot-main": { name: "Copilot", role: "developer", characterClass: "developer", ai: "GPT-5.3-Codex" },
  watcher: { name: "File Watcher", role: "analyst", characterClass: "researcher", ai: "Rule-based FS Observer" },
  terminal: { name: "Terminal", role: "engineer", characterClass: "operator", ai: "Command Runner Policy" },
};

const tasks = [
  { tool: "read_file", label: "Reading packages/web/src/app/page.tsx", path: "packages/web/src/app/page.tsx" },
  { tool: "grep_search", label: "Searching for session-token usage", path: "packages/web/src/**" },
  { tool: "run_tests", label: "Running store test", path: "packages/web/test/store.test.ts" },
  { tool: "edit_file", label: "Patching gateway auth flow", path: "packages/gateway/src/index.ts" },
  { tool: "run_build", label: "Building web app", path: "packages/web" },
  { tool: "inspect_logs", label: "Checking gateway logs", path: "packages/gateway" },
];

const states = ["thinking", "reading", "writing", "tool", "waiting", "moving"];

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

async function main() {
  const tokenRes = await fetch(`${webBase}/api/session-token`, { cache: "no-store" });
  if (!tokenRes.ok) {
    throw new Error(`session-token failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const tokenData = await tokenRes.json();
  const sig = tokenData.sessionSignature;

  await postJson(`${gatewayBase}/v1/connect`, {
    sessionId: session,
    sig,
    meta: {
      clientName: "Universal Client Simulator",
      aiModel: agentProfiles["copilot-main"].ai,
      agentMap: {
        "copilot-main": agentProfiles["copilot-main"].ai,
        watcher: agentProfiles.watcher.ai,
        terminal: agentProfiles.terminal.ai,
      },
      taskMap: {
        "copilot-main": "code reading/writing, search, patching",
        watcher: "workspace monitoring, diff/index scanning",
        terminal: "command execution and logs",
      },
    },
  });

  const sendEv = async (agentId, type, payload) => {
    const ev = {
      v: 1,
      ts: Date.now(),
      sessionId: session,
      agentId,
      type,
      payload,
    };
    await postJson(`${gatewayBase}/v1/ingest`, ev, {
      "X-Session-Signature": sig,
    });
  };

  const usage = {
    "copilot-main": { actions: 0, tools: {} },
    watcher: { actions: 0, tools: {} },
    terminal: { actions: 0, tools: {} },
  };

  await sendEv("copilot-main", "agent.spawn", agentProfiles["copilot-main"]);
  await sendEv("watcher", "agent.spawn", agentProfiles.watcher);
  await sendEv("terminal", "agent.spawn", agentProfiles.terminal);
  await sendEv("copilot-main", "agent.link", { parentAgentId: "copilot-main", childAgentId: "watcher" });
  await sendEv("copilot-main", "agent.link", { parentAgentId: "copilot-main", childAgentId: "terminal" });

  await sendEv("copilot-main", "agent.message", {
    text: `AI model active: ${agentProfiles["copilot-main"].ai}`,
    level: "info",
  });
  await sendEv("watcher", "agent.message", {
    text: `Engine active: ${agentProfiles.watcher.ai}`,
    level: "info",
  });
  await sendEv("terminal", "agent.message", {
    text: `Engine active: ${agentProfiles.terminal.ai}`,
    level: "info",
  });

  for (let i = 0; i < 10; i++) {
    const t = pick(tasks);
    const s = pick(states);
    const p = Math.round((Math.random() * 0.85 + 0.1) * 100) / 100;

    await sendEv("copilot-main", "agent.state", { state: s, label: t.label, progress: p });
    await sendEv("copilot-main", "agent.tool", { name: t.tool, label: t.label, path: t.path });
    await sendEv("copilot-main", "agent.message", { text: `Working on: ${t.label}`, level: "info" });
    usage["copilot-main"].actions += 1;
    usage["copilot-main"].tools[t.tool] = (usage["copilot-main"].tools[t.tool] || 0) + 1;

    if (Math.random() < 0.45) {
      const watchTask = pick([
        { tool: "watch_fs", label: "Detected file change in src/", path: "packages/web/src/**" },
        { tool: "scan_diff", label: "Scanning modified files", path: "packages/**" },
        { tool: "index_update", label: "Refreshing workspace index", path: "packages/web/src" },
      ]);
      await sendEv("watcher", "agent.state", { state: pick(["reading", "tool", "thinking"]), label: watchTask.label, progress: p });
      await sendEv("watcher", "agent.tool", { name: watchTask.tool, label: watchTask.label, path: watchTask.path });
      usage.watcher.actions += 1;
      usage.watcher.tools[watchTask.tool] = (usage.watcher.tools[watchTask.tool] || 0) + 1;
    }

    if (Math.random() < 0.35) {
      const cmd = pick(["npm run test", "bun test", "npm run build", "npm run lint"]);
      await sendEv("terminal", "agent.state", { state: "tool", label: "Running command in terminal", progress: p });
      await sendEv("terminal", "agent.tool", { name: "run_command", label: cmd, path: "terminal" });
      await sendEv("terminal", "agent.message", { text: cmd, level: "info" });
      usage.terminal.actions += 1;
      usage.terminal.tools.run_command = (usage.terminal.tools.run_command || 0) + 1;
    }

    await sleep(Math.floor(Math.random() * 700) + 300);
  }

  await sendEv("copilot-main", "agent.state", { state: "done", label: "All tasks completed", progress: 1 });
  await sendEv("watcher", "agent.end", { reason: "File monitoring complete", success: true });
  await sendEv("terminal", "agent.end", { reason: "Commands executed", success: true });
  await sendEv("copilot-main", "agent.end", { reason: "Human-like run finished", success: true });

  const debugRes = await fetch(`${gatewayBase}/debug`);
  if (!debugRes.ok) {
    throw new Error(`debug fetch failed: ${debugRes.status} ${await debugRes.text()}`);
  }
  const dbg = await debugRes.json();
  const sessions = Array.isArray(dbg.sessions) ? dbg.sessions.length : 0;
  const accepted = Number(dbg.metrics?.publishAccepted || 0);
  console.log(`SIMULATION:OK sessions=${sessions} publishAccepted=${accepted}`);
  console.log("AGENT_AI_MAP:");
  console.log(`- copilot-main => ${agentProfiles["copilot-main"].ai}`);
  console.log(`- watcher => ${agentProfiles.watcher.ai}`);
  console.log(`- terminal => ${agentProfiles.terminal.ai}`);
  console.log("AGENT_USAGE:");
  console.log(`- copilot-main actions=${usage["copilot-main"].actions} tools=${JSON.stringify(usage["copilot-main"].tools)}`);
  console.log(`- watcher actions=${usage.watcher.actions} tools=${JSON.stringify(usage.watcher.tools)}`);
  console.log(`- terminal actions=${usage.terminal.actions} tools=${JSON.stringify(usage.terminal.tools)}`);
}

main().catch((err) => {
  console.error(`SIMULATION:ERROR ${err.message}`);
  process.exit(1);
});
