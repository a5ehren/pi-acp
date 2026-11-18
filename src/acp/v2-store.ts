import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import type { ContentBlock, SessionUpdate } from '@agentclientprotocol/sdk/experimental/v2'
import { getPiAcpDir } from './paths.js'

const content = z.looseObject({ type: z.string() })
const retainedUpdate = z
  .looseObject({
    sessionUpdate: z.enum([
      'user_message',
      'user_message_chunk',
      'agent_message',
      'agent_message_chunk',
      'agent_thought',
      'agent_thought_chunk',
      'tool_call_update',
      'tool_call_content_chunk'
    ])
  })
  .superRefine((value, ctx) => {
    const tool = value.sessionUpdate.startsWith('tool_call')
    const id = tool ? value.toolCallId : value.messageId
    if (typeof id !== 'string' || !id) ctx.addIssue({ code: 'custom', message: 'Missing retained entity ID' })
    if (!tool && !content.safeParse(value.content).success && !z.array(content).safeParse(value.content).success) {
      ctx.addIssue({ code: 'custom', message: 'Invalid retained content' })
    }
  })
const record = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session'),
    version: z.literal(1),
    sessionId: z.string().min(1),
    cwd: z.string().refine(isAbsolute)
  }),
  z.object({
    type: z.literal('submission'),
    messageId: z.string().min(1),
    key: z.string().nullable(),
    prompt: z.array(content)
  }),
  z.object({ type: z.literal('update'), update: retainedUpdate })
])
type Record = z.infer<typeof record>

export class V2Journal {
  readonly sessionId: string
  readonly cwd: string
  private records: Record[]

  constructor(
    readonly path: string,
    records: Record[]
  ) {
    const header = records[0]
    if (!header || header.type !== 'session') throw new Error('Corrupt v2 journal: missing header')
    this.sessionId = header.sessionId
    this.cwd = header.cwd
    this.records = records
  }

  accept(prompt: ContentBlock[], key: string | null = null): { messageId: string; duplicate: boolean } {
    if (key !== null) {
      const previous = this.records.find(item => item.type === 'submission' && item.key === key)
      if (previous?.type === 'submission') {
        if (!isDeepStrictEqual(previous.prompt, prompt)) throw new Error('Idempotency key reused with different prompt')
        return { messageId: previous.messageId, duplicate: true }
      }
    }
    const messageId = randomUUID()
    this.write({ type: 'submission', messageId, key, prompt })
    return { messageId, duplicate: false }
  }

  append(update: SessionUpdate): void {
    if (update.sessionUpdate === 'state_update') throw new Error('Cannot retain transient state')
    this.write({ type: 'update', update })
  }

  replay(): SessionUpdate[] {
    return this.records.flatMap(item => {
      if (item.type === 'submission')
        return [{ sessionUpdate: 'user_message', messageId: item.messageId, content: item.prompt } as SessionUpdate]
      if (item.type === 'update') return [item.update as SessionUpdate]
      return []
    })
  }

  private write(value: unknown): void {
    const parsed = record.parse(value)
    appendFileSync(this.path, JSON.stringify(parsed) + '\n', { encoding: 'utf8' })
    this.records.push(parsed)
  }
}

export class V2Store {
  constructor(private readonly directory = join(getPiAcpDir(), 'v2')) {}

  create(sessionId: string, cwd: string): V2Journal {
    if (!sessionId) throw new Error('Invalid empty session ID')
    const header = record.parse({ type: 'session', version: 1, sessionId, cwd })
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const path = join(this.directory, `${this.prefix(sessionId)}${randomUUID()}.jsonl`)
    writeFileSync(path, JSON.stringify(header) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    return new V2Journal(path, [header])
  }

  open(sessionId: string): V2Journal {
    const journal = this.list().find(item => item.sessionId === sessionId)
    if (!journal) throw new Error(`V2 session not found: ${sessionId}`)
    return journal
  }

  list(): V2Journal[] {
    let files: string[]
    try {
      files = readdirSync(this.directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    return files.filter(file => file.endsWith('.jsonl')).map(file => this.read(join(this.directory, file)))
  }

  delete(sessionId: string): void {
    const prefix = this.prefix(sessionId)
    let files: string[]
    try {
      files = readdirSync(this.directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const file of files) {
      if (file.startsWith(prefix) && file.endsWith('.jsonl')) unlinkSync(join(this.directory, file))
    }
  }

  private prefix(sessionId: string): string {
    if (!sessionId) throw new Error('Invalid empty session ID')
    return createHash('sha256').update(sessionId).digest('hex').slice(0, 16) + '-'
  }

  private read(path: string): V2Journal {
    const source = readFileSync(path, 'utf8')
    if (!source.endsWith('\n')) throw new Error('Corrupt v2 journal: incomplete write')
    try {
      const records = source
        .slice(0, -1)
        .split('\n')
        .map(line => record.parse(JSON.parse(line)))
      if (records.slice(1).some(item => item.type === 'session')) throw new Error('Duplicate journal header')
      return new V2Journal(path, records)
    } catch (error) {
      throw new Error('Corrupt v2 journal: invalid record', { cause: error })
    }
  }
}
