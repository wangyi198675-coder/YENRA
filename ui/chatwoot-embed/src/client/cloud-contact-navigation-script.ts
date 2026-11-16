/**
 * Correct the previous YENRA-only duplicate navigation augmentation.
 * Keep original Chatwoot Cloud list, controls and routing untouched.
 * Safely undo the transient legacy buttons and overlay in a retained webview.
 */
export const CLOUD_CONTACT_NAVIGATION_SCRIPT=String.raw`(()=>{
  if(!/^\/app\/accounts\/196799\/conversations(?:\/\d+)?\/?$/u.test(location.pathname))return false;
  const legacy=window.__yenraCloudContactNavigationV1;
  if(legacy){
    try{legacy.close?.();legacy.disconnect?.()}catch{}
    try{delete window.__yenraCloudContactNavigationV1}catch{}
  }
  document.body.classList.remove('yenra-cloud-contact-list-open');
  document.querySelectorAll('.yenra-cloud-show-contacts,.yenra-cloud-hide-contacts')
    .forEach(element=>element.remove());
  const list=document.querySelector('.conversations-list-wrap');
  if(list?.id==='yenra-cloud-native-contact-list')list.removeAttribute('id');
  return true;
})()`;
