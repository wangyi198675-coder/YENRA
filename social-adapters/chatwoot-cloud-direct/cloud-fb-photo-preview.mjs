/** Read-only Facebook canonical photo resolver for verified Messenger share links.
 * Uses the public Facebook HTTPS redirect, never a user cookie or new sender.
 * Only two verified share URLs are resolved at once. The short-lived result
 * cache is in process memory, not a chat database.
 */
const cache=new Map();
const validPhotoId=s=>typeof s==='string'&&/^\d{10,25}$/u.test(s);
export async function enrichVerifiedFacebookPhotoLinks(links,{
 fetchImpl=fetch,timeoutMs=1800
}={}){
 if(!Array.isArray(links)||links.length>20)return [];
 const subset=links.slice(0,4);
 const enriched=await Promise.all(subset.map(async link=>{
  const url=link?.url;
  if(typeof url!=='string')return link;
  let u;try{u=new URL(url)}catch{return link}
  if(u.protocol!=='https:'||!['www.facebook.com','facebook.com','m.facebook.com'].includes(u.hostname))
   return link;
  if(/^\/photo\/?$/u.test(u.pathname)){
   const id=u.searchParams.get('fbid');
   return validPhotoId(id)?{...link,photoId:id}:link;
  }
  if(!/^\/share\/[A-Za-z0-9]+\/?$/u.test(u.pathname))return link;
  const now=Date.now(),hit=cache.get(url);
  if(hit&&hit.until>now)return hit.photoId?{...link,photoId:hit.photoId}:link;
  let photoId=null;
  try{
   const response=await fetchImpl(url,{method:'GET',redirect:'manual',
      signal:AbortSignal.timeout(Math.max(300,Math.min(2500,timeoutMs))),
      headers:{'accept':'text/html'}});
   if(response.status===301||response.status===302||response.status===303||response.status===307||response.status===308){
    const location=response.headers.get('location');
    if(location){
     const canonical=new URL(location,url);
     if(canonical.protocol==='https:'&&canonical.hostname==='www.facebook.com'&&
        /^\/photo\/?$/u.test(canonical.pathname)&&
        validPhotoId(canonical.searchParams.get('fbid')))
       photoId=canonical.searchParams.get('fbid');
    }
   }
   await response.body?.cancel?.();
  }catch{}
  cache.set(url,{photoId,until:now+(photoId?60*60*1000:90*1000)});
  if(cache.size>200)cache.delete(cache.keys().next().value);
  return photoId?{...link,photoId}:link;
 }));
 return enriched.concat(links.slice(4));
}
