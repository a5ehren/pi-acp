import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vite-plus/test'
import { V2Store } from '../../src/acp/v2-store.js'

function fixture(t: { onTestFinished(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), 'pi-acp-v2-store-'))
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
  return { dir, store: new V2Store(dir) }
}

test('v2 journal persists insertion IDs, output and idempotency across reopening', t => {
  const { dir, store } = fixture(t)
  const journal = store.create('session-one', '/workspace')
  const prompt = [{ type: 'text' as const, text: 'hello' }]
  const first = journal.accept(prompt, 'retry-key')
  assert.equal(first.duplicate, false)
  journal.append({
    sessionUpdate: 'agent_message_chunk',
    messageId: 'reply-one',
    content: { type: 'text', text: 'hello back' }
  })
  const loaded = new V2Store(dir).open('session-one')
  assert.equal(loaded.cwd, '/workspace')
  assert.deepEqual(loaded.accept(prompt, 'retry-key'), { messageId: first.messageId, duplicate: true })
  assert.equal(loaded.replay().length, 2)
  assert.equal(loaded.replay()[0]?.sessionUpdate, 'user_message')
  assert.equal(loaded.replay()[1]?.sessionUpdate, 'agent_message_chunk')
  assert.throws(() => loaded.accept([{ type: 'text', text: 'different' }], 'retry-key'), /idempotency/i)
})

test('v2 journal uses safe names and user-only permissions without touching Pi files', t => {
  const { dir, store } = fixture(t)
  const journal = store.create('../unsafe/session', '/workspace')
  journal.accept([{ type: 'text', text: 'hello' }])
  const files = readdirSync(dir)
  assert.equal(files.length, 1)
  assert.ok(!files[0]?.includes('unsafe'))
  if (process.platform !== 'win32') assert.equal(statSync(join(dir, files[0]!)).mode & 0o777, 0o600)
  assert.equal(store.open('../unsafe/session').sessionId, '../unsafe/session')
  store.create('../unsafe/session', '/workspace')
  assert.equal(store.list().filter(item => item.sessionId === '../unsafe/session').length, 2)
  assert.ok(readdirSync(dir).every(file => !file.includes('unsafe')))
})

test('v2 journal rejects corruption and incomplete writes', t => {
  const { dir, store } = fixture(t)
  store.create('s', '/workspace')
  const file = join(dir, readdirSync(dir)[0]!)
  appendFileSync(file, '{broken json}\n')
  assert.throws(() => store.open('s'), /corrupt|invalid/i)
  store.delete('s')
  store.create('s', '/workspace')
  appendFileSync(file, '{"type":"update"')
  assert.throws(() => store.open('s'), /incomplete|truncated|corrupt/i)
})

test('v2 journal does not retain transient state and supports deletion/listing', t => {
  const { dir, store } = fixture(t)
  const journal = store.create('s', '/workspace')
  assert.throws(() => journal.append({ sessionUpdate: 'state_update', state: 'idle' }), /retain|state/i)
  assert.deepEqual(
    store.list().map(item => item.sessionId),
    ['s']
  )
  assert.ok(readFileSync(join(dir, readdirSync(dir)[0]!), 'utf8').endsWith('\n'))
  store.delete('s')
  assert.deepEqual(store.list(), [])
  store.delete('s')
  assert.throws(() => store.open('s'), /ENOENT|not found/i)
})
