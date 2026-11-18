import assert from 'node:assert/strict'
import { test } from 'vite-plus/test'
import { toV2Commands, toV2Config, toV2Permission, toV2Tool } from '../../src/acp/v2-translate.js'

test('v2 config and commands use new discriminator/ID fields without losing values', () => {
  assert.deepEqual(
    toV2Config([
      { type: 'select', id: 'model', name: 'Model', currentValue: 'a', options: [{ value: 'a', name: 'A' }] }
    ]),
    [{ type: 'select', configId: 'model', name: 'Model', currentValue: 'a', options: [{ value: 'a', name: 'A' }] }]
  )
  assert.deepEqual(toV2Commands([{ name: 'compact', description: 'Compact', input: { hint: 'instructions' } }]), [
    { type: 'command', name: 'compact', description: 'Compact', input: { type: 'text', hint: 'instructions' } }
  ])
})

test('v2 tool upserts retain IDs, status, raw data, locations and structured diffs', () => {
  const tool = {
    toolCallId: 't1',
    title: 'Edit',
    kind: 'edit' as const,
    status: 'completed' as const,
    rawInput: { path: 'a' },
    content: [{ type: 'diff' as const, path: '/a', oldText: 'old', newText: 'new' }],
    locations: [{ path: '/a', line: 3 }]
  }
  const translated = toV2Tool(tool)
  assert.equal(translated.toolCallId, tool.toolCallId)
  assert.equal(translated.status, tool.status)
  assert.deepEqual(translated.rawInput, tool.rawInput)
  assert.deepEqual(translated.locations, tool.locations)
  const diff = translated.content?.[0]
  assert.ok(diff?.type === 'diff' && 'changes' in diff && 'patch' in diff)
  assert.deepEqual(diff.changes, [{ operation: 'modify', path: '/a' }])
  assert.match(String((diff.patch as { text: string }).text), /-old\n\+new/)
})

test('v2 permission requests have explicit title/subject and preserve options', () => {
  const permission = toV2Permission({
    sessionId: 's1',
    toolCall: { toolCallId: 't1', title: 'Run command', kind: 'execute' },
    options: [
      { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'deny', name: 'Reject', kind: 'reject_once' }
    ]
  })
  assert.equal(permission.title, 'Run command')
  assert.deepEqual(permission.subject, {
    type: 'tool_call',
    toolCall: { toolCallId: 't1', title: 'Run command', kind: 'execute' }
  })
  assert.deepEqual(
    permission.options.map(option => option.optionId),
    ['allow', 'deny']
  )
})
