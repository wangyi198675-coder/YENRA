/** Optional compatibility Service, not a second UI shell or Brain. */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { createChatwootInbox } from './embed.tsx'
export { createChatwootInbox }
export type { ChatwootInboxProps } from './embed.tsx'
export { createHostVerifiedSelectionSource } from './selection-source.ts'
export type { HostVerifiedSelectionSourceOptions } from './selection-source.ts'
export type { InboxBindingSink, VerifiedSelectionSource } from './binding-contract.ts'
export const inject = ['configForms']

export class ChatwootEmbed extends Service {
  readonly Inbox: ReturnType<typeof createChatwootInbox>
  constructor(ctx: Context) {
    super(ctx, 'yenraChatwootEmbed')
    this.Inbox = createChatwootInbox(ctx)
  }
}
declare module '@deepseek-ai/cordis' {
  interface Context { yenraChatwootEmbed: ChatwootEmbed }
}
export function apply(ctx: Context): void { new ChatwootEmbed(ctx) }
