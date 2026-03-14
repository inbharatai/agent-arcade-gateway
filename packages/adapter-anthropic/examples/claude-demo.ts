/**
 * Anthropic Claude + Agent Arcade Demo
 *
 * Shows how to auto-visualize Claude API calls in the Arcade dashboard.
 */

// import Anthropic from '@anthropic-ai/sdk'
// import { wrapAnthropic } from '@agent-arcade/adapter-anthropic'
//
// const client = wrapAnthropic(new Anthropic(), {
//   gatewayUrl: 'http://localhost:8787',
//   sessionId: 'claude-demo',
// })
//
// // Non-streaming
// const msg = await client.messages.create({
//   model: 'claude-sonnet-4-20250514',
//   max_tokens: 1024,
//   messages: [{ role: 'user', content: 'What is Agent Arcade?' }],
// })
// console.log(msg.content[0].text)
//
// // Streaming -- tool use and thinking blocks all tracked!
// const stream = await client.messages.create({
//   model: 'claude-sonnet-4-20250514',
//   max_tokens: 4096,
//   stream: true,
//   messages: [{ role: 'user', content: 'Analyze this codebase' }],
//   tools: [{
//     name: 'read_file',
//     description: 'Read a file',
//     input_schema: { type: 'object', properties: { path: { type: 'string' } } },
//   }],
// })
//
// for await (const event of stream) {
//   // All events auto-sent to Arcade gateway
// }
//
// client.arcadeDisconnect()

console.log('Anthropic Claude Adapter Demo')
console.log('Uncomment the code above and add your API key to run')
console.log('All API calls will appear in the Arcade dashboard at http://localhost:3000')
