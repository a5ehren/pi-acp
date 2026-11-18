import { agentProtocolRouter, type Stream } from '@agentclientprotocol/sdk/experimental/v2'
import { agent, methods } from '@agentclientprotocol/sdk/unstable'
import { z } from 'zod'
import { PiAcpAgent } from './agent.js'
import { createV2App } from './v2-agent.js'

const setModelParams = z.object({ sessionId: z.string(), modelId: z.string() })

function createV1App() {
  let delegate: PiAcpAgent
  return (
    agent()
      .onConnect(connection => {
        delegate = new PiAcpAgent(connection.client)
        connection.signal.addEventListener('abort', () => delegate.dispose(), { once: true })
      })
      .onRequest(methods.agent.initialize, ({ params }) => delegate.initialize(params))
      .onRequest(methods.agent.authenticate, ({ params }) => delegate.authenticate(params))
      .onRequest(methods.agent.session.new, ({ params }) => delegate.newSession(params))
      .onRequest(methods.agent.session.load, ({ params }) => delegate.loadSession(params))
      .onRequest(methods.agent.session.list, ({ params }) => delegate.listSessions(params))
      .onRequest(methods.agent.session.delete, ({ params }) => delegate.deleteSession(params))
      .onRequest(methods.agent.session.prompt, ({ params }) => delegate.prompt(params))
      .onRequest(methods.agent.session.setMode, ({ params }) => delegate.setSessionMode(params))
      .onRequest(methods.agent.session.setConfigOption, ({ params }) => delegate.setSessionConfigOption(params))
      // SDK 2.7 removed this legacy schema; retain the wire method for existing clients.
      .onRequest('session/set_model', setModelParams, async ({ params }) => {
        await delegate.unstable_setSessionModel(params)
        return {}
      })
      .onNotification(methods.agent.session.cancel, ({ params }) => delegate.cancel(params))
  )
}

/**
 * Ends the agent-side input so the router finishes and disposes the selected delegate.
 */
export function connectPiAcpAgent(stream: Stream): { close(): void; readonly closed: Promise<void> } {
  const reader = stream.readable.getReader()
  let close = () => {}
  const readable = new ReadableStream({
    start(controller) {
      close = () => {
        try {
          controller.close()
        } catch {
          // Already closed by the peer or an earlier call.
        }
      }
    },
    async pull(controller) {
      const chunk = await reader.read()
      if (chunk.done) controller.close()
      else controller.enqueue(chunk.value)
    },
    cancel(reason) {
      return reader.cancel(reason)
    }
  }) as Stream['readable']
  const connection = agentProtocolRouter()
    .withV1(createV1App())
    .withV2(createV2App())
    .connect({ readable, writable: stream.writable })
  return { closed: connection.closed, close: () => close() }
}
