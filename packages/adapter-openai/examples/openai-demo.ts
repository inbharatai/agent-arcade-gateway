/**
 * OpenAI + Agent Arcade Demo
 *
 * Shows how to auto-visualize OpenAI API calls in the Arcade dashboard.
 */

// import OpenAI from 'openai'
// import { wrapOpenAI } from '@agent-arcade/adapter-openai'
//
// const client = wrapOpenAI(new OpenAI(), {
//   gatewayUrl: 'http://localhost:47890',
//   sessionId: 'openai-demo',
// })
//
// // Now use client normally -- all calls are visualized!
// const response = await client.chat.completions.create({
//   model: 'gpt-4o',
//   messages: [{ role: 'user', content: 'Explain quantum computing' }],
// })
//
// console.log(response.choices[0].message.content)
//
// // Streaming also works!
// const stream = await client.chat.completions.create({
//   model: 'gpt-4o',
//   messages: [{ role: 'user', content: 'Write a poem' }],
//   stream: true,
// })
// for await (const chunk of stream) {
//   process.stdout.write(chunk.choices[0]?.delta?.content || '')
// }
//
// // Image generation
// const image = await client.images.generate({
//   model: 'dall-e-3',
//   prompt: 'A pixel art arcade machine',
// })
//
// // Cleanup
// client.arcadeDisconnect()

console.log('OpenAI Adapter Demo')
console.log('Uncomment the code above and add your OpenAI API key to run')
console.log('All API calls will appear in the Arcade dashboard at http://localhost:47380')
