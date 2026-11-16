import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const run=promisify(execFile);
const helper=fileURLToPath(new URL('./read-cloud-dpapi.ps1',import.meta.url));
const BASE='https://app.chatwoot.com/api/v1/accounts/196799';
const INBOX=155865;
let sharedToken;
async function token(){
  if(sharedToken)return sharedToken;
  const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper],
    {windowsHide:true,timeout:8000,maxBuffer:512});
  const s=stdout.trim();
  if(!/^[a-z0-9_-]{16,180}$/i.test(s))throw Error('CLOUD_TOKEN_UNAVAILABLE');
  sharedToken=s;
  return s;
}
function strictId(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<=0)throw Error('CLOUD_ID_INVALID');return n}
export function hashCloudIdentity(value){return createHash('sha256').update(String(value),'utf8').digest('hex').slice(0,16)}
export function createCloudPageReader({fetchImpl=globalThis.fetch}={}){
  if(typeof fetchImpl!=='function')throw Error('CLOUD_FETCH_REQUIRED');
  async function get(path){
    if(!/^\/(conversations|contacts|inboxes)(\/\d+)?(\/messages)?(\?status=all&page=1)?$/.test(path))throw Error('CLOUD_PATH_NOT_ALLOWED');
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),11000);
    try{
      const response=await fetchImpl(BASE+path,{method:'GET',redirect:'error',
        headers:{'api_access_token':await token(),'accept':'application/json'},signal:controller.signal});
      if(!response.ok)throw Error('CLOUD_HTTP_'+response.status);
      const raw=await response.text();
      if(raw.length>350000)throw Error('CLOUD_RESPONSE_TOO_LARGE');
      const json=JSON.parse(raw);
      return json.payload??json.data?.payload??json;
    }finally{clearTimeout(timer)}
  }
  return Object.freeze({
    listConversations:()=>get('/conversations?status=all&page=1'),
    listInboxes:()=>get('/inboxes'),
    readConversation:id=>get('/conversations/'+strictId(id)),
    readMessages:id=>get('/conversations/'+strictId(id)+'/messages'),
    readContact:id=>get('/contacts/'+strictId(id)),
    async verifyMessengerPeer({conversationId,expectedPsidHash,expectedInboxId=INBOX}={}){
      const cv=await get('/conversations/'+strictId(conversationId));
      if(strictId(expectedInboxId)!==Number(cv.inbox_id)||Number(cv.account_id)!==196799)throw Error('CLOUD_SCOPE_REJECTED');
      const contact=await get('/contacts/'+strictId(cv.meta?.sender?.id));
      const cis=Array.isArray(contact.contact_inboxes)?contact.contact_inboxes:[];
      const matched=cis.filter(x=>Number(x?.inbox?.id??x?.inbox_id)===expectedInboxId&&/^\d{10,24}$/.test(x?.source_id??''));
      if(matched.length!==1)throw Error('CLOUD_PS_ID_UNVERIFIED');
      const psid=matched[0].source_id;
      if(expectedPsidHash&&hashCloudIdentity(psid)!==expectedPsidHash)throw Error('CLOUD_PEER_CROSSWALK_MISMATCH');
      return {cloudConversationId:cv.id,cloudContactId:contact.id,
        cloudInboxId:expectedInboxId,metaPsid:psid,thumbnail:contact.thumbnail??null};
    }
  });
}
