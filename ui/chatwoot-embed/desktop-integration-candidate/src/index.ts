/** YENRA glue over official DSH Commands + Jobs + LLM.
 * One existing Agent/Session; never prompt() or create a second conversation.
 * The command logs no prompt or response text. Suggestion output is observed
 * only through the official, session-fenced Job output stream.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-session-query'
import { registerMemoryUiCommands } from './memory-commands.ts'
import { registerSocialReadOnlyCommands } from './social-readonly-commands.ts'
import { registerSocialAgentTools } from './social-agent-tools.ts'
import { registerSocialActionAgentTools } from './social-agent-actions.ts'
import { registerOriginalSocialInboxEvents } from './social-native-events.ts'
import { registerOriginalWhatsAppPresenceSubscription } from './social-whatsapp-presence-subscription.ts'
import { registerOriginalSocialMediaHostRoute } from './social-media-host-route.ts'
import { registerFacebookSocialCommands } from './facebook-social-commands.ts'
import { registerSendPulseNativeStatus } from './sendpulse-native-status.ts'
import { registerSendPulsePageInbound } from './sendpulse-native-webhook.ts'
import {registerFacebookContactPreferenceCommands} from './facebook-contact-prefs-commands.ts'
import {registerWhatsAppContactPreferenceCommands} from './whatsapp-contact-prefs-commands.ts'
import { registerTranslationCommands } from './translation-commands.ts'
import { registerOssStaticAssets } from './oss-static-assets.ts'
import { registerOssDisplayRoster } from './oss-roster-display.ts'
import { installTrustedWorkspaceBinding } from './trusted-native-workspace.ts'
// Persona and CCv3 identity are selected exclusively by the original DSH Persona plugin.
export const inject = ['commands', 'jobs', 'llm', 'tools', 'sessionQuery']
export function apply(ctx: Context): void {
  // Bind the ONE original WorkspaceRegistry before any trust decision.
  installTrustedWorkspaceBinding(ctx)
  registerMemoryUiCommands(ctx)
  const readCachedPagePreview=registerTranslationCommands(ctx)
  registerOriginalSocialMediaHostRoute(ctx)
  registerOssStaticAssets(ctx)
  registerOssDisplayRoster(ctx,readCachedPagePreview)
  // Use the root Cordis service injector: nested dshIm callbacks left this
  // existing social-read Host route unmounted (HTTP 404).
  registerSocialReadOnlyCommands(ctx)
  registerOriginalWhatsAppPresenceSubscription(ctx)
  ctx.inject(['dshIm'], socialCtx=>{
    // Original social-read is registered at root below, not in this child scope.
    registerOriginalSocialInboxEvents(socialCtx)
  })
  registerFacebookSocialCommands(ctx)
  registerSocialAgentTools(ctx)
  registerSocialActionAgentTools(ctx,readCachedPagePreview)
  registerSendPulseNativeStatus(ctx)
  registerSendPulsePageInbound(ctx)
  registerFacebookContactPreferenceCommands(ctx)
  registerWhatsAppContactPreferenceCommands(ctx)

}
