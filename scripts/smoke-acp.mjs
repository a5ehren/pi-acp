import crossSpawn from 'cross-spawn'
import { DEFAULT_MAX_MESSAGE_BYTES } from '@agentclientprotocol/sdk/unstable'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function runSmoke(child) {
  const { stdin, stdout } = child
  if (!stdin || !stdout) throw new Error('Smoke requires piped stdin and stdout')
  const pending = new Map()
  let buffer = ''
  let sessionId
  let startupInfo
  let sawText = false
  let failure
  let closed = false
  let shuttingDown = false
  let killTimer
  let nextId = 0

  function fail(error) {
    if (failure) return
    failure = error instanceof Error ? error : new Error(String(error))
    for (const request of pending.values()) request.reject(failure)
    pending.clear()
    if (!closed) {
      child.kill('SIGTERM')
      if (!closed) killTimer = setTimeout(() => child.kill('SIGKILL'), 2000)
    }
  }

  const exited = new Promise(resolve => {
    child.once('close', (code, signal) => {
      closed = true
      if (buffer.trim()) fail(new Error('Malformed ACP stdout: unterminated message'))
      if (!shuttingDown) fail(new Error(`Smoke agent exited ${code ?? signal} before completion`))
      resolve({ code, signal })
    })
  })
  child.on('error', fail)
  stdin.on('error', fail)
  stdout.on('error', fail)
  stdout.setEncoding('utf8')

  function onData(chunk) {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    if (
      Buffer.byteLength(buffer) > DEFAULT_MAX_MESSAGE_BYTES ||
      lines.some(line => Buffer.byteLength(line) > DEFAULT_MAX_MESSAGE_BYTES)
    ) {
      fail(new Error('Smoke ACP stdout exceeds the message size limit'))
      return
    }
    for (const line of lines) {
      if (!line.trim()) continue
      let message
      try {
        message = JSON.parse(line)
        if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') {
          throw new Error('Invalid JSON-RPC message')
        }
      } catch {
        fail(new Error('Malformed ACP stdout'))
        return
      }
      if (message.method) {
        const params = message.params
        if (
          message.method === 'session/update' &&
          params?.sessionId === sessionId &&
          params.update?.sessionUpdate === 'agent_message_chunk' &&
          params.update.content?.type === 'text' &&
          typeof params.update.content.text === 'string' &&
          params.update.content.text.trim() &&
          params.update.content.text !== startupInfo
        )
          sawText = true
        continue
      }
      const request = pending.get(message.id)
      if (!request) continue
      pending.delete(message.id)
      if (Object.hasOwn(message, 'error')) {
        request.reject(new Error(`RPC ${request.method} failed (${message.error?.code}): ${message.error?.message}`))
      } else if (!Object.hasOwn(message, 'result')) {
        request.reject(new Error(`RPC ${request.method} response has no result`))
      } else {
        request.resolve(message.result)
      }
    }
  }
  stdout.on('data', onData)
  const deadline = setTimeout(() => fail(new Error('Smoke deadline exceeded (30000ms)')), 30000)

  function send(method, params) {
    if (failure) return Promise.reject(failure)
    const id = ++nextId
    return new Promise((resolve, reject) => {
      pending.set(id, { method, resolve, reject })
      try {
        stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', error => {
          if (error) fail(error)
        })
      } catch (error) {
        fail(error)
      }
    })
  }

  try {
    const initialized = await send('initialize', { protocolVersion: 1 })
    if (initialized?.protocolVersion !== 1) throw new Error('Smoke initialize did not negotiate ACP v1')
    const session = await send('session/new', { cwd: process.cwd(), mcpServers: [] })
    if (typeof session?.sessionId !== 'string' || !session.sessionId)
      throw new Error('Smoke session/new returned no sessionId')
    sessionId = session.sessionId
    startupInfo = session._meta?.piAcp?.startupInfo
    sawText = false
    const prompt = await send('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: 'Say hello in one short sentence.' }]
    })
    if (prompt?.stopReason !== 'end_turn') throw new Error('Smoke prompt did not reach end_turn')
    if (!sawText) throw new Error('Smoke prompt returned no agent_message_chunk text')
    if (failure) throw failure
    shuttingDown = true
    stdin.end()
    const exit = await exited
    if (failure) throw failure
    if (exit.code !== 0) throw new Error(`Smoke agent exited ${exit.code ?? exit.signal}`)
  } catch (error) {
    fail(error)
    throw error
  } finally {
    clearTimeout(deadline)
    if (!closed) await exited
    clearTimeout(killTimer)
    stdout.off('data', onData)
    stdout.off('error', fail)
    stdin.off('error', fail)
    child.off('error', fail)
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await new Promise((resolve, reject) => {
      const build = crossSpawn('pnpm', ['run', 'build'], { stdio: 'inherit', cwd: process.cwd(), timeout: 30000 })
      build.on('error', reject)
      build.on('close', (code, signal) =>
        code === 0 ? resolve() : reject(new Error(`build failed: ${code ?? signal}`))
      )
    })
    const child = crossSpawn(process.execPath, ['dist/index.js'], { stdio: ['pipe', 'pipe', 'inherit'] })
    child.stdout.on('data', chunk => process.stdout.write(chunk))
    await runSmoke(child)
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}
