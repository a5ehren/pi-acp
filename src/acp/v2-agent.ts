import { randomUUID } from 'node:crypto'
import * as v1 from '@agentclientprotocol/sdk/unstable'
import * as v2 from '@agentclientprotocol/sdk/experimental/v2'
import { PiAcpAgent } from './agent.js'
import type { PiAcpClient } from './client.js'
import { V2Store, type V2Journal } from './v2-store.js'
import { toV1Mcp, toV2Commands, toV2Config, toV2Permission, toV2Tool } from './v2-translate.js'

function idle(stopReason: v1.StopReason | 'error'): v2.SessionUpdate {
  switch (stopReason) {
    case 'end_turn':
      return { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' }
    case 'cancelled':
      return { sessionUpdate: 'state_update', state: 'idle', stopReason: 'cancelled' }
    default:
      return { sessionUpdate: 'state_update', state: 'idle', stopReason: 'error' }
  }
}

type LiveSession = {
  journal: V2Journal
  foreground: number
  permissions: Set<AbortController>
  assistantId?: string
  startupInfo?: string
  muted: boolean
  closed: boolean
}

export class PiAcpV2Agent {
  private readonly delegate: PiAcpAgent
  private readonly sessions = new Map<string, LiveSession>()

  constructor(
    private readonly client: v2.AgentContext,
    private readonly store = new V2Store()
  ) {
    const bridge: PiAcpClient = {
      notify: (_method, notification) => this.publish(notification),
      request: (_method, request) => this.permission(request)
    }
    this.delegate = new PiAcpAgent(bridge)
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      session.closed = true
      for (const permission of session.permissions) permission.abort()
    }
    this.delegate.dispose()
  }

  async initialize(): Promise<v2.InitializeResponse> {
    const initialized = await this.delegate.initialize({ protocolVersion: 1 })
    return {
      protocolVersion: 2,
      info: initialized.agentInfo!,
      authMethods: [],
      capabilities: { session: { prompt: { image: {} }, delete: {} } }
    }
  }

  async newSession(params: v2.NewSessionRequest): Promise<v2.NewSessionResponse> {
    this.validateRoots(params)
    const created = await this.delegate.newSession({ cwd: params.cwd, mcpServers: toV1Mcp(params.mcpServers ?? []) })
    const journal = this.store.create(created.sessionId, params.cwd)
    this.sessions.set(created.sessionId, {
      journal,
      foreground: 0,
      permissions: new Set(),
      muted: false,
      closed: false,
      startupInfo:
        typeof created._meta?.piAcp === 'object' && created._meta.piAcp !== null
          ? (created._meta.piAcp as { startupInfo?: string }).startupInfo
          : undefined
    })
    return { sessionId: created.sessionId, configOptions: toV2Config(created.configOptions ?? []) }
  }

  async listSessions(params: v2.ListSessionsRequest): Promise<v2.ListSessionsResponse> {
    if (params.cursor) throw v2.RequestError.invalidParams({ cursor: params.cursor }, 'Unsupported session list cursor')
    const stored = await this.delegate.listSessions({ cwd: params.cwd })
    const ids = new Set(this.store.list().map(journal => journal.sessionId))
    return { sessions: stored.sessions.filter(session => ids.has(session.sessionId)) }
  }

  async resumeSession(params: v2.ResumeSessionRequest): Promise<v2.ResumeSessionResponse> {
    this.validateRoots(params)
    if (params.replayFrom && params.replayFrom.type !== 'start')
      throw v2.RequestError.invalidParams({}, 'Unsupported replay position')
    let journal: V2Journal
    try {
      journal = this.store.open(params.sessionId)
    } catch (error) {
      throw v2.RequestError.invalidParams({ sessionId: params.sessionId }, (error as Error).message)
    }
    if (journal.cwd !== params.cwd) throw v2.RequestError.invalidParams({}, 'Session cwd mismatch')
    const session: LiveSession = { journal, foreground: 0, permissions: new Set(), muted: true, closed: false }
    this.sessions.set(params.sessionId, session)
    const loaded = await this.delegate.loadSession({
      sessionId: params.sessionId,
      cwd: params.cwd,
      mcpServers: toV1Mcp(params.mcpServers ?? [])
    })
    if (params.replayFrom) {
      for (const update of journal.replay()) await this.notify(params.sessionId, update)
      await this.notify(params.sessionId, { sessionUpdate: 'replay_complete' })
    }
    session.muted = false
    await this.state(params.sessionId, 'idle')
    return { configOptions: toV2Config(loaded.configOptions ?? []) }
  }

  async prompt(params: v2.PromptRequest): Promise<v2.PromptResponse> {
    const session = this.get(params.sessionId)
    if (!params.prompt.length) throw v2.RequestError.invalidParams({}, 'Prompt must not be empty')
    for (const block of params.prompt) {
      if (!['text', 'image', 'resource', 'resource_link'].includes(block.type)) {
        throw v2.RequestError.invalidParams({ type: block.type }, 'Unsupported prompt content')
      }
    }
    const accepted = session.journal.accept(params.prompt, params.idempotencyKey ?? null)
    if (accepted.duplicate) return { messageId: accepted.messageId }
    await this.notify(params.sessionId, {
      sessionUpdate: 'user_message',
      messageId: accepted.messageId,
      content: params.prompt
    })
    session.foreground += 1
    session.assistantId = undefined
    await this.state(params.sessionId, 'running')
    void this.delegate
      .prompt({ sessionId: params.sessionId, prompt: params.prompt as v1.ContentBlock[] })
      .then(
        result => this.finished(params.sessionId, result.stopReason),
        error => this.finished(params.sessionId, 'error', error instanceof Error ? error : new Error(String(error)))
      )
      .catch(() => {})
    return { messageId: accepted.messageId }
  }

  async cancel(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session || session.closed) return
    for (const permission of session.permissions) permission.abort()
    await this.delegate.cancel({ sessionId })
  }

  async closeSession(sessionId: string): Promise<v2.CloseSessionResponse> {
    const session = this.sessions.get(sessionId)
    if (!session || session.closed) return {}
    for (const permission of session.permissions) permission.abort()
    session.closed = true
    this.delegate.closeSession(sessionId)
    session.foreground = 0
    return {}
  }

  async deleteSession(sessionId: string): Promise<v2.DeleteSessionResponse> {
    await this.closeSession(sessionId)
    await this.delegate.deleteSession({ sessionId })
    this.store.delete(sessionId)
    this.sessions.delete(sessionId)
    return {}
  }

  async setConfig(params: v2.SetSessionConfigOptionRequest): Promise<v2.SetSessionConfigOptionResponse> {
    this.get(params.sessionId)
    if (params.type !== 'id' || typeof params.value !== 'string')
      throw v2.RequestError.invalidParams({}, 'Only select configuration is supported')
    const response = await this.delegate.setSessionConfigOption({
      sessionId: params.sessionId,
      configId: params.configId,
      value: params.value
    })
    return { configOptions: toV2Config(response.configOptions) }
  }

  private validateRoots(params: v2.NewSessionRequest | v2.ResumeSessionRequest): void {
    if (params.additionalDirectories?.length || params.systemPrompt)
      throw v2.RequestError.invalidParams({}, 'Additional directories/system prompts are not supported')
  }

  private get(sessionId: string): LiveSession {
    const session = this.sessions.get(sessionId)
    if (!session || session.closed) throw v2.RequestError.invalidParams({ sessionId }, 'Unknown or closed session')
    return session
  }

  private notify(sessionId: string, update: v2.SessionUpdate): Promise<void> {
    return this.client.notify(v2.methods.client.session.update, { sessionId, update })
  }

  private state(sessionId: string, state: 'running' | 'idle' | 'requires_action'): Promise<void> {
    switch (state) {
      case 'running':
        return this.notify(sessionId, { sessionUpdate: 'state_update', state: 'running' })
      case 'idle':
        return this.notify(sessionId, { sessionUpdate: 'state_update', state: 'idle' })
      case 'requires_action':
        return this.notify(sessionId, { sessionUpdate: 'state_update', state: 'requires_action' })
    }
  }

  private async finished(sessionId: string, stopReason: v1.StopReason | 'error', error?: Error): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session || session.closed) return
    session.foreground = Math.max(0, session.foreground - 1)
    if (error)
      await this.notify(sessionId, {
        sessionUpdate: 'notice',
        severity: 'error',
        title: error?.message ?? 'Pi turn failed'
      })
    if (!session.foreground) await this.notify(sessionId, idle(stopReason))
  }

  private async permission(request: v1.RequestPermissionRequest): Promise<v1.RequestPermissionResponse> {
    const session = this.get(request.sessionId)
    const controller = new AbortController()
    session.permissions.add(controller)
    await this.state(request.sessionId, 'requires_action')
    try {
      const response = await this.client.request(v2.methods.client.session.requestPermission, toV2Permission(request), {
        cancellationSignal: controller.signal,
        stopWaitingOnCancel: true
      })
      if (response.outcome.outcome === 'selected' && typeof response.outcome.optionId === 'string')
        return { outcome: { outcome: 'selected', optionId: response.outcome.optionId } }
      return { outcome: { outcome: 'cancelled' } }
    } catch (error) {
      if (controller.signal.aborted) return { outcome: { outcome: 'cancelled' } }
      throw error
    } finally {
      session.permissions.delete(controller)
      if (!session.closed && session.foreground) await this.state(request.sessionId, 'running')
    }
  }

  private async publish(notification: v1.SessionNotification): Promise<void> {
    const { sessionId, update } = notification
    const session = this.sessions.get(sessionId)
    if (!session || session.muted || session.closed) return
    let translated: v2.SessionUpdate | undefined
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        if (update.content.type === 'text' && update.content.text === session.startupInfo) return
        session.assistantId ??= randomUUID()
        translated = { sessionUpdate: 'agent_message_chunk', messageId: session.assistantId, content: update.content }
        break
      case 'tool_call':
      case 'tool_call_update':
        session.assistantId = undefined
        translated = { sessionUpdate: 'tool_call_update', ...toV2Tool(update) }
        break
      case 'config_option_update':
        translated = { sessionUpdate: 'config_option_update', configOptions: toV2Config(update.configOptions) }
        break
      case 'available_commands_update':
        translated = {
          sessionUpdate: 'available_commands_update',
          availableCommands: toV2Commands(update.availableCommands)
        }
        break
      case 'session_info_update':
        translated = { sessionUpdate: 'session_info_update', title: update.title, updatedAt: update.updatedAt }
        break
      case 'usage_update':
        translated = update
        break
    }
    if (!translated) return
    if (['agent_message_chunk', 'tool_call_update'].includes(translated.sessionUpdate))
      session.journal.append(translated)
    await this.notify(sessionId, translated)
  }
}

export function createV2App(): v2.AgentApp {
  let delegate: PiAcpV2Agent
  return v2
    .agent()
    .onConnect(connection => {
      delegate = new PiAcpV2Agent(connection.client)
      connection.signal.addEventListener('abort', () => delegate.dispose(), { once: true })
    })
    .onRequest(v2.methods.agent.initialize, () => delegate.initialize())
    .onRequest(v2.methods.agent.session.new, ({ params }) => delegate.newSession(params))
    .onRequest(v2.methods.agent.session.list, ({ params }) => delegate.listSessions(params))
    .onRequest(v2.methods.agent.session.resume, ({ params }) => delegate.resumeSession(params))
    .onRequest(v2.methods.agent.session.close, ({ params }) => delegate.closeSession(params.sessionId))
    .onRequest(v2.methods.agent.session.delete, ({ params }) => delegate.deleteSession(params.sessionId))
    .onRequest(v2.methods.agent.session.prompt, ({ params }) => delegate.prompt(params))
    .onRequest(v2.methods.agent.session.setConfigOption, ({ params }) => delegate.setConfig(params))
    .onNotification(v2.methods.agent.session.cancel, ({ params }) => delegate.cancel(params.sessionId))
}
