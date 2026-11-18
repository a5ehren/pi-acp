import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test, vi } from 'vite-plus/test'
import * as v2 from '@agentclientprotocol/sdk/experimental/v2'
import { connectPiAcpAgent } from '../../src/acp/connection.js'
import { PiRpcProcess } from '../../src/pi-rpc/process.js'
import { FakePiRpcProcess } from '../helpers/fakes.js'

afterEach(() => vi.restoreAllMocks())

test(
  'v2 connector negotiates, acknowledges insertion, streams IDs and completes via state',
  { timeout: 10000 },
  async t => {
    const root = mkdtempSync(join(tmpdir(), 'pi-acp-v2-connection-'))
    const oldHome = process.env.HOME
    process.env.HOME = root
    t.onTestFinished(() => {
      if (oldHome === undefined) delete process.env.HOME
      else process.env.HOME = oldHome
      rmSync(root, { recursive: true, force: true })
    })
    const proc = Object.assign(new FakePiRpcProcess(), {
      getState: async () => ({ model: { provider: 'test', id: 'alpha' }, thinkingLevel: 'medium' }),
      getCommands: async () => [],
      getAvailableModels: async () => ({ models: [{ provider: 'test', id: 'alpha', name: 'Alpha' }] }),
      getAvailableThinkingLevels: async () => ['medium', 'high'],
      setSessionName: async () => {},
      dispose: vi.fn()
    })
    vi.spyOn(PiRpcProcess, 'spawn').mockImplementation(async () => proc as unknown as PiRpcProcess)
    const a = new TransformStream<Uint8Array, Uint8Array>()
    const b = new TransformStream<Uint8Array, Uint8Array>()
    const connection = connectPiAcpAgent(v2.ndJsonStream(b.writable, a.readable))
    const updates: v2.UpdateSessionNotification[] = []
    const client = v2
      .client()
      .onNotification(v2.methods.client.session.update, ({ params }) => {
        updates.push(params)
      })
      .connect(v2.ndJsonStream(a.writable, b.readable))
    t.onTestFinished(async () => {
      connection.close()
      client.close()
      await Promise.all([client.closed, connection.closed])
    })
    const peer = client.agent
    const initialized = await peer.request(v2.methods.agent.initialize, {
      protocolVersion: 2,
      info: { name: 'test', version: '1' },
      capabilities: {}
    })
    assert.equal(initialized.protocolVersion, 2)
    assert.deepEqual(initialized.authMethods ?? [], [])
    const created = await peer.request(v2.methods.agent.session.new, { cwd: root, mcpServers: [] })
    const response = await peer.request(v2.methods.agent.session.prompt, {
      sessionId: created.sessionId,
      prompt: [{ type: 'text', text: 'hello' }],
      idempotencyKey: 'key1'
    })
    assert.ok(response.messageId)
    await vi.waitFor(() => assert.equal(proc.prompts.length, 1))
    const retry = await peer.request(v2.methods.agent.session.prompt, {
      sessionId: created.sessionId,
      prompt: [{ type: 'text', text: 'hello' }],
      idempotencyKey: 'key1'
    })
    assert.equal(retry.messageId, response.messageId)
    assert.equal(proc.prompts.length, 1)
    proc.emit({ type: 'agent_start' })
    proc.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'hello' } })
    proc.emit({ type: 'agent_end', messages: [] })
    proc.emit({ type: 'agent_settled' })
    await vi.waitFor(() =>
      assert.ok(
        updates.some(
          ({ update }) =>
            update.sessionUpdate === 'state_update' && update.state === 'idle' && update.stopReason === 'end_turn'
        )
      )
    )
    const user = updates
      .map(({ update }) => update)
      .find(
        (update): update is Extract<v2.SessionUpdate, { sessionUpdate: 'user_message' }> =>
          update.sessionUpdate === 'user_message'
      )
    assert.ok(user && user.messageId === response.messageId)
    const chunks = updates
      .map(({ update }) => update)
      .filter(
        (update): update is Extract<v2.SessionUpdate, { sessionUpdate: 'agent_message_chunk' }> =>
          update.sessionUpdate === 'agent_message_chunk'
      )
    const assistant = chunks.find(
      update => update.content.type === 'text' && (update.content as { text?: string }).text === 'hello'
    )
    assert.ok(assistant && typeof assistant.messageId === 'string')
    await peer.request(v2.methods.agent.session.close, { sessionId: created.sessionId })
  }
)
