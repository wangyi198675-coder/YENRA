/**
 * YENRA read-only social Agent Tools over the SAME original Host read paths
 * that already power the existing UI Commands and WebServer routes. No second
 * data service, Sender, Socket, chat database, model gateway or authorization.
 *
 *  - yenra_social_roster : owner-level authorized-account contact summaries.
 *  - yenra_social_room   : the CURRENT Host-verified contact's messages.
 *
 * Tools are registered through the injected `ctx.tools` Cordis service with a
 * plain ToolDefinition object (the same object `defineTool` builds). This keeps
 * the plugin free of any @deepseek-ai/* value import, exactly like the rest of
 * this package: everything arrives through the injected Cordis context.
 *
 * Both tools fail closed: an unbound creative/Work Session (no trusted
 * workspace, no verified contact title) can never read roster or private data.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { isTrustedNativeWorkspace } from './trusted-native-workspace.ts'
import {
  currentBots,
  readInbox,
  readExistingWhatsAppRosterForOss,
  readSocialRoom,
  accountRef as waAccountRef,
  roomRef as waRoomRef,
} from './social-readonly-commands.ts'
import {
  readExistingFacebookRosterForOss,
  resolveExistingFacebookContactPreferenceRoom,
  personalRoom,
  pageRoom,
  pageHistoricalOnly,
} from './facebook-social-commands.ts'

/** Structural slice of the original DSH-IM service the read paths use. */
export type ImService = {
  listBots(): Promise<Array<{ botId: string; channel: string }>>
  whatsappCurrentlyAuthorized?: (botId: string) => Promise<boolean>
}

export type ContactScope = {
  channel: 'WhatsApp' | 'Personal' | 'Page'
  accountRef: string
  roomRef: string
}

const CONTACT_TITLE = /^YENRA:B:([a-f0-9]{32}):([a-f0-9]{32})$/u

function requireAgent(exec: { agent?: Agent }): Agent {
  if (exec.agent === undefined) throw new Error('yenra social tools require an owning agent session')
  return exec.agent
}

function sessionTitle(agent: Agent): string | undefined {
  const events = agent.session.snapshotEvents() as unknown as readonly { type: string; data?: unknown }[]
  const event = events.findLast(e => e.type === 'session/title')
  const data = event?.data as { title?: string } | undefined
  return typeof data?.title === 'string' ? data.title : undefined
}

export function isContactBrainSession(agent: Agent): boolean {
  const title = sessionTitle(agent)
  return title !== undefined && (title.startsWith('YENRA:B:') || title.startsWith('YENRA · 闺蜜 · '))
}

/** Resolve the CURRENT trusted contact from the Session title, then re-verify
 * against the ORIGINAL Host authorities. A title is only a lookup key, never
 * authorization. Returns null when unbound or unverified (fail closed). */
export async function resolveTrustedContact(im: ImService | undefined, agent: Agent): Promise<ContactScope | null> {
  const title = sessionTitle(agent)
  const match = title ? CONTACT_TITLE.exec(title) : null
  if (!match) return null
  const accountRef = match[1]!
  const roomRef = match[2]!
  if (im && typeof im.listBots === 'function') {
    try {
      const bots = await currentBots(im)
      const bot = bots.find(b => waAccountRef(b.botId) === accountRef)
      if (bot && typeof im.whatsappCurrentlyAuthorized === 'function' &&
        (await im.whatsappCurrentlyAuthorized(bot.botId)) === true) {
        const inbox = await readInbox(bot.botId)
        if (inbox.chats.some(c => waRoomRef(bot.botId, c.jid) === roomRef)) {
          return { channel: 'WhatsApp', accountRef, roomRef }
        }
      }
    } catch { /* fail closed */ }
  }
  try {
    const found = await resolveExistingFacebookContactPreferenceRoom({ accountRef, roomRef })
    if (found && (found.channel === 'Personal' || found.channel === 'Page')) {
      return { channel: found.channel, accountRef, roomRef }
    }
  } catch { /* fail closed */ }
  return null
}

function renderRoster(value: { accounts?: unknown[]; partial?: boolean }): string {
  const accounts = Array.isArray(value.accounts) ? value.accounts : []
  if (accounts.length === 0) return '当前没有可读取的已授权账号。'
  const lines = accounts.map((raw) => {
    const a = (raw ?? {}) as Record<string, unknown>
    const channel = String(a.channel ?? '?')
    const rooms = Array.isArray(a.rooms) ? a.rooms : []
    const roomLines = rooms.map((rr) => {
      const r = (rr ?? {}) as Record<string, unknown>
      const name = typeof r.name === 'string' && r.name ? r.name : '未知联系人'
      const count = Number.isFinite(r.messageCount) ? Number(r.messageCount) : 0
      const latest = typeof r.latestText === 'string' ? r.latestText.slice(0, 160) : ''
      return `  - ${name}（${count} 条${latest ? '，最后：' + latest : ''}）`
    })
    return `- [${channel}] 联系人 ${rooms.length} 个\n${roomLines.join('\n')}`
  })
  const partial = value.partial === true ? '（部分名册，可能受限流或离线影响）' : ''
  return `YENRA 已授权账号名册（只读）${partial}:\n${lines.join('\n')}`
}

function renderRoom(value: Record<string, unknown>): string {
  const channel = String(value.channel ?? '?')
  const name = typeof value.name === 'string' && value.name ? value.name : '未知联系人'
  const messages = Array.isArray(value.messages) ? value.messages : []
  const shown = messages.slice(-40)
  const head = `[${channel}] 联系人「${name}」最近 ${shown.length} 条消息（只读，共 ${messages.length} 条可用）:\n`
  if (shown.length === 0) return head + '（无消息）'
  const body = shown.map((m) => {
    const msg = (m ?? {}) as Record<string, unknown>
    const dir = msg.direction === 'OUTBOUND' ? '我方' : '对方'
    const text = typeof msg.text === 'string' ? msg.text.slice(0, 500) : ''
    const at = Number.isFinite(msg.timestamp) ? new Date(Number(msg.timestamp)).toISOString() : ''
    return `${dir}${at ? ' ' + at : ''}: ${text}`
  }).join('\n')
  return head + body
}

export function registerSocialAgentTools(ctx: Context): void {
  // Original DSH-IM is injected (not instantiated or reconnected), exactly like
  // the existing social-read Commands and memory binding.
  let originalIm: ImService | undefined
  ctx.inject(['dshIm'], scope => scope.effect(() => {
    const service = (scope as unknown as { dshIm?: ImService }).dshIm
    originalIm = service
    return () => { if (originalIm === service) originalIm = undefined }
  }, 'YENRA social agent tools original IM binding'))

  ctx.tools.register({
    name: 'yenra_social_roster',
    description: 'Read the owner\'s currently authorized social accounts and their contact summaries (WhatsApp via the original DSH-IM inbox, Facebook Personal and Page). Read-only; requires the trusted native owner workspace. Returns only Host-verified account/room references, names, counts and short previews.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    // Four channels (WhatsApp inbox + Facebook Personal + Page roster) can
    // exceed 30s on a cold provider read; a timeout is not a permission denial.
    timeoutMs: 60000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['accounts', 'partial', 'failures'],
        properties: {
          accounts: { type: 'array', items: { type: 'object' } },
          partial: { type: 'boolean' },
          failures: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: renderRoster(value as never) }],
    },
    async execute(_args: unknown, exec: { agent?: Agent }) {
      const agent = requireAgent(exec)
      if (!isTrustedNativeWorkspace(ctx, agent.session.header.cwd)) {
        throw new Error('未确认主人 DSH 工作区，拒绝读取账号名册')
      }
      if (isContactBrainSession(agent)) throw new Error('联系人 Session 不能读取主人级账号名册')
      const im = originalIm
      const wa = im && typeof im.listBots === 'function'
        ? await readExistingWhatsAppRosterForOss(im).catch(() => ({ accounts: [] as unknown[], partial: true, failures: ['WHATSAPP_UNAVAILABLE'] }))
        : { accounts: [] as unknown[], partial: false, failures: [] as unknown[] }
      const fb = await readExistingFacebookRosterForOss().catch(() => ({ accounts: [] as unknown[], partial: true, failures: ['FACEBOOK_UNAVAILABLE'] }))
      const accounts = [...(Array.isArray(wa.accounts) ? wa.accounts : []), ...(Array.isArray(fb.accounts) ? fb.accounts : [])]
      return {
        accounts,
        partial: (wa as { partial?: boolean }).partial === true || (fb as { partial?: boolean }).partial === true,
        failures: [...((wa as { failures?: unknown[] }).failures ?? []), ...((fb as { failures?: unknown[] }).failures ?? [])],
      }
    },
  } as never)

  ctx.tools.register({
    name: 'yenra_social_room',
    description: 'Read the real messages of the CURRENTLY trusted-bound contact Session (the contact the owner selected in YENRA). Read-only; derives the contact from the Host-verified Session binding, never from a model-supplied id. Fails closed when the Session is not bound to a verified contact.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    timeoutMs: 30000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        required: ['channel', 'accountRef', 'roomRef', 'messages'],
        properties: {
          channel: { type: 'string' },
          accountRef: { type: 'string' },
          roomRef: { type: 'string' },
          messages: { type: 'array', items: { type: 'object' } },
        },
      },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: renderRoom(value as never) }],
    },
    async execute(_args: unknown, exec: { agent?: Agent }) {
      const agent = requireAgent(exec)
      if (!isTrustedNativeWorkspace(ctx, agent.session.header.cwd)) {
        throw new Error('未确认主人 DSH 工作区，拒绝读取联系人消息')
      }
      const contact = await resolveTrustedContact(originalIm, agent)
      if (!contact) throw new Error('当前 Session 未绑定可信联系人，拒绝读取会话消息')
      if (contact.channel === 'WhatsApp') {
        const im = originalIm
        if (!im || typeof im.listBots !== 'function') throw new Error('原生 DSH-IM 服务不可用')
        const bots = await currentBots(im)
        return await readSocialRoom(ctx, im, bots, { accountRef: contact.accountRef, roomRef: contact.roomRef })
      }
      if (contact.channel === 'Personal') {
        const room = await personalRoom({ accountRef: contact.accountRef, roomRef: contact.roomRef })
        if (!room) throw new Error('当前联系人的会话不在已认证名册中')
        return room
      }
      const room = await pageRoom({ accountRef: contact.accountRef, roomRef: contact.roomRef })
        ?? await pageHistoricalOnly({ accountRef: contact.accountRef, roomRef: contact.roomRef })
      if (!room) throw new Error('当前 Page 联系人的会话不可用')
      return room
    },
  } as never)
}
