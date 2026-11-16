/** Existing Matrix account_data preferences, exposed through the already
 * authenticated official DSH user Session. Never send Matrix bearer tokens
 * or Page credential scopes to the mature OSS renderer. No second database.
 */
import type {Context} from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-commands';
import {createExistingMatrixContactPrefs} from '../../../social-adapters/oss-candidates/existing-matrix-contact-actions.mjs';
import {resolveExistingFacebookContactPreferenceRoom} from './facebook-social-commands.ts';

import {installedYenraRoot,isTrustedNativeWorkspace} from './trusted-native-workspace.ts';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const projectRoot=installedYenraRoot();
const LEGACY_SESSION=projectRoot?pathToFileURL(join(projectRoot,
  'docs/handoff/FB_PERSONAL_W56_LEGACY/Worktrees/W56_FB_PERSONAL_NATIVE_LOGIN_20261028/connectors/mautrix-meta/native/native-matrix-session.mjs')).href:
  'file:///YENRA_PROJECT_ROOT_UNAVAILABLE';
const PREFIX='YENRA_FB_PREFS_V1:';
const REF=/^[a-f0-9]{32}$/;
const FIELDS=['pinned','muted','archived','manualUnread'] as const;
const normalize=(s:string|undefined)=>(s??'').replaceAll(String.fromCharCode(92),'/').replace(/\/+$/,'').toLowerCase();
const error=(message:string)=>({kind:'error' as const,text:message});
const ok=(value:unknown)=>({kind:'success' as const,text:PREFIX+JSON.stringify(value)});
function parse(raw:string,mode:'read'|'write'){
 if(typeof raw!=='string'||raw.length>550)throw Error('CONTACT_PREFS_REQUEST_INVALID');
 const data:unknown=JSON.parse(raw);
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('CONTACT_PREFS_BODY_INVALID');
 const p=data as Record<string,unknown>;
 if(Object.keys(p).sort().join('|')!==(mode==='read'?'accountRef|roomRef':'accountRef|expectedRevision|field|roomRef|value')||
   typeof p.accountRef!=='string'||!REF.test(p.accountRef)||
   typeof p.roomRef!=='string'||!REF.test(p.roomRef))
   throw Error('CONTACT_PREFS_SCOPE_INVALID');
 if(mode==='write'&&(!FIELDS.includes(p.field as typeof FIELDS[number])||
   typeof p.value!=='boolean'||!Number.isSafeInteger(p.expectedRevision)||
   Number(p.expectedRevision)<0))throw Error('CONTACT_PREFS_ACTION_INVALID');
 return {accountRef:p.accountRef as string,roomRef:p.roomRef as string,
   ...(mode==='write'?{field:p.field as typeof FIELDS[number],
     value:p.value as boolean,expectedRevision:p.expectedRevision as number}:{})};
}
let bridge:ReturnType<typeof createExistingMatrixContactPrefs>|null=null;
function preferences(){
 if(!bridge)bridge=createExistingMatrixContactPrefs({
   getProtectedSession:async()=>{
     const module=await import(LEGACY_SESSION);
     return module.getProtectedNativeMatrixSession();
   },
   resolveNativeRoom:resolveExistingFacebookContactPreferenceRoom,
 });
 return bridge;
}
/** Reuse the SAME existing Host Matrix account_data bridge for one bounded
 * cold-start roster read. Nothing secret or native-room scoped reaches UI. */
export async function readExistingFacebookContactPrefsSnapshotForRoster(){
  return preferences().readRosterSnapshot() as Promise<{
    revision:number;rooms:Record<string,any>}>;
}
export function registerFacebookContactPreferenceCommands(ctx:Context):void{
 ctx.effect(()=>{
   const disposers=[
     ctx.commands.register({name:'yenra-facebook-contact-prefs-read',
       description:'Read verified Personal/Page contact preferences from original Matrix account_data',
       recordInput:false,input:{hint:'Existing accountRef + roomRef only'},
       handler:async({agent,rawInput})=>{
         if(!isTrustedNativeWorkspace(ctx,agent.session.header.cwd))return error('主人工作区未经认证');
         try{return ok(await preferences().readState(parse(rawInput.trim(),'read')))}
         catch(e){return error('联系人偏好读取暂不可用：'+String((e as Error)?.message??e).slice(0,130))}
       }}),
     ctx.commands.register({name:'yenra-facebook-contact-prefs-save',
       description:'Save one existing Matrix account_data contact preference after owner UI click',
       recordInput:false,input:{hint:'Exact current Host account, room, revision and preference field'},
       handler:async({agent,rawInput})=>{
         if(!isTrustedNativeWorkspace(ctx,agent.session.header.cwd))return error('主人工作区未经认证');
         try{return ok(await preferences().savePreference(parse(rawInput.trim(),'write') as {
           accountRef:string;roomRef:string;field:string;value:boolean;expectedRevision:number}))}
         catch(e){return error('联系人偏好未确认保存：'+String((e as Error)?.message??e).slice(0,150))}
       }}),
   ];
   return()=>{for(const dispose of disposers.reverse())dispose()};
 },'YENRA original Matrix contact preferences via existing DSH Host only');
}
