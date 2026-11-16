/**
 * ONE-TIME verified SendPulse Page -> existing native Chatwoot migration.
 * Uses the already authorized official SendPulse reader and the existing
 * Chatwoot REST API. No new sender, listener, DB, webhook, browser or timer.
 *
 * Names ONLY select an operator-approved small diagnostic subset. Identity
 * is official bot+Page+contact+PSID; legacy reuse additionally requires >=2
 * EXACT provider MIDs already persisted in one native Page conversation.
 */
import {createHash} from 'node:crypto';
import {
  stableContactIdentifier, buildInboundMessage,
  buildHistoricalPageOutgoingMessage, MID_PATTERN
} from './contract.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex').slice(0,32);
const isObj=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const validContact=x=>typeof x==='string'&&/^[a-z0-9_-]{10,80}$/i.test(x);
const validPeer=x=>typeof x==='string'&&/^[a-z0-9_.:-]{5,120}$/i.test(x);
const noControl=x=>typeof x==='string'&&!/[\u0000-\u001f\u007f]/u.test(x);
const toMillis=value=>{const n=Date.parse(String(value??''));return Number.isFinite(n)?n:0};
const pageInbox=5;

export function sendPulsePageRoomIdentity({accountRef,pageId,contactId,peerId}) {
  if(!/^[a-f0-9]{32}$/u.test(accountRef)||!/^[0-9]{5,40}$/u.test(pageId)||
     !validContact(contactId)||!validPeer(peerId))throw Error('SENDPULSE_ROOM_SCOPE_INVALID');
  // Stable, Page-scoped and provider-confirmed, never name/time/text derived.
  const roomRef=sha(accountRef+'\0sendpulse:'+pageId+':'+contactId+':'+peerId);
  return {roomRef,identifier:stableContactIdentifier(accountRef,roomRef)};
}

function validSourceMessages(source,binding,contactId,now) {
  if(source?.verifiedBotId!==binding.botId||source?.verifiedPageId!==binding.pageId||
     source?.raw?.success!==true||!Array.isArray(source.raw.data)||
     source.raw.data.length>300)throw Error('SENDPULSE_MESSAGES_SCOPE_UNVERIFIED');
  const unique=new Set(),out=[],unresolved=[];
  for(const m of source.raw.data) {
    if(!isObj(m)||m.bot_id!==binding.botId||m.contact_id!==contactId||
       !MID_PATTERN.test(String(m.id??''))||![1,2].includes(m.direction))continue;
    if(unique.has(m.id))continue;
    unique.add(m.id);
    const at=toMillis(m.created_at);
    if(at<Date.UTC(2000,0,1)||at>now+300000)continue;
    if(typeof m.data?.text!=='string'||!m.data.text.trim()||
       m.data.text.length>4000||!noControl(m.data.text)) {
      unresolved.push(m.id);continue; // Never fake an attachment as text.
    }
    out.push({mid:m.id,text:m.data.text,direction:m.direction===1?'INBOUND':'OUTBOUND',timestamp:at});
  }
  out.sort((a,b)=>a.timestamp-b.timestamp||a.mid.localeCompare(b.mid));
  return {messages:out,mediaUnresolved:unresolved.length};
}

async function pageNativeConversations(chatwoot,contactId) {
  const conversations=await chatwoot.listContactConversations(contactId);
  return conversations.filter(c=>(c.inbox_id??c.inbox?.id)===pageInbox);
}
async function nativeScreen(chatwoot,conversation) {
  const id=conversation?.display_id??conversation?.id;
  if(!Number.isSafeInteger(id)||id<=0)throw Error('NATIVE_DISPLAY_ID_INVALID');
  const rows=await chatwoot.listConversationMessages(id);
  return {displayId:id,rows};
}
async function findExistingIdentity({chatwoot,name,sourceMids,expectedIdentifier}) {
  // Names are discovery hints only: exact original MID overlap is required.
  const candidates=await chatwoot.searchContacts(name);
  const matches=[];
  for(const c of candidates.filter(c=>c?.id>0)){
    const conversations=await pageNativeConversations(chatwoot,c.id);
    for(const conversation of conversations){
      const screen=await nativeScreen(chatwoot,conversation);
      const overlapping=screen.rows.filter(m=>sourceMids.has(m?.source_id)).length;
      if(overlapping>=2)matches.push({contact:c,conversation,screen,overlapping});
    }
  }
  if(matches.length>1)throw Error('LEGACY_MID_AMBIGUOUS');
  if(matches.length===1)return {mode:'EXACT_MID_REUSE',...matches[0]};
  if(candidates.some(c=>c?.identifier===expectedIdentifier))
    throw Error('CANONICAL_CONTACT_NOT_IN_NATIVE_PAGE');
  if(candidates.length)throw Error('NAME_COLLISION_NO_VERIFIED_MID_LINK');
  return null;
}

export async function migrateVerifiedSendPulsePage({
  reader,chatwoot,roster,targetNames,dryRun=true,now=()=>Date.now()
}={}) {
  if(!reader||!chatwoot||!roster||!Array.isArray(roster.accounts)||
     !Array.isArray(targetNames)||!targetNames.length||targetNames.length>10)
    throw Error('MIGRATION_REQUIRED_DEPENDENCY_MISSING');
  const pageAccounts=roster.accounts.filter(a=>a.channel==='Page');
  if(pageAccounts.length!==1||!/^[a-f0-9]{32}$/u.test(pageAccounts[0].accountRef))
    throw Error('UNIQUE_PAGE_ACCOUNT_NOT_VERIFIED');
  const accountRef=pageAccounts[0].accountRef;
  const bound=await reader.verifyBotPage();
  if(bound?.verifiedBy!=='SENDPULSE_OFFICIAL_REST_API'||!validContact(bound.botId.replace(/-/g,''))||
     !/^[0-9]{5,40}$/u.test(bound.pageId))throw Error('SENDPULSE_OFFICIAL_PAGE_NOT_VERIFIED');
  const chats=await reader.readChats();
  if(chats?.success!==true||!Array.isArray(chats.data)||chats.data.length>300)
    throw Error('SENDPULSE_OFFICIAL_CONTACT_LIST_INVALID');
  const seenPeers=new Set(),scopes=new Map(),ambiguousPeers=new Set();
  for(const row of chats.data) {
    const c=row?.contact,peer=c?.channel_data?.id;
    if(!isObj(c)||c.bot_id!==bound.botId||!validContact(c.id)||!validPeer(peer))continue;
    if(seenPeers.has(peer)){ambiguousPeers.add(peer);continue}
    seenPeers.add(peer);
    scopes.set(c.id,{row,peer});
  }
  const result={dryRun,selected:0,createdContacts:0,reusedContacts:0,
    createdConversations:0,postedIncoming:0,postedOutgoing:0,
    alreadyNative:0,avoidedLegacyDuplicates:0,mediaUnresolved:0,failures:[]};
  for(const name of targetNames) {
    if(typeof name!=='string'||name.length>100||!name.trim())throw Error('TARGET_NAME_INVALID');
    const found=[...scopes.entries()].filter(([,item])=>
      item.row.contact.channel_data?.name===name);
    if(found.length!==1){result.failures.push({name,code:'TARGET_NOT_UNIQUE_IN_OFFICIAL_BOT'});continue}
    result.selected++;
    const [contactId,{row,peer}]=found[0];
    if(ambiguousPeers.has(peer)){result.failures.push({name,code:'PSID_AMBIGUOUS'});continue}
    try {
      const identity=sendPulsePageRoomIdentity({
        accountRef,pageId:bound.pageId,contactId,peerId:peer});
      const verified=await reader.readMessages(contactId);
      const {messages,mediaUnresolved}=validSourceMessages(verified,bound,contactId,now());
      result.mediaUnresolved+=mediaUnresolved;
      if(!messages.length)throw Error('NO_VERIFIED_TEXT_MESSAGES');
      const mids=new Set(messages.map(m=>m.mid));
      let contact=await chatwoot.findContactByIdentifier(identity.identifier);
      let conversation=null,mode='CANONICAL';
      if(contact) {
        const existing=await pageNativeConversations(chatwoot,contact.id);
        if(existing.length>1)throw Error('MULTIPLE_PAGE_CONVERSATIONS');
        conversation=existing[0]??null;
      } else {
        const legacy=await findExistingIdentity({chatwoot,name,sourceMids:mids,
          expectedIdentifier:identity.identifier});
        if(legacy) {
          mode='EXACT_MID_REUSE';contact=legacy.contact;conversation=legacy.conversation;
          result.reusedContacts++;
        }
      }
      if(!contact) {
        if(dryRun) {result.createdContacts++;result.createdConversations++;continue;}
        contact=await chatwoot.createContact({
          name:row.contact.channel_data.name,identifier:identity.identifier,
          inboxId:pageInbox,sourceId:identity.identifier});
        result.createdContacts++;
      }
      if(!conversation) {
        if(dryRun){result.createdConversations++;continue;}
        conversation=await chatwoot.createConversation({
          inboxId:pageInbox,contactId:contact.id,sourceId:identity.identifier});
        result.createdConversations++;
      }
      const {displayId,rows:nativeRows}=await nativeScreen(chatwoot,conversation);
      const existingMids=new Set(nativeRows.map(m=>m?.source_id).filter(x=>typeof x==='string'));
      const lastNative=Math.max(0,...nativeRows.map(m=>{
        const raw=m?.created_at??m?.external_created_at??0;
        return typeof raw==='number'?(raw>1e12?raw:raw*1000):toMillis(raw);
      }));
      for(const msg of messages) {
        if(existingMids.has(msg.mid)){result.alreadyNative++;continue;}
        // When reusing a legacy conversation, only strictly newer provider
        // MIDs are imported. Older rows may have another provider namespace.
        if(mode==='EXACT_MID_REUSE'&&msg.timestamp<=lastNative){
          result.avoidedLegacyDuplicates++;continue;
        }
        if(dryRun) {
          if(msg.direction==='INBOUND')result.postedIncoming++;
          else result.postedOutgoing++;
          continue;
        }
        const row={...msg,historyImport:true};
        const payload=msg.direction==='INBOUND'
          ? buildInboundMessage(row)
          : buildHistoricalPageOutgoingMessage(row);
        if(msg.direction==='INBOUND')await chatwoot.createIncomingMessage(displayId,payload);
        else await chatwoot.createHistoricalOutgoingMessage(displayId,payload);
        existingMids.add(msg.mid);
        if(msg.direction==='INBOUND')result.postedIncoming++;
        else result.postedOutgoing++;
      }
    }catch(e) {
      result.failures.push({name,code:(e?.code||e?.message||'UNKNOWN').slice(0,85)});
    }
  }
  return result;
}
