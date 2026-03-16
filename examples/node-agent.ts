/**
 * Example: Node.js agent emitting telemetry to Agent Arcade
 *
 * Run:
 *   npx tsx examples/node-agent.ts
 *
 * Requires:
 *   npm install socket.io-client
 */

import { AgentArcade } from '../packages/sdk-node/src/index'

async function main() {
  const arcade = new AgentArcade({
    url: 'http://localhost:47890',
    sessionId: 'demo-session',
  })

  // Wait for connection
  await new Promise(r => setTimeout(r, 500))

  // Spawn agents
  const coder = arcade.spawn({ name: 'Coder', role: 'developer' })
  const researcher = arcade.spawn({ name: 'Researcher', role: 'analyst' })

  // Simulate coder workflow
  arcade.state(coder, 'reading', { label: 'Reading requirements…' })
  await sleep(1000)

  arcade.state(coder, 'thinking', { label: 'Planning implementation…', progress: 0.2 })
  await sleep(1500)

  arcade.tool(coder, 'read_file', { label: 'Reading src/app.ts' })
  await sleep(800)

  arcade.state(coder, 'writing', { label: 'Writing new module…', progress: 0.5 })
  await sleep(2000)

  arcade.message(coder, 'Created UserService with CRUD operations')
  await sleep(500)

  arcade.tool(coder, 'write_file', { label: 'Writing src/services/user.ts' })
  await sleep(1000)

  arcade.state(coder, 'done', { label: 'Implementation complete', progress: 1 })

  // Simulate researcher workflow in parallel
  arcade.state(researcher, 'reading', { label: 'Scanning documentation…' })
  await sleep(1200)

  arcade.state(researcher, 'thinking', { label: 'Analyzing API patterns…', progress: 0.4 })
  await sleep(1800)

  arcade.message(researcher, 'Found 3 relevant API patterns in the docs')
  await sleep(500)

  // Link researcher as helper to coder
  arcade.link(researcher, coder)

  arcade.state(researcher, 'done', { label: 'Research complete', progress: 1 })

  // End all agents
  arcade.end(coder, { reason: 'Task complete', success: true })
  arcade.end(researcher, { reason: 'Research delivered', success: true })

  await sleep(1000)
  arcade.disconnect()
  console.log('Done! Check Agent Arcade at http://localhost:47380')
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

main().catch(console.error)
