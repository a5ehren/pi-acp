import assert from 'node:assert/strict'
import path from 'node:path'
import crossSpawn from 'cross-spawn'
import { test } from 'vite-plus/test'

test('CLI initializes ACP through the installed SDK and exits cleanly on EOF', async t => {
  const executable = path.resolve('node_modules/.bin', process.platform === 'win32' ? 'vpx.cmd' : 'vpx')
  const child = crossSpawn(executable, ['src/index.ts'], { stdio: 'pipe' })
  assert.ok(child.stdin)
  assert.ok(child.stdout)
  assert.ok(child.stderr)
  const stdout = child.stdout
  let stderr = ''
  let output = ''
  const closed = new Promise<number | null>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', resolve)
  })
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
  t.onTestFinished(async () => {
    clearTimeout(timer)
    if (child.exitCode === null) child.kill('SIGTERM')
    await closed
  })
  child.stderr.on('data', chunk => {
    stderr += chunk.toString()
  })
  const response = new Promise<Record<string, unknown>>((resolve, reject) => {
    stdout.on('data', chunk => {
      output += chunk.toString()
      if (!output.includes('\n')) return
      try {
        resolve(JSON.parse(output.split('\n')[0]) as Record<string, unknown>)
      } catch (error) {
        reject(error)
      }
    })
    child.on('error', reject)
    child.on('close', code => reject(new Error(`CLI exited ${code} before initialize: ${stderr}`)))
  })
  child.stdin.write(
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } }) + '\n'
  )
  const message = await response
  assert.equal(message.jsonrpc, '2.0')
  assert.equal(message.id, 1)
  assert.equal(message.error, undefined)
  const result = message.result as {
    protocolVersion: number
    agentInfo: { name: string }
    agentCapabilities: { loadSession: boolean }
  }
  assert.equal(result.protocolVersion, 1)
  assert.equal(result.agentInfo.name, 'pi-acp')
  assert.equal(result.agentCapabilities.loadSession, true)
  child.stdin.end()
  assert.equal(await closed, 0)
})
