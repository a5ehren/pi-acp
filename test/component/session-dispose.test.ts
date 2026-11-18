import assert from 'node:assert/strict'
import { test, vi } from 'vite-plus/test'
import { SessionManager } from '../../src/acp/session.js'
import type { PiRpcProcess } from '../../src/pi-rpc/process.js'
import { FakeAgentSideConnection, FakePiRpcProcess, asAgentConn } from '../helpers/fakes.js'

for (const close of ['close', 'switch', 'disconnect'] as const) {
  test(`Pi session ${close} settles pending/queued prompts and detaches events`, { timeout: 1000 }, async () => {
    const manager = new SessionManager()
    const conn = new FakeAgentSideConnection()
    let disposed = 0
    const proc = Object.assign(new FakePiRpcProcess(), {
      dispose() {
        disposed += 1
      }
    })
    const session = manager.getOrCreate('one', {
      cwd: process.cwd(),
      mcpServers: [],
      proc: proc as unknown as PiRpcProcess,
      conn: asAgentConn(conn),
      fileCommands: []
    })
    const results: string[] = []
    void session.prompt('first').then(reason => {
      results.push(reason)
    })
    void session.prompt('queued').then(reason => {
      results.push(reason)
    })
    if (close === 'close') manager.close('one')
    if (close === 'switch') manager.closeAllExcept('other')
    if (close === 'disconnect') manager.disposeAll()
    await vi.waitFor(() => assert.deepEqual(results, ['cancelled', 'cancelled']), { timeout: 150 })
    assert.equal(disposed, 1)
    manager.close('one')
    assert.equal(disposed, 1)
    proc.emit({ type: 'session_info_changed', name: 'late title' })
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(!conn.updates.some(({ update }) => 'title' in update && update.title === 'late title'))
    await assert.rejects(session.prompt('after close'), /closed/)
  })
}
