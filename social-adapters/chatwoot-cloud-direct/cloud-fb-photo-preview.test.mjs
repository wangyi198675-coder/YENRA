import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichVerifiedFacebookPhotoLinks} from './cloud-fb-photo-preview.mjs';
test('public official photo redirect enriches only the verified share with canonical photo ID',async()=>{
 const link='https://www.facebook.com/share/QATEST01/';
 const r=await enrichVerifiedFacebookPhotoLinks([{messageId:123,url:link}],{
  fetchImpl:async(url,options)=>{
   assert.equal(url,link);
   assert.equal(options.redirect,'manual');
   return {status:302,headers:{get:key=>key==='location'?'https://www.facebook.com/photo/?fbid=122235434708544410':null},
     body:{cancel:async()=>{}}};
  }});
 assert.deepEqual(r,[{messageId:123,url:link,photoId:'122235434708544410'}]);
});
test('unexpected redirect domain cannot become a Messenger preview',async()=>{
 const link='https://www.facebook.com/share/QATEST02/';
 const r=await enrichVerifiedFacebookPhotoLinks([{messageId:123,url:link}],{
  fetchImpl:async()=>({status:302,headers:{get:()=> 'https://attacker.example.com/photo/?fbid=122235434708544410'},
    body:{cancel:async()=>{}}})});
 assert.deepEqual(r,[{messageId:123,url:link}]);
});
test('no extra fetch for canonical Facebook photo link',async()=>{
 const url='https://www.facebook.com/photo/?fbid=122242327922544410';
 const r=await enrichVerifiedFacebookPhotoLinks([{messageId:12,url}],{
   fetchImpl:()=>{throw Error('MUST_NOT_FETCH')}});
 assert.equal(r[0].photoId,'122242327922544410');
});
test('no preview for invalid Facebook share URL',async()=>{
 const r=await enrichVerifiedFacebookPhotoLinks([{messageId:1,url:'https://example.com/share/123'}],{
   fetchImpl:()=>{throw Error('MUST_NOT_FETCH')}});
 assert.equal(r[0].photoId,undefined);
});
