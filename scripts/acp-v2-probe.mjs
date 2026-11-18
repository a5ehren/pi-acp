import crossSpawn from 'cross-spawn'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { client, methods, ndJsonStream } from '@agentclientprotocol/sdk/experimental/v2'

const DEADLINE_MS = 30_000

async function build() {
  await new Promise((resolveBuild, reject) => {
    const build = crossSpawn('pnpm', ['run', 'build'], { stdio: 'inherit', cwd: process.cwd(), timeout: DEADLINE_MS })
    build.on('error', reject)
    build.on('close', (code, signal) =>
      code === 0 ? resolveBuild() : reject(new Error(`build failed: ${code ?? signal}`))
    )
  })
}

async function main() {
  await build()
  const child = crossSpawn(process.execPath, ['dist/index.js'], { stdio: ['pipe', 'pipe', 'inherit'] })
  const updates = []
  let text = ''

  const toAgent = new ReadableStream({
    start(controller) {
      child.stdout.on('data', chunk => controller.enqueue(new Uint8Array(chunk)))
      child.stdout.on('end', () => {
        try {
          controller.close()
        } catch {
          // The connection already closed the stream.
        }
      })
    }
  })
  const fromAgent = new WritableStream({
    write(chunk) {
      child.stdin.write(chunk)
    }
  })

  const connection = client()
    .onNotification(methods.client.session.update, ({ params }) => {
      updates.push(params.update)
      if (params.update.sessionUpdate === 'agent_message_chunk' && params.update.content.type === 'text') {
        text += params.update.content.text
        process.stdout.write(params.update.content.text)
      }
    })
    .connect(ndJsonStream(fromAgent, toAgent))
  const deadline = setTimeout(() => {
    child.kill('SIGKILL')
    console.error('\nACP v2 probe timed out')
    process.exitCode = 1
  }, DEADLINE_MS)

  try {
    const initialized = await connection.agent.request(methods.agent.initialize, {
      protocolVersion: 2,
      info: { name: 'pi-acp-probe', version: '1' },
      capabilities: {}
    })
    if (initialized.protocolVersion !== 2) throw new Error(`expected ACP v2, negotiated ${initialized.protocolVersion}`)
    console.log(`protocolVersion: ${initialized.protocolVersion}`)

    const session = await connection.agent.request(methods.agent.session.new, {
      cwd: process.cwd(),
      mcpServers: []
    })
    const receipt = await connection.agent.request(methods.agent.session.prompt, {
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: process.argv.slice(2).join(' ') || 'Say hello in one short sentence.' }],
      idempotencyKey: 'acp-v2-probe'
    })
    console.log(`\nmessageId: ${receipt.messageId}`)

    const settled = await Promise.race([
      (async () => {
        for (;;) {
          const state = updates.find(update => update.sessionUpdate === 'state_update' && update.state === 'idle')
          const notice = updates.find(update => update.sessionUpdate === 'notice' && update.severity === 'error')
          if (notice) throw new Error(notice.title)
          if (state) return state
          await new Promise(resolveWait => setTimeout(resolveWait, 50))
        }
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('turn did not finish')), DEADLINE_MS))
    ])
    if (settled.stopReason !== 'end_turn') throw new Error(`turn stopped: ${settled.stopReason}`)
    if (!text.trim()) throw new Error('no assistant text streamed')

    await connection.agent.request(methods.agent.session.close, { sessionId: session.sessionId })
    console.log('\nACP v2 probe passed')
  } finally {
    clearTimeout(deadline)
    connection.close()
    child.kill()
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
