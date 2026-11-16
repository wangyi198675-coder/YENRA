/**
 * Display-only annotation of the authenticated Chatwoot Cloud contact panel.
 * Native buttons, profile/attachment forms, handlers and data are untouched.
 * The same selectors are guarded by actual native section headings, so
 * upstream reorder / partial loads cannot hide a useful module.
 */
export const CLOUD_PRIVATE_SIDEBAR_SCRIPT=String.raw`(()=>{
  if(!/^\/app\/accounts\/196799\//u.test(location.pathname))return false;
  const key='__yenraPrivateContactPanelV2';
  if(window[key]?.refresh){window[key].refresh();return true}
  const visibleLabels=new Set(['联系人备注','附件']);
  const hiddenLabels=new Set(['对话操作','宏','对话信息','联系人属性',
    '上一次对话','对话参与者','已链接的 Linear 问题']);
  let queued=false;
  const refresh=()=>{
    queued=false;
    const list=document.querySelector('.list-group > .flex.flex-col.gap-3');
    if(list){
      for(const item of list.children){
        // Chatwoot's draggable native cards do not share one class.
        // Gate on their common direct child contract and native heading.
        if(item.getAttribute('data-draggable')!=='true')continue;
        const heading=item.querySelector('button.drag-handle h5')?.textContent?.trim();
        if(!heading)continue;
        if(visibleLabels.has(heading))item.dataset.yenraPrivateSection='keep';
        else if(hiddenLabels.has(heading))item.dataset.yenraPrivateSection='hide';
        else delete item.dataset.yenraPrivateSection; // upstream unknown: fail open
      }
      if(!list.querySelector(':scope > .yenra-cloud-export')){
        const wrap=document.createElement('div');
        wrap.className='yenra-cloud-export';
        const button=document.createElement('button');
        button.type='button';button.className='yenra-cloud-export-button';
        button.textContent='导出聊天记录 / 报表';
        button.setAttribute('aria-label','导出当前联系人聊天记录');
        button.addEventListener('click',()=>{
          const m=/^\/app\/accounts\/196799\/conversations\/(\d+)\/?$/u.exec(location.pathname);
          if(!m)return;
          const conversationId=Number(m[1]);
          if(!Number.isSafeInteger(conversationId)||conversationId<=0)return;
          console.info('YENRA_PRIVATE_CLOUD_EXPORT_CLICK:'+conversationId);
        });
        wrap.appendChild(button);list.appendChild(wrap);
      }
    }
    // The top of the native CRM card can show empty email/phone/company
    // and an opaque integration ID. Mark ONLY those specific display rows.
    // Never touch the contact avatar, name, 4 action buttons or their inputs.
    const profile=document.querySelector('[channel-type]');
    if(profile){
      // The original Cloud pencil button owns the editor / avatar file picker.
      // Add only a small shortcut on the real photo; never upload, replace
      // or synthesize an avatar without a deliberate user file selection.
      // Native main action "Edit contact" opens the full Cloud contact form.
      // Do not mistakenly reuse the small inline name/field pencil.
      const pencil=profile.querySelector('button:has(.i-ph-pencil-simple)');
      const avatar=profile.querySelector('img[alt]');
      const frame=avatar?.closest('[role=img]')?.parentElement;
      if(pencil&&frame&&!frame.querySelector('.yenra-avatar-edit-button')){
        const edit=document.createElement('button');
        edit.type='button';edit.className='yenra-avatar-edit-button';
        edit.setAttribute('aria-label','编辑联系人及上传头像');
        edit.title='编辑联系人／更换头像';
        edit.textContent='✎';
        edit.addEventListener('click',event=>{
          event.preventDefault();event.stopPropagation();pencil.click();
        });
        frame.appendChild(edit);
      }
      // The native CRM metadata contains email/phone/integration ID/company,
      // not the four useful actions. Suppress the whole metadata group in
      // private view, leaving Cloud's original data and actions untouched.
      const body=profile.firstElementChild;
      const identity=body?.children[1];
      const metadata=identity?.children[1];
      if(metadata?.classList.contains('flex')&&
         metadata.classList.contains('flex-col')&&
         metadata.classList.contains('items-start')&&
         metadata.classList.contains('w-full')&&
         metadata.querySelector('button')){
         // Native Chatwoot keeps social profiles in the last metadata row.
         // The old blanket hide also removed the verified Facebook homepage.
         // Keep only the REAL Cloud social link row, never recreate URLs/data.
         const trustedSocialHosts=new Set(['facebook.com','www.facebook.com',
           'instagram.com','www.instagram.com','linkedin.com','www.linkedin.com',
           'twitter.com','www.twitter.com','x.com','www.x.com','tiktok.com',
           'www.tiktok.com','github.com','www.github.com','t.me','telegram.me',
           'wa.me','api.whatsapp.com']);
         let visibleSocialRows=0,visiblePhoneRows=0;
         for(const row of metadata.children){
           const nativeSocialRow=row.classList.contains('flex')&&
             row.classList.contains('items-center')&&row.classList.contains('gap-3')&&
             row.classList.contains('my-2');
           const validSocial=nativeSocialRow&&
             [...row.querySelectorAll('a[href]')].some(a=>{
               try{
                 const u=new URL(a.href);
                 return u.protocol==='https:'&&trustedSocialHosts.has(u.hostname)&&
                   !u.username&&!u.password;
               }catch{return false}
             });
           if(validSocial){
             row.dataset.yenraContactSocialLinks='keep';
             visibleSocialRows++;
           }else delete row.dataset.yenraContactSocialLinks;
           // The original WhatsApp phone field is useful contact identity,
           // not an opaque YENRA source ID. Retain only a real E.164 phone
           // displayed by the native Chatwoot card; never generate one.
           const raw=row.textContent?.trim()??'';
           // Native Chatwoot uses a tel: anchor for the actual phone field.
           // Allow only dial links, not unrelated profile/website anchors.
           const onlyDialLinks=[...row.querySelectorAll('a[href]')]
             .every(a=>(a.getAttribute('href')??'').trim().toLowerCase().startsWith('tel:'));
           const hasPhone=/\+[1-9][0-9]{6,14}(?![0-9])/u.test(raw)&&
             onlyDialLinks&&!validSocial;
           if(hasPhone){
             row.dataset.yenraContactPhone='keep';
             visiblePhoneRows++;
           }else delete row.dataset.yenraContactPhone;
         }
         metadata.dataset.yenraContactMetadata=
           visibleSocialRows||visiblePhoneRows?'native-details':'hide';
      }
      for(const node of profile.querySelectorAll('span,a')){
        const txt=node.textContent?.trim()??'';
        if(txt!=='不可用'&&!/^yenra-[a-z0-9-]{22,}$/iu.test(txt))continue;
        let row=node.closest('div.flex.items-center,div.flex.gap-2');
        if(!row||!profile.contains(row)||row.querySelector('button,input,img'))continue;
        if((row.textContent?.trim()??'').length>100)continue;
        row.dataset.yenraEmptyContact='true';
      }
    }
  };
  const schedule=()=>{if(queued)return;queued=true;queueMicrotask(refresh)};
  const observer=new MutationObserver(mutations=>{
    for(const m of mutations){
      if(m.type!=='childList'||!m.addedNodes.length)continue;
      // Ignore the rapidly updating chat message list.
      const parent=m.target?.nodeType===1?m.target:null;
      if(parent?.closest?.('.list-group,[channel-type]')){schedule();break}
      let relevant=false;
      for(const n of m.addedNodes){
        if(n.nodeType!==1)continue;
        if(n.matches?.('.list-group,.conversation--actions,[channel-type]')||
           n.querySelector?.('.list-group,.conversation--actions,[channel-type]')){
          relevant=true;break;
        }
      }
      if(relevant){schedule();break}
    }
  });
  observer.observe(document.body,{childList:true,subtree:true});
  window[key]={version:2,refresh,disconnect:()=>observer.disconnect()};
  refresh();
  return true;
})()`;
