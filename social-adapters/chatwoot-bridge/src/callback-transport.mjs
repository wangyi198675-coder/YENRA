/** Isolated callback path probe. No Host client, roster, Sender, or platform requests. */
import { createServer } from 'node:http';
import { isIPv4 } from 'node:net';
import { createBridgeServer } from './server.mjs';
import { verifyChatwootSignature } from './contract.mjs';
import { silentLogger } from './logger.mjs';

export function assertWslBind(bind, interfaces) {
  if (!isIPv4(bind) || bind === '0.0.0.0') throw new Error('DEDICATED_WSL_BIND_REQUIRED');
  const found = Object.entries(interfaces).some(([name, entries]) =>
    /WSL/iu.test(name) && entries?.some(entry => entry.address === bind && !entry.internal));
  if (!found) throw new Error('BIND_NOT_ON_WINDOWS_WSL_INTERFACE');
}

/** Existing bridge HTTP parsing, with a STRICT exact-source gate (no implicit loopback). */
export function createNoSendCallbackTransport({ peer, secret, nowSeconds, onVerified = () => {} } = {}) {
  if (!isIPv4(peer)) throw new Error('EXACT_WSL_PEER_REQUIRED');
  if (typeof secret !== 'string' || secret.length < 16) throw new Error('PROBE_SECRET_REQUIRED');
  const state = { enableRealSend:false, allowedPeer:`${peer}/32`, requests:0, sourceRejected:0,
    signatureRejected:0, syntheticVerified:0, observedPeer:null };
  const outbound = { async handle({ rawBody, headers }) {
    const verified = verifyChatwootSignature({ rawBody, secret,
      timestamp:headers['x-chatwoot-timestamp'], signature:headers['x-chatwoot-signature'],
      ...(nowSeconds ? {nowSeconds:nowSeconds()} : {}) });
    if (!verified.ok) {
      state.signatureRejected++;
      return {status:401, body:{ok:false,error:verified.reason,enableRealSend:false}};
    }
    let payload;
    try { payload=JSON.parse(rawBody); } catch { return {status:400,body:{ok:false,error:'INVALID_JSON'}}; }
    // Never accept or inspect a real conversation or message. Trigger failure
    // handling cannot update a real row because this event is not message_created.
    if (payload?.event !== 'yenra_transport_probe' || payload.synthetic !== true ||
        payload.id !== undefined || payload.conversation !== undefined) {
      return {status:422,body:{ok:false,error:'SYNTHETIC_PROBE_ONLY',enableRealSend:false}};
    }
    state.syntheticVerified++;
    setImmediate(() => onVerified({...state}));
    return {status:202,body:{ok:true,status:'NO_SEND_TRANSPORT_VERIFIED',enableRealSend:false}};
  } };
  const native = createBridgeServer({outbound,logger:silentLogger,allowCidrs:[`${peer}/32`]});
  // Use its pure handler only, not its listener. Our outer exact-peer gate is stricter.
  async function handleRequest(request,response) {
    state.requests++;
    const source=String(request.socket?.remoteAddress??'').replace(/^::ffff:/u,'');
    if (source !== peer) {
      state.sourceRejected++;
      response.writeHead(403,{'content-type':'application/json'});
      response.end(JSON.stringify({ok:false,error:'EXACT_WSL_SOURCE_REQUIRED',enableRealSend:false}));
      return;
    }
    state.observedPeer=source;
    // Do not expose the ordinary bridge health endpoint through this probe.
    if (request.url !== '/webhooks/chatwoot') {
      response.writeHead(404);response.end();return;
    }
    return native.handleRequest(request,response);
  }
  const server=createServer((request,response)=>{
    void handleRequest(request,response).catch(()=>{
      if(!response.headersSent)response.writeHead(500);
      response.end();
    });
  });
  return {server,handleRequest,state};
}
