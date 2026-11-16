import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedCloudFacebookShareLinks} from './cloud-fb-share-fallback.mjs';
import {resolveCloudNativeConversation} from './cloud-native-selection.mjs';
const ID=995066646,ID2=995078231;
const share={ [ID]:'https://www.facebook.com/share/1BQH62vSjz/',
  [ID2]:'https://www.facebook.com/share/1CbR7UwUdA/'};
const fallback=id=>({id,message_type:0,source_id:'m_original_meta_'+id,private:false,content:'',created_at:1794600000,
 attachments:[{id:id+1,file_type:'fallback',fallback_title:'Attachment Unavailable',data_url:null}]});
const page={id:45,account_id:196799,inbox_id:155865,meta:{sender:{id:1199296717,
 name:'Sait Ciziri Bajari'}},custom_attributes:{yenra_fb_share_links_v1:JSON.stringify(share)}};
test('Cloud verified Page fallback links preserve original messages',()=>{
 const result=verifiedCloudFacebookShareLinks(page,[fallback(ID),fallback(ID2)]);
 assert.equal(result.length,2);
 assert.deepEqual(result.map(x=>x.messageId),[ID,ID2]);
 assert.equal(result[0].url,share[ID]);
});
test('wrong account, missing actual fallback or forged host fails closed',()=>{
 assert.deepEqual(verifiedCloudFacebookShareLinks({...page,account_id:1},[fallback(ID)]),[]);
 assert.deepEqual(verifiedCloudFacebookShareLinks({...page,inbox_id:155900},[fallback(ID)]),[]);
 assert.deepEqual(verifiedCloudFacebookShareLinks({...page,inbox_id:155901},[fallback(ID)]),[]);
 assert.deepEqual(verifiedCloudFacebookShareLinks(page,[{...fallback(ID),source_id:'unverified_mid'}]),[]);
 const image={...fallback(ID),attachments:[{file_type:'image',data_url:'https://example.com/p.jpg'}]};
 assert.deepEqual(verifiedCloudFacebookShareLinks(page,[image]),[]);
 const forged={...page,custom_attributes:{yenra_fb_share_links_v1:JSON.stringify({[ID]:'https://evil.com/share/test'})}};
 assert.deepEqual(verifiedCloudFacebookShareLinks(forged,[fallback(ID)]),[]);
 const duplicate={...page,custom_attributes:{yenra_fb_share_links_v1:JSON.stringify({[ID]:'https://www.facebook.com/share/1BQH62vSjz/'})}};
 assert.deepEqual(verifiedCloudFacebookShareLinks(duplicate,[fallback(ID),fallback(ID)]),[]);
});
test('Cloud Page selection exposes only authenticated original-attachment link scoped by message IDs',async()=>{
 const accountRef='a'.repeat(32);
 const index={byIdentifier:new Map(),byAccountRef:new Map([[accountRef,{channel:'Page'}]])};
 const scopes=[{channel:'Page',cloudInboxId:155865,accountRef}];
 const cloud={getConversation:async()=>page};
 const pageReader={
  verifyMessengerPeer:async()=>({cloudConversationId:45,cloudInboxId:155865,
   cloudContactId:1199296717,metaPsid:'12345678901234567'}),
  readMessages:async()=>[fallback(ID),fallback(ID2)]
 };
 const r=await resolveCloudNativeConversation({cloud,index,scopes,conversationId:45,pageReader});
 assert.equal(r.ok,true);
 assert.deepEqual(r.selection.shareLinks.map(x=>x.messageId),[ID,ID2]);
 assert.equal(r.selection.messages.length,0);
 assert.equal(JSON.stringify(r.selection).includes('12345678901234567'),false);
});

test('future Facebook Page fallback uses genuine native Cloud attachment URL without manual per-contact mapping',()=>{
 const message={...fallback(995081999),source_id:'m_verified_facebook_event_2026',
   attachments:[{id:111,file_type:'fallback',fallback_title:'Shared post',
     data_url:'https://www.facebook.com/share/N3wPhoto123/'}]};
 const newPage={...page,id:80,inbox_id:156456,custom_attributes:{}};
 const out=verifiedCloudFacebookShareLinks(newPage,[message]);
 assert.deepEqual(out,[{messageId:995081999,url:'https://www.facebook.com/share/N3wPhoto123/'}]);
});
test('Facebook native fallback video and post links are clickable but not falsely classified as photos',()=>{
 const messages=[
  {...fallback(10901),source_id:'m_verified_video_event_123',
   attachments:[{file_type:'fallback',data_url:'https://www.facebook.com/reel/122235434708544410/'}]},
  {...fallback(10902),source_id:'m_verified_post_event_1234',
   attachments:[{file_type:'fallback',data_url:'https://www.facebook.com/posts/122235434708544410/'}]}
 ];
 assert.deepEqual(verifiedCloudFacebookShareLinks({...page,custom_attributes:{}},messages),
  [{messageId:10901,url:'https://www.facebook.com/reel/122235434708544410/'},
   {messageId:10902,url:'https://www.facebook.com/posts/122235434708544410/'}]);
});
test('native fallback source must be Meta-sourced, typed fallback and not a forged URL',()=>{
 const native=(source_id,uri)=>({...fallback(10903),source_id,
  attachments:[{file_type:'fallback',data_url:uri}]});
 const scope={...page,custom_attributes:{}};
 for(const candidate of [
  native('$not-a-meta-mid','https://www.facebook.com/share/ValidLink123/'),
  native('m_bogus_facebook_user','https://attacker.example.com/share/ValidLink123/'),
  native('m_bogus_facebook_user','https://www.facebook.com/photo/?fbid=7'),
  native('m_bogus_facebook_user','https://www.facebook.com/share/ValidLink123/#fragment'),
  native('m_bogus_facebook_user','https://www.facebook.com/watch/?v=abc'),
  native('m_bogus_facebook_user','http://www.facebook.com/reel/122235434708544410/'),
  {...native('m_bogus_facebook_user','https://www.facebook.com/share/ValidLink123/'),private:true},
  {...native('m_bogus_facebook_user','https://www.facebook.com/share/ValidLink123/'),message_type:1},
  {...native('m_bogus_facebook_user','https://www.facebook.com/share/ValidLink123/'),attachments:[{file_type:'image',data_url:'https://www.facebook.com/share/ValidLink123/'}]}
 ])assert.deepEqual(verifiedCloudFacebookShareLinks(scope,[candidate]),[]);
});
test('native link cannot override a different message or fall back to an unverified legacy map',()=>{
 const m={...fallback(ID),source_id:'m_authorized_meta_message_012345',
  attachments:[{file_type:'fallback',data_url:'https://evil.example.com/share/Unsafe123/'}]};
 assert.deepEqual(verifiedCloudFacebookShareLinks(page,[m]),[]);
 assert.deepEqual(verifiedCloudFacebookShareLinks(page,[m,m]),[]);
});
test('future authorized Page Cloud identity flows native fallback into its current conversation only',async()=>{
 const id=995081999;
 const m={...fallback(id),source_id:'m_meta_verified_future_message_45678',
  attachments:[{file_type:'fallback',data_url:'https://www.facebook.com/share/Future123456/'}]};
 const newPage={id:80,account_id:196799,inbox_id:156456,
   meta:{sender:{id:1199296718,name:'Verified new Page contact'}},custom_attributes:{}};
 const cloud={getConversation:async()=>newPage,
  listInboxes:async()=>[{id:156456,channelType:'Channel::FacebookPage'}]};
 const pageReader={
  verifyMessengerPeer:async()=>({cloudConversationId:80,cloudInboxId:156456,
    cloudContactId:1199296718,metaPsid:'123456789012345678'}),
  readMessages:async()=>[m]
 };
 const result=await resolveCloudNativeConversation({cloud,index:{byIdentifier:new Map(),byAccountRef:new Map()},
  scopes:[],conversationId:80,pageReader});
 assert.equal(result.ok,true);
 assert.equal(result.selection.kind,'CLOUD_PAGE');
 assert.deepEqual(result.selection.shareLinks,[{messageId:id,url:'https://www.facebook.com/share/Future123456/'}]);
});

test('Lucia original verified Cloud fallback supports Facebook share/p post permalink',()=>{
 const scope={...page,id:49,custom_attributes:{
  yenra_fb_share_links_v1:JSON.stringify({'995639725':'https://www.facebook.com/share/p/1EE1YhFShM/'})}};
 const original={...fallback(995639725),source_id:'m_original_meta_lucia_event_20261114'};
 assert.deepEqual(verifiedCloudFacebookShareLinks(scope,[original]),
  [{messageId:995639725,url:'https://www.facebook.com/share/p/1EE1YhFShM/'}]);
 const forged={...scope,custom_attributes:{yenra_fb_share_links_v1:
  JSON.stringify({'995639725':'https://evil.example.com/share/p/1EE1YhFShM/'})}};
 assert.deepEqual(verifiedCloudFacebookShareLinks(forged,[original]),[]);
});
