const session = process.env.SESSION_ID || "copilot-live";
const webBase = process.env.WEB_URL || "http://localhost:3009";
const gatewayBase = process.env.GATEWAY_URL || "http://localhost:8787";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const agentProfiles = {
  "copilot-main": { name: "Copilot", role: "developer", characterClass: "developer", ai: "GPT-5.3-Codex" },
  watcher: { name: "File Watcher", role: "analyst", characterClass: "researcher", ai: "Rule-based FS Observer" },
  terminal: { name: "Terminal", role: "engineer", characterClass: "operator", ai: "Command Runner Policy" },
  tester: { name: "QA Tester", role: "qa", characterClass: "analyst", ai: "Claude-3.5-Sonnet" },
  reviewer: { name: "Code Reviewer", role: "reviewer", characterClass: "mentor", ai: "GPT-4o" },
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
  console.log(`Waiting for ${webBase} to be reachable...`);
  let reachable = false;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${webBase}/api/session-token`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) { reachable = true; break; }
    } catch (e) {
      process.stdout.write(".");
    }
    await sleep(2000);
  }
  if (!reachable) throw new Error(`Timed out waiting for ${webBase}`);
  console.log("\nWeb reachable.");

  const tokenRes = await fetch(`${webBase}/api/session-token`, { cache: "no-store" });
  if (!tokenRes.ok) {
    throw new Error(`session-token failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const tokenData = await tokenRes.json();
  const sig = tokenData.sessionSignature;

  console.log(`Sig: ${sig}`);

  await postJson(`${gatewayBase}/v1/connect`, {
    sessionId: session,
    sig,
    meta: {
      clientName: "Universal Client Simulator",
      aiModel: agentProfiles["copilot-main"].ai,
      agentMap: agentProfiles,
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
    try {
      await postJson(`${gatewayBase}/v1/ingest`, ev, {
        "X-Session-Signature": sig,
      });
    } catch (e) {
      console.warn(`Failed to ingest for ${agentId}: ${e.message}`);
    }
  };

  // Spawn agents
  for (const [id, profile] of Object.entries(agentProfiles)) {
    await sendEv(id, "agent.spawn", profile);
    if (id !== "copilot-main") {
      await sendEv("copilot-main", "agent.link", { parentAgentId: "copilot-main", childAgentId: id });
    }
  }

  console.log("Agents spawned. Starting intensive simulation...");

  while (true) {
    for (const agentId of Object.keys(agentProfiles)) {
      const t = pick(tasks);
      const s = pick(states);
      const p = Math.round((Math.random() * 0.85 + 0.1) * 100) / 100;

      // Update state
      await sendEv(agentId, "agent.state", { state: s, label: t.label, progress: p });
      
      // Update message
      await sendEv(agentId, "agent.message", { text: `Status: ${s} - Task: ${t.label}`, level: "info" });

      // FORCE MOVEMENT
      // Grid is roughly 16x10
      await sendEv(agentId, "agent.position", { 
        x: Math.floor(Math.random() * 12) + 2, 
        y: Math.floor(Math.random() * 6) + 2 
      });

      if (Math.random() < 0.3) {
        await sendEv(agentId, "agent.tool", { name: t.tool, label: t.label, path: t.path });
      }

      // Small jitter for realism
      await sleep(100);
    }
    
    // Global pause between "ticks"
    await sleep(2000);
  }
}

main().catch((err) => {
  console.error(`SIMULATION:ERROR ${err.message}`);
  process.exit(1);
});
