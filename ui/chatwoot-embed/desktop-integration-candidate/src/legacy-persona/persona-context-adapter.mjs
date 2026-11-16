/* Isolated CCv3 contextual adapter. No production calls, DB writes or Sender. */
import {createHash} from 'node:crypto';
export function personaRevision(card) {
 if (card?.spec !== 'chara_card_v3' || card?.data?.name !== 'Yeonhee') throw Error('INVALID_PERSONA_CARD');
 return createHash('sha256').update(JSON.stringify(card.data)).digest('hex');
}
export function selectLore(card,latestMessage,extraText='') {
 const text=(String(latestMessage||'')+'\n'+String(extraText||'')).toLocaleLowerCase();
 return (card.data.character_book?.entries||[]).filter(e=>e.enabled!==false &&
  (e.constant===true || (e.keys||[]).some(k=>k && text.includes(k.toLocaleLowerCase()))))
  .sort((a,b)=>(b.priority??0)-(a.priority??0)||(a.insertion_order??0)-(b.insertion_order??0))
  .map(e=>({id:e.id,name:e.name,content:e.content,priority:e.priority??0}));
}
export function buildPersonaContext({card,latestMessage='',recentVerifiedHistory='',verifiedContactFacts='',
 ownerCorrections='',channel='FB_PAGE',contextWindowTokens=null,reservedRecentHistoryTokens=0,reservedReplyTokens=1024}) {
 const revision=personaRevision(card);
 if(!['FB_PAGE','FB_PERSONAL','WHATSAPP'].includes(channel)) throw Error('INVALID_CHANNEL');
 const c=card.data;
 const core=['[YEONHEE_PERSONA_CORE]',c.description,c.personality,c.scenario,c.system_prompt,
  c.post_history_instructions,ownerCorrections?('Owner corrections take precedence: '+ownerCorrections):'',
  '[/YEONHEE_PERSONA_CORE]'].filter(Boolean).join('\n');
 const history='[VERIFIED_CURRENT_CONTACT_ONLY]\n'+String(verifiedContactFacts)+'\n'+String(recentVerifiedHistory)+
  '\nLatest: '+String(latestMessage)+'\n[/VERIFIED_CURRENT_CONTACT_ONLY]';
 const selected=selectLore(card,latestMessage,recentVerifiedHistory);
 const budget=Number.isInteger(contextWindowTokens)&&contextWindowTokens>0
  ?Math.max(0,contextWindowTokens-reservedRecentHistoryTokens-reservedReplyTokens):null;
 // Approximate token count here; native model tokenizer replaces it in actual DSH.
 const estimate=s=>Math.ceil(s.length/3);
 if(budget!==null && estimate(core+history)>budget) throw Error('MODEL_CONTEXT_INSUFFICIENT_KEEP_LATEST_HISTORY');
 let lore='';const admitted=[];
 for(const e of selected){
  const part='\n[LORE: '+e.name+']\n'+e.content+'\n[/LORE]';
  if(budget!==null && estimate(core+history+lore+part)>budget)continue;
  lore+=part;admitted.push(e.name);
 }
 return {roleId:'yance:girlfriend-brain',revision,channel,selectedLore:admitted,
  completeCardRetained:true,estimatedInputTokens:estimate(core+history+lore),
  prompt:core+'\n[YEONHEE_RELEVANT_LORE]'+lore+'\n[/YEONHEE_RELEVANT_LORE]\n'+history};
}
export function verifySingleCanonicalPersona({webRevision,headlessRevision}){
 if(!webRevision||!headlessRevision||webRevision!==headlessRevision) throw Error('PERSONA_REVISION_MISMATCH');
 return {ok:true,revision:webRevision,roleId:'yance:girlfriend-brain'};
}
