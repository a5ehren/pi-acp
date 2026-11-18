import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { DEFAULT_MAX_MESSAGE_BYTES } from '@agentclientprotocol/sdk/unstable'
import { PassThrough, Writable } from 'node:stream'
import { afterEach, beforeAll, test, vi } from 'vite-plus/test'

type Message = { id: number; method: string }
type Reply = (message: Record<string, unknown>) => void
let runSmoke: (child: ChildProcess) => Promise<void>

beforeAll(async () => {
  const url = new URL('../../scripts/smoke-acp.mjs', import.meta.url)
  const moduleUrl = url.href
  const smoke = (await import(moduleUrl)) as { runSmoke: typeof runSmoke }
  assert.equal(typeof smoke.runSmoke, 'function')
  runSmoke = smoke.runSmoke
})
afterEach(() => vi.useRealTimers())

test('smoke rejects trailing unterminated stdout after valid completion', async () => {
  const server = createChild((message, reply) => {
    normalResponse(message, reply)
    if (message.method === 'session/prompt') server.stdout.write('trailing garbage')
  })
  await assert.rejects(runSmoke(server.child), /Malformed.*stdout/)
})

test('smoke does not count the startup banner as prompt output', async () => {
  const startupInfo = 'pi startup banner'
  const server = createChild((message, reply) => {
    if (message.method === 'session/new') {
      reply({ id: message.id, result: { sessionId: 'smoke-session', _meta: { piAcp: { startupInfo } } } })
    } else if (message.method === 'session/prompt') {
      reply({
        method: 'session/update',
        params: {
          sessionId: 'smoke-session',
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: startupInfo } }
        }
      })
      reply({ id: message.id, result: { stopReason: 'end_turn' } })
    } else normalResponse(message, reply)
  })
  await assert.rejects(runSmoke(server.child), /agent_message_chunk/)
})

test('smoke bounds incomplete stdout frames to the SDK message limit', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const server = createChild(() => {
    server.stdout.write('x'.repeat(DEFAULT_MAX_MESSAGE_BYTES + 1))
  })
  const failed = assert.rejects(runSmoke(server.child), /message size limit/)
  await vi.advanceTimersByTimeAsync(30000)
  await failed
})

test('smoke rejects stdout errors', async () => {
  const server = createChild(() => {})
  const failed = assert.rejects(runSmoke(server.child), /stdout failed/)
  server.stdout.emit('error', new Error('stdout failed'))
  await failed
})

test('smoke rejects an incompatible initialize response', async () => {
  const server = createChild((message, reply) => reply({ id: message.id, result: { protocolVersion: 2 } }))
  await assert.rejects(runSmoke(server.child), /ACP v1/)
})

test('smoke rejects a response with neither result nor error', async () => {
  const server = createChild((message, reply) => reply({ id: message.id }))
  await assert.rejects(runSmoke(server.child), /no result/)
})

function normalResponse(message: Message, reply: Reply) {
  if (message.method === 'initialize') reply({ id: message.id, result: { protocolVersion: 1 } })
  if (message.method === 'session/new') reply({ id: message.id, result: { sessionId: 'smoke-session' } })
  if (message.method === 'session/prompt') {
    reply({
      method: 'session/update',
      params: {
        sessionId: 'smoke-session',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello' } }
      }
    })
    reply({ id: message.id, result: { stopReason: 'end_turn' } })
  }
}

function createChild(handler: (message: Message, reply: Reply) => void = normalResponse, exitCode = 0) {
  const child = new EventEmitter()
  const stdout = new PassThrough()
  const requests: Message[] = []
  const reply: Reply = message => {
    stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
  }
  const stdin = new Writable({
    write(chunk, _encoding, done) {
      const message = JSON.parse(chunk.toString()) as Message
      requests.push(message)
      handler(message, reply)
      done()
    },
    final(done) {
      done()
      queueMicrotask(() => child.emit('close', exitCode, null))
    }
  })
  const kill = vi.fn((signal: string) => {
    child.emit('close', null, signal)
    return true
  })
  return {
    child: Object.assign(child, { stdin, stdout, kill }) as unknown as ChildProcess,
    requests,
    stdout,
    stdin,
    kill
  }
}

test('smoke waits for initialization, session, text and end_turn before clean shutdown', async () => {
  const server = createChild()
  await runSmoke(server.child)
  assert.deepEqual(
    server.requests.map(message => message.method),
    ['initialize', 'session/new', 'session/prompt']
  )
  assert.equal(server.kill.mock.calls.length, 0)
})

test.each(['initialize', 'session/new', 'session/prompt'])('smoke rejects %s RPC errors', async method => {
  const server = createChild((message, reply) => {
    if (message.method === method) reply({ id: message.id, error: { code: -32000, message: 'RPC failed' } })
    else normalResponse(message, reply)
  })
  await assert.rejects(runSmoke(server.child), /RPC.*-32000/)
  assert.equal(server.kill.mock.calls.length, 1)
})

test('smoke rejects an agent that exits before responding', async () => {
  const server = createChild(() => {
    server.child.emit('close', 1, null)
  })
  await assert.rejects(runSmoke(server.child), /exited.*1/)
})

test('smoke rejects a child spawn error', async () => {
  const server = createChild(() => {})
  const failed = assert.rejects(runSmoke(server.child), /spawn failed/)
  server.child.emit('error', new Error('spawn failed'))
  await failed
})

test('smoke rejects malformed stdout', async () => {
  const server = createChild(() => {
    server.stdout.write('not JSON\n')
  })
  await assert.rejects(runSmoke(server.child), /Malformed.*stdout/)
})

test('smoke rejects a response without a session ID', async () => {
  const server = createChild((message, reply) => {
    if (message.method === 'session/new') reply({ id: message.id, result: {} })
    else normalResponse(message, reply)
  })
  await assert.rejects(runSmoke(server.child), /sessionId/)
})

test('smoke rejects a completed prompt without streamed text', async () => {
  const server = createChild((message, reply) => {
    if (message.method === 'session/prompt') reply({ id: message.id, result: { stopReason: 'end_turn' } })
    else normalResponse(message, reply)
  })
  await assert.rejects(runSmoke(server.child), /agent_message_chunk/)
})

test('smoke rejects a prompt that did not reach end_turn', async () => {
  const server = createChild((message, reply) => {
    if (message.method === 'session/prompt') reply({ id: message.id, result: { stopReason: 'cancelled' } })
    else normalResponse(message, reply)
  })
  await assert.rejects(runSmoke(server.child), /end_turn/)
})

test('smoke rejects stdin errors', async () => {
  const server = createChild(() => {})
  const failed = assert.rejects(runSmoke(server.child), /stdin failed/)
  server.stdin.emit('error', new Error('stdin failed'))
  await failed
})

test('smoke rejects a nonzero shutdown after valid responses', async () => {
  const server = createChild(normalResponse, 1)
  await assert.rejects(runSmoke(server.child), /exited.*1/)
})

test('smoke fails after the fixed deadline when an expected response never arrives', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const server = createChild(() => {})
  const failed = assert.rejects(runSmoke(server.child), /30000|timed out|deadline/i)
  await vi.advanceTimersByTimeAsync(30000)
  await failed
  assert.equal(server.kill.mock.calls[0]?.[0], 'SIGTERM')
})

test('smoke escalates cleanup when the agent ignores SIGTERM', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const server = createChild(() => {})
  server.kill.mockImplementation(signal => {
    if (signal === 'SIGKILL') server.child.emit('close', null, signal)
    return true
  })
  const failed = assert.rejects(runSmoke(server.child), /30000|timed out|deadline/i)
  await vi.advanceTimersByTimeAsync(32000)
  await failed
  assert.deepEqual(
    server.kill.mock.calls.map(([signal]) => signal),
    ['SIGTERM', 'SIGKILL']
  )
})
