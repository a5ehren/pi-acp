import type * as v1 from '@agentclientprotocol/sdk/unstable'
import type * as v2 from '@agentclientprotocol/sdk/experimental/v2'

export function toV1Mcp(servers: v2.McpServer[]): v1.McpServer[] {
  return servers.map(server => {
    if (server.type === 'http' && typeof server.name === 'string' && typeof server.url === 'string') {
      const headers = Array.isArray(server.headers) ? server.headers : []
      return { type: 'http', name: server.name, url: server.url, headers } as v1.McpServer
    }
    if (server.type === 'stdio' && typeof server.name === 'string' && typeof server.command === 'string') {
      const args = Array.isArray(server.args) ? server.args : []
      const env = Array.isArray(server.env) ? server.env : []
      return { name: server.name, command: server.command, args, env } as v1.McpServer
    }
    throw new Error('Unsupported MCP server type')
  })
}

export function toV2Config(options: v1.SessionConfigOption[]): v2.SessionConfigOption[] {
  return options.map(option => {
    const { id, ...rest } = option
    if (option.type !== 'select') throw new Error(`Unsupported Pi config option type: ${option.type}`)
    return { ...rest, type: 'select', configId: id } as v2.SessionConfigOption
  })
}

export function toV2Commands(commands: v1.AvailableCommand[]): v2.AvailableCommand[] {
  return commands.map(({ input, ...command }) => ({
    ...command,
    type: 'command',
    ...(input ? { input: { type: 'text', hint: input.hint } } : {})
  }))
}

function toV2ToolContent(content: v1.ToolCallContent): v2.ToolCallContent {
  if (content.type !== 'diff') return content
  const { path, oldText, newText } = content
  const oldLines = !oldText ? [] : oldText.replace(/\n$/, '').split('\n')
  const newLines = newText === '' ? [] : newText.replace(/\n$/, '').split('\n')
  const patch = [
    `--- ${oldText === null ? '/dev/null' : path}`,
    `+++ ${path}`,
    `@@ -${oldLines.length ? '1' : '0'},${oldLines.length} +${newLines.length ? '1' : '0'},${newLines.length} @@`,
    ...oldLines.map(line => '-' + line),
    ...newLines.map(line => '+' + line),
    ''
  ].join('\n')
  const change: v2.DiffChange = oldText === null ? { operation: 'add', path } : { operation: 'modify', path }
  const diff: v2.Diff = { changes: [change], patch: { format: 'git_patch', text: patch }, _meta: content._meta }
  return { type: 'diff', ...diff }
}

export function toV2Tool(tool: v1.ToolCallUpdate): v2.ToolCallUpdate {
  const { content, ...rest } = tool
  return { ...rest, ...(content ? { content: content.map(toV2ToolContent) } : {}) }
}

export function toV2Permission(request: v1.RequestPermissionRequest): v2.RequestPermissionRequest {
  return {
    sessionId: request.sessionId,
    title: request.toolCall.title || 'Pi permission request',
    subject: { type: 'tool_call', toolCall: toV2Tool(request.toolCall) },
    options: request.options,
    _meta: request._meta
  }
}
