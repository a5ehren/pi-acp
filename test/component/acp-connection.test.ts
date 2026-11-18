import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { client, methods, ndJsonStream, type SessionNotification } from '@agentclientprotocol/sdk/unstable'
import { afterEach, test, vi, type TestContext } from 'vite-plus/test'
import { connectPiAcpAgent } from '../../src/acp/connection.js'
import * as paths from '../../src/acp/paths.js'
import { PiRpcProcess } from '../../src/pi-rpc/process.js'
import { FakePiRpcProcess } from '../helpers/fakes.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

async function setup(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'pi-acp-sdk-'))
  const cwd = join(root, 'project')
  const agentDir = join(root, 'agent')
  const sessionFile = join(agentDir, 'sessions', 'project', 'session.jsonl')
  mkdirSync(cwd)
  mkdirSync(join(agentDir, 'sessions', 'project'), { recursive: true })
  writeFileSync(
    sessionFile,
    JSON.stringify({ type: 'session', id: 'sdk-session', cwd, timestamp: new Date().toISOString() }) + '\n'
  )
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDir)
  vi.spyOn(paths, 'getPiAcpSessionMapPath').mockReturnValue(join(root, 'session-map.json'))
  const state = {
    sessionId: 'sdk-session',
    sessionFile,
    model: { provider: 'test', id: 'alpha' },
    thinkingLevel: 'medium'
  }
  const proc = Object.assign(new FakePiRpcProcess(), {
    getState: async () => state,
    getCommands: async () => [],
    getAvailableModels: async () => ({
      models: [
        { provider: 'test', id: 'alpha', name: 'Alpha' },
        { provider: 'test', id: 'beta', name: 'Beta' }
      ]
    }),
    setModel: vi.fn(async (provider: string, id: string) => {
      state.model = { provider, id }
    }),
    setThinkingLevel: vi.fn(async (level: string) => {
      state.thinkingLevel = level
    }),
    dispose: vi.fn()
  })
  vi.spyOn(PiRpcProcess, 'spawn').mockResolvedValue(proc as unknown as PiRpcProcess)
  const updates: SessionNotification[] = []
  const permissionRequests: string[] = []
  const toAgent = new TransformStream<Uint8Array>()
  const toClient = new TransformStream<Uint8Array>()
  const connection = connectPiAcpAgent(ndJsonStream(toClient.writable, toAgent.readable))
  const peer = client()
    .onNotification(methods.client.session.update, ({ params }) => {
      updates.push(params)
    })
    .onRequest(methods.client.session.requestPermission, ({ params }) => {
      permissionRequests.push(params.toolCall.toolCallId)
      const option = params.options.find(option => option.kind === 'allow_once')
      assert.ok(option)
      return { outcome: { outcome: 'selected', optionId: option.optionId } }
    })
    .connect(ndJsonStream(toAgent.writable, toClient.readable))
  t.onTestFinished(async () => {
    peer.close()
    connection.close()
    await Promise.all([peer.closed, connection.closed])
    rmSync(root, { recursive: true, force: true })
  })
  const initialized = await peer.agent.request(methods.agent.initialize, { protocolVersion: 1, clientCapabilities: {} })
  assert.equal(initialized.protocolVersion, 1)
  assert.deepEqual(initialized.agentCapabilities?.sessionCapabilities?.list, {})
  assert.deepEqual(initialized.agentCapabilities?.sessionCapabilities?.delete, {})
  return { peer: peer.agent, connection, proc, cwd, updates, permissionRequests }
}

test(
  'SDK transport preserves initial config, legacy model selection and session routing',
  { timeout: 10000 },
  async t => {
    const { peer, cwd, proc } = await setup(t)
    const created = await peer.request(methods.agent.session.new, { cwd, mcpServers: [] })
    assert.equal(created.sessionId, 'sdk-session')
    assert.equal(created.configOptions?.find(option => option.id === 'model')?.currentValue, 'test/alpha')
    assert.equal(created.configOptions?.find(option => option.id === 'thought_level')?.currentValue, 'medium')
    assert.equal(
      (created as typeof created & { models: { currentModelId: string } }).models.currentModelId,
      'test/alpha'
    )
    assert.ok(created.modes)
    const selected = await peer.request(methods.agent.session.setConfigOption, {
      sessionId: created.sessionId,
      configId: 'thought_level',
      value: 'high'
    })
    assert.equal(selected.configOptions.find(option => option.id === 'thought_level')?.currentValue, 'high')
    assert.deepEqual(
      await peer.request('session/set_model', { sessionId: created.sessionId, modelId: 'test/beta' }),
      {}
    )
    assert.deepEqual(proc.setModel.mock.calls, [['test', 'beta']])
    const modes = await peer.request(methods.agent.session.setMode, { sessionId: created.sessionId, modeId: 'medium' })
    assert.ok(modes)
    const loaded = await peer.request(methods.agent.session.load, { sessionId: created.sessionId, cwd, mcpServers: [] })
    assert.ok(loaded)
    assert.equal(loaded.configOptions?.find(option => option.id === 'model')?.currentValue, 'test/beta')
    assert.equal(loaded.configOptions?.find(option => option.id === 'thought_level')?.currentValue, 'medium')
    const listed = await peer.request(methods.agent.session.list, { cwd })
    assert.ok(listed.sessions.some(session => session.sessionId === created.sessionId))
    assert.deepEqual(await peer.request(methods.agent.session.delete, { sessionId: created.sessionId }), {})
  }
)

test('SDK transport forwards text/tools/permissions and cancels an active pi turn', { timeout: 10000 }, async t => {
  const { peer, cwd, proc, updates, permissionRequests } = await setup(t)
  const { sessionId } = await peer.request(methods.agent.session.new, { cwd, mcpServers: [] })
  const prompt = peer.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: 'hello' }] })
  void prompt.catch(() => {})
  await vi.waitFor(() => assert.equal(proc.prompts.length, 1))
  proc.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Hello' } })
  proc.emit({ type: 'tool_execution_start', toolCallId: 'tool1', toolName: 'bash', args: { command: 'echo hello' } })
  proc.emit({
    type: 'tool_execution_end',
    toolCallId: 'tool1',
    isError: false,
    result: { content: [{ type: 'text', text: 'hello' }] }
  })
  proc.emit({ type: 'extension_ui_request', id: 'confirm1', method: 'confirm', title: 'Confirm', message: 'Continue?' })
  await vi.waitFor(() => assert.equal(proc.extensionUiResponses.length, 1))
  assert.deepEqual(permissionRequests, ['pi-ui-confirm1'])
  proc.emit({ type: 'agent_end', messages: [] })
  proc.emit({ type: 'agent_settled' })
  assert.equal((await prompt).stopReason, 'end_turn')
  assert.ok(
    updates.some(
      ({ update }) =>
        update.sessionUpdate === 'agent_message_chunk' &&
        update.content.type === 'text' &&
        update.content.text === 'Hello'
    )
  )
  assert.ok(updates.some(({ update }) => update.sessionUpdate === 'tool_call'))
  assert.ok(updates.some(({ update }) => update.sessionUpdate === 'tool_call_update'))
  const cancelled = peer.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: 'wait' }] })
  void cancelled.catch(() => {})
  await vi.waitFor(() => assert.equal(proc.prompts.length, 2))
  await peer.notify(methods.agent.session.cancel, { sessionId })
  await vi.waitFor(() => assert.equal(proc.abortCount, 1))
  proc.emit({ type: 'agent_end', messages: [] })
  proc.emit({ type: 'agent_settled' })
  assert.equal((await cancelled).stopReason, 'cancelled')
})

test(
  'SDK transport rejects invalid/unsupported requests and disposes pi on disconnect',
  { timeout: 10000 },
  async t => {
    const { peer, cwd, proc, connection } = await setup(t)
    await assert.rejects(peer.request('_unsupported', {}), { code: -32601 })
    await assert.rejects(peer.request(methods.agent.session.new, { cwd: 42, mcpServers: [] }), { code: -32602 })
    await assert.rejects(peer.request('session/set_model', { sessionId: 42, modelId: 'test/alpha' }), { code: -32602 })
    await assert.rejects(
      peer.request(methods.agent.session.prompt, { sessionId: 'missing', prompt: [{ type: 'text', text: 'hello' }] }),
      { code: -32602 }
    )
    await peer.request(methods.agent.session.new, { cwd, mcpServers: [] })
    connection.close()
    await connection.closed
    assert.equal(proc.dispose.mock.calls.length, 1)
  }
)
