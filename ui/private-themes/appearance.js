// Pure service adapter. No React, DOM, timers, localStorage, or preference writes from change events.
export function createAppearanceController({theme,subscribe,onExternalMode=()=>{},onChanged=()=>{}}) {
  let state=null,pairs=null,disposeLayer=null,busy=false,stopped=false,lastPreference=theme.getTheme().preference;
  const source='@local/yenra-private-themes';
  function updateLayer(snapshot) {
    if(!pairs || busy || stopped)return;
    if(!Object.entries(pairs).some(([key,modes])=>snapshot.active.tokens[key]!==modes[snapshot.active.colorScheme]))return;
    busy=true;
    try {
      const previous=disposeLayer;
      disposeLayer=theme.overrideTokens(source,pairs);
      previous?.(); // old disposer cannot remove a newer layer of the same source.
    } finally {busy=false;}
  }
  const off=subscribe(snapshot=>{
    if(busy || stopped)return;
    updateLayer(snapshot);
    const pref=theme.getTheme().preference;
    if(state?.enabled && pref!==lastPreference && ['light','dark','system'].includes(pref))onExternalMode(pref);
    lastPreference=pref;
    onChanged();
  });
  return {
    apply(next,nextPairs) {
      if(stopped)return;
      const syncMode=next.enabled ? state?.enabled!==true || state.mode!==next.mode : state?.enabled===true && state.mode!==next.mode;
      state=next;pairs=next.enabled?nextPairs:null;
      busy=true;
      try {
        if(syncMode && theme.getTheme().preference!==next.mode)theme.setTheme(next.mode);
        if(!pairs){disposeLayer?.();disposeLayer=null;}
      } finally {busy=false;}
      updateLayer(theme.getTheme());
      lastPreference=theme.getTheme().preference;
      onChanged();
    },
    dispose() {stopped=true;off();disposeLayer?.();disposeLayer=null;}
  };
}
