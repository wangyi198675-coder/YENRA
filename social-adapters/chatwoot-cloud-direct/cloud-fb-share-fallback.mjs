/** Facebook Page native fallback links, verified from Chatwoot Cloud messages.
 * The preferred source is Chatwoot's native Facebook attachment.data_url.
 * Legacy owner-confirmed custom attributes apply ONLY if that URL is absent.
 * No provider login, scraping, additional chat DB or alternate Sender.
 */
const FACEBOOK_HOSTS=new Set(['facebook.com','www.facebook.com','m.facebook.com']);
const PAGE_INBOXES=new Set([155865,156456]);
const validId=n=>Number.isSafeInteger(n)&&n>0;
const safePath=u=>
  /^\/share\/(?:[A-Za-z0-9]+|[pv]\/[A-Za-z0-9]+)\/?$/u.test(u.pathname)&&!u.search||
  /^\/photo\/?$/u.test(u.pathname)&&/^\d{10,25}$/u.test(u.searchParams.get('fbid')??'')&&
    [...u.searchParams.keys()].every(k=>k==='fbid')||
  /^\/(?:reel|videos|posts)\/\d{8,25}\/?$/u.test(u.pathname)&&!u.search||
  /^\/watch\/?$/u.test(u.pathname)&&/^\d{8,25}$/u.test(u.searchParams.get('v')??'')&&
    [...u.searchParams.keys()].every(k=>k==='v');
export function validatedFacebookMediaLink(value){
 if(typeof value!=='string'||value.length>450)return null;
 let u;try{u=new URL(value)}catch{return null}
 if(u.protocol!=='https:'||!FACEBOOK_HOSTS.has(u.hostname)||u.username||u.password||
    u.port||u.hash||!safePath(u))return null;
 u.hostname='www.facebook.com';
 return u.href;
}
export function verifiedCloudFacebookShareLinks(conversation,rawMessages){
 if(conversation?.account_id!==196799||
   !PAGE_INBOXES.has(Number(conversation?.inbox_id??conversation?.inbox?.id))||
   !Array.isArray(rawMessages)||rawMessages.length>100)return [];
 const encoded=conversation.custom_attributes?.yenra_fb_share_links_v1;
 let legacy={};
 if(typeof encoded==='string'&&encoded.length<=3600){
   try{
     const obj=JSON.parse(encoded);
     if(obj&&typeof obj==='object'&&!Array.isArray(obj)&&Object.keys(obj).length<=20)
       legacy=obj;
   }catch{}
 }
 const out=[],seen=new Set();
 for(const m of rawMessages){
   const id=Number(m?.id);
   if(!validId(id)||seen.has(id)||m?.private===true||m?.message_type!==0)continue;
   // Ambiguous duplicate Cloud message IDs may not bind a Facebook attachment.
   if(rawMessages.filter(x=>Number(x?.id)===id).length!==1)continue;
   const media=m.attachments;
   if(!Array.isArray(media)||media.length!==1||media[0]?.file_type!=='fallback')continue;
   // Both modern native URLs and old owner-confirmed legacy mappings must
   // bind to an actual Meta-source MID from this exact Page message.
   if(!/^[mM]_\S{6,180}$/u.test(String(m.source_id??'')))continue;
   const nativeUrl=media[0]?.data_url;
   const fromNative=typeof nativeUrl==='string'&&nativeUrl.trim().length>0;
   const candidate=fromNative?nativeUrl:legacy[String(id)];
   const url=validatedFacebookMediaLink(candidate);
   if(!url)continue;
   seen.add(id);
   out.push(Object.freeze({messageId:id,url}));
   if(out.length===20)break;
 }
 return out;
}
