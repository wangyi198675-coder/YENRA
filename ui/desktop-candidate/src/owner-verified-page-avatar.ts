/** Exact owner-confirmed Facebook profile photo fallback for an original Page room.
 * Reuses the original Host/account scope. This is a static owner-provided asset,
 * not another provider, avatar database, watcher, or credential store.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REF=/^[a-f0-9]{32}$/
const PEER=/^[0-9]{5,40}$/
const PNG=Buffer.from('89504e470d0a1a0a','hex')
const sha=(value:string)=>createHash('sha256').update(value).digest('hex').slice(0,32)
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')

export function readOwnerVerifiedPageAvatar(root:string, {
 accountRef,roomRef,peerId
}:{accountRef:string;roomRef:string;peerId:string}):
 {mime:'image/png';bytes:Buffer}|null {
 if(!REF.test(accountRef)||!REF.test(roomRef)||!PEER.test(peerId))return null
 try {
  const registry=JSON.parse(readFileSync(join(root,'config','OWNER_VERIFIED_PAGE_AVATARS.v1.json'),'utf8'))
  if(registry?.version!==1||registry?.source!=='OWNER_AUTHENTICATED_FACEBOOK_PROFILE_SCREENSHOT'||
     !Array.isArray(registry.records)||registry.records.length>100)return null
  const exact=registry.records.filter((r:any)=>
    r?.accountRef===accountRef&&r?.roomRef===roomRef&&
    r.peerProof===sha('OWNER_AVATAR_PEER|'+accountRef+'|'+roomRef+'|'+peerId)&&
    r.source==='BROWSER_VERIFIED_PROFILE_PHOTO'&&r.mime==='image/png')
  if(exact.length!==1)return null
  const r=exact[0]
  const filename=sha('YENRA-OWNER-VERIFIED-PAGE-AVATAR|'+accountRef+'|'+roomRef)+'.png'
  if(r.imageName!==filename||!Number.isSafeInteger(r.imageWidth)||
     !Number.isSafeInteger(r.imageHeight)||r.imageWidth<32||r.imageWidth>512||
     r.imageHeight!==r.imageWidth||typeof r.sha256!=='string'||
     !/^[a-f0-9]{64}$/.test(r.sha256))return null
  // Filename is derived from scoped refs, never from config or browser URL.
  const bytes=readFileSync(join(root,'runtime','owner-verified-avatars',filename))
  if(bytes.length<1000||bytes.length>250000||
     !bytes.subarray(0,8).equals(PNG)||
     bytes.toString('ascii',12,16)!=='IHDR'||
     bytes.readUInt32BE(16)!==r.imageWidth||
     bytes.readUInt32BE(20)!==r.imageHeight||
     digest(bytes)!==r.sha256)return null
  return {mime:'image/png',bytes}
 }catch{return null}
}
