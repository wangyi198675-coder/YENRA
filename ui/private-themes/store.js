import { normalizeState, transition } from './core.js';
// Serialise the entire RMW transaction, not just backend writes.
export function createStateStore({read,write,validate=x=>x}) {
  let tail=Promise.resolve(),closed=false;
  const operate=request=>{
    const job=tail.then(async()=>{
      if(closed) return {ok:false,code:'closed',message:'Theme store is closed'};
      const current=validate(read());
      try {
        const next=validate(transition(current,request));
        if(request.action==='get') return {ok:true,state:normalizeState(current)};
        const unchanged=JSON.stringify({...next,revision:0})===JSON.stringify({...current,revision:0});
        if(unchanged) return {ok:true,state:normalizeState(current)};
        await write(next);
        return {ok:true,state:next};
      } catch(error) {
        const message=String(error.message||error);
        return {ok:false,code:message.startsWith('REVISION_CONFLICT')?'conflict':'rejected',message,state:normalizeState(read())};
      }
    }).catch(error=>({ok:false,code:'storage',message:String(error.message||error)}));
    tail=job.then(()=>{}); return job;
  };
  return {operate,async close(){closed=true;await tail;}};
}
