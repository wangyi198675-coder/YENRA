/** Run only with an ephemeral synthetic probe secret; changes no bridge/profile configuration. */
import { networkInterfaces } from 'node:os';
import { pathToFileURL } from 'node:url';
import { assertWslBind, createNoSendCallbackTransport } from './callback-transport.mjs';

export function launchCallbackProbe({bind,peer,port=31918,ttlSeconds=180,secret}={}) {
  assertWslBind(bind,networkInterfaces());
  if(!Number.isSafeInteger(port)||port<1024||port>65535||port===31917)throw new Error('ISOLATED_PROBE_PORT_REQUIRED');
  if(!Number.isSafeInteger(ttlSeconds)||ttlSeconds<1||ttlSeconds>600)throw new Error('PROBE_TTL_INVALID');
  process.env.ENABLE_REAL_SEND='false';
  const probe=createNoSendCallbackTransport({peer,secret,onVerified:state=>{
    console.log(JSON.stringify({event:'callback.probe_verified',...state}));
    probe.server.close();
  }});
  const timer=setTimeout(()=>{
    console.log(JSON.stringify({event:'callback.probe_expired',...probe.state}));
    probe.server.close();
    process.exitCode=2;
  },ttlSeconds*1000);
  probe.server.once('close',()=>clearTimeout(timer));
  probe.server.once('error',error=>{
    clearTimeout(timer);
    console.error(JSON.stringify({event:'callback.probe_error',code:error.code??'UNKNOWN',enableRealSend:false}));
    process.exitCode=1;
  });
  probe.server.listen(port,bind,()=>console.log(JSON.stringify({event:'callback.probe_listening',bind,port,allowedPeer:`${peer}/32`,enableRealSend:false})));
  return probe;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const args=process.argv.slice(2);
    const options={};
    for(let i=0;i<args.length;i+=2) {
      const key=args[i];
      if(!['--bind','--peer','--port','--ttl-seconds'].includes(key)||!args[i+1])throw new Error('INVALID_PROBE_ARGUMENT');
      options[key.slice(2)]=args[i+1];
    }
    launchCallbackProbe({bind:options.bind,peer:options.peer,
      port:Number(options.port??31918),ttlSeconds:Number(options['ttl-seconds']??180),secret:process.env.YENRA_CALLBACK_PROBE_SECRET});
  } catch(error) {
    console.error(JSON.stringify({event:'callback.probe_refused',code:error.message,enableRealSend:false}));
    process.exitCode=1;
  }
}
