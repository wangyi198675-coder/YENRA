import test from'node:test';import assert from'node:assert/strict';
import{buildInboundMessage}from'../chatwoot-bridge/src/contract.mjs';
import{attachVerifiedNativeTranslation}from'./cloud-native-model-translation.mjs';
const original=()=>buildInboundMessage({
mid:'HOST-ORIGINAL-MID-123',text:'Guten Abend, wie geht es dir?',timestamp:Date.now()-2000
});
test('native create payload preserves MID and original, adds only saved zh_CN',()=>{
 const src=original();const x=attachVerifiedNativeTranslation(src,{
 translation:'晚上好，你怎么样？',sourceLanguage:'de',modelRoute:'yenra-dsh:openai-codex'});
 assert.equal(x.content,src.content);assert.equal(x.source_id,src.source_id);
 assert.equal(x.message_type,'incoming');assert.equal(x.private,false);
 assert.equal(x.content_attributes.translations.zh_CN,'晚上好，你怎么样？');
 assert.equal(x.content_attributes.translation_provider,'yenra-dsh:openai-codex');
 assert.equal(src.content_attributes.translations,undefined);
 assert.equal(x.content_attributes.yenra_original_platform_mid,src.source_id);
});
test('invalid, unchanged or missing Chinese rejects rather than claiming native translation',()=>{
 for(const translation of ['', 'Guten Abend, wie geht es dir?','Hello everyone', ' ']){
  assert.throws(()=>attachVerifiedNativeTranslation(original(),{
    translation,modelRoute:'yenra-dsh:openai-codex'}),/TRANSLATION_NOT_REAL_ZH_CN/);
 }
});
test('cross-direction or forged MID never attaches, preventing double-Sender behaviour',()=>{
 for(const v of [{message_type:'outgoing'},{private:true},
   {source_id:'FAKE'},{content_attributes:{yenra_original_platform_mid:'FAKE'}}]){
   assert.throws(()=>attachVerifiedNativeTranslation({...original(),...v},
     {translation:'你好',modelRoute:'yenra-dsh:openai-codex'}),
     /ORIGINAL_MID_AND_DIRECTION_REQUIRED/);
 }
});
test('rejects unverified model route and invalid source language',()=>{
 assert.throws(()=>attachVerifiedNativeTranslation(original(),
    {translation:'你好',modelRoute:'some-gateway-key'}),/PROVIDER_UNVERIFIED/);
 assert.throws(()=>attachVerifiedNativeTranslation(original(),
    {translation:'你好',modelRoute:'yenra-dsh:openai-codex',sourceLanguage:'../../secrets'}),
    /LANGUAGE_INVALID/);
});
test('never overwrites native existing translations',()=>{
 const x=original();x.content_attributes.translations={zh_CN:'已有译文'};
 assert.throws(()=>attachVerifiedNativeTranslation(x,{translation:'你好',modelRoute:'yenra-dsh:openai-codex'}),/ALREADY_PRESENT/);
});
