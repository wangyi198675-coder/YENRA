#!/usr/bin/env node
/**
 * One-off native Page migration, not a parallel Bridge/Agent/Message DB/Sender.
 * Runs through the EXISTING official Bridge credential bootstrap, reads only
 * the current authenticated SendPulse Page, writes only native Chatwoot APIs.
 */
import {loadConfig,assertRuntimePrerequisites} from './config.mjs';
import {HostClient} from './host-client.mjs';
import {ChatwootClient} from './chatwoot-client.mjs';
import {resolveInboxMap} from './inbox-map.mjs';
import {createSendPulseOfficialReader} from '../../sendpulse-bridge/sendpulse-official-reader.mjs';
import {migrateVerifiedSendPulsePage} from './sendpulse-page-migration.mjs';

async function main() {
 const cfg=loadConfig();
 assertRuntimePrerequisites(cfg);
 if(cfg.enableRealSend||cfg.dryRunInbound!==false)
   throw Error('MIGRATION_MUST_USE_REAL_INBOUND_AND_DISABLED_SENDER');
 const targets=(process.env.YENRA_PAGE_MIGRATE_TARGETS??'')
   .split('|').map(x=>x.trim()).filter(Boolean);
 if(!targets.length||targets.length>10)throw Error('EXPLICIT_BOUNDED_TARGETS_REQUIRED');
 const host=new HostClient({baseUrl:cfg.hostBaseUrl,timeoutMs:cfg.hostTimeoutMs});
 const chatwoot=new ChatwootClient({baseUrl:cfg.chatwootBaseUrl,
    accountId:cfg.chatwootAccountId,token:cfg.chatwootApiToken});
 const roster=await host.readRoster();
 if(roster.accounts.length!==4)throw Error('EXISTING_FOUR_ACCOUNTS_NOT_VERIFIED');
 const nativeInboxes=await chatwoot.listInboxes();
 const resolved=await resolveInboxMap({roster,inboxes:nativeInboxes,override:cfg.inboxMapOverride,
  chatwoot,sampleRooms:2});
 const pageAccount=roster.accounts.find(x=>x.channel==='Page');
 if(!resolved.ok || resolved.mapping.get(pageAccount?.accountRef)?.inboxId!==5)
   throw Error('NATIVE_PAGE_INBOX_5_BINDING_UNVERIFIED');
 const dryRun=process.env.YENRA_PAGE_MIGRATE_COMMIT!=='true';
 const result=await migrateVerifiedSendPulsePage({
  reader:createSendPulseOfficialReader(),chatwoot,roster,
  targetNames:targets,dryRun});
 // Never print source IDs, secrets, unredacted content, or full HTTP payloads.
 console.log('YENRA_SENDPULSE_PAGE_NATIVE_MIGRATION',JSON.stringify(result));
 if(result.failures.length)process.exitCode=2;
}
main().catch(e=>{
 console.error('YENRA_SENDPULSE_PAGE_NATIVE_MIGRATION_ERROR',
  e?.code??String(e?.message??'UNKNOWN').slice(0,85));
 process.exitCode=1;
});
