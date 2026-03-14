/**
 * LangChain + Agent Arcade Demo
 *
 * Shows how to visualize LangChain chains in the Arcade dashboard.
 */

import { createArcadeCallback } from '../src'

async function main() {
  // 1. Create the Arcade callback
  const cb = createArcadeCallback({
    gatewayUrl: 'http://localhost:8787',
    sessionId: `langchain-demo-${Date.now()}`,
    agentNamePrefix: 'LC',
  })

  console.log('Agent Arcade LangChain adapter ready!')
  console.log('Open http://localhost:3000 to see your agents')

  // 2. Use with any LangChain chain:
  //
  // import { ChatOpenAI } from '@langchain/openai'
  // import { ChatPromptTemplate } from '@langchain/core/prompts'
  // import { StringOutputParser } from '@langchain/core/output_parsers'
  //
  // const model = new ChatOpenAI({ model: 'gpt-4o' })
  // const prompt = ChatPromptTemplate.fromMessages([
  //   ['system', 'You are a helpful assistant.'],
  //   ['human', '{input}'],
  // ])
  // const chain = prompt.pipe(model).pipe(new StringOutputParser())
  //
  // const result = await chain.invoke(
  //   { input: 'What is Agent Arcade?' },
  //   { callbacks: [cb] }
  // )
  // console.log(result)

  // 3. Simulate events for testing without LangChain installed
  const arcade = cb.getArcade()
  const agentId = arcade.spawn({ name: 'GPT-4o', role: 'chat' })

  arcade.state(agentId, 'thinking', { label: 'Processing prompt...' })
  await sleep(1000)

  arcade.state(agentId, 'writing', { label: 'Generating response...' })
  await sleep(2000)

  arcade.tool(agentId, 'web_search', { label: 'Searching for Agent Arcade' })
  await sleep(1500)

  arcade.state(agentId, 'writing', { label: 'Finishing response...' })
  await sleep(1000)

  arcade.end(agentId, { reason: 'Response complete', success: true })

  console.log('Demo complete! Check the dashboard.')

  // 4. Cleanup
  cb.disconnect()
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

main().catch(console.error)
