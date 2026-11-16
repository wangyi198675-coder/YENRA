/**
 * YENRA Cloud appearance adapter.
 *
 * One visual authority: the existing DSH design tokens inherited by the
 * native inbox seat. Chatwoot owns its original DOM, settings, functionality
 * and message store. No new theme preference, DOM text rewriting, or login
 * intervention.
 *
 * Chatwoot's modern n-* utilities reference BOTH legacy --slate-* and newer
 * --surface-*, --border-* / --solid-* variables. Overriding only --slate-*
 * creates the high-contrast black checkboxes / pale-on-white settings bug.
 */
import {cloudTypography} from './cloud-native-fonts.ts';
type RGB=[number,number,number];
const asString=(value:RGB):string=>value.join(' ');
const clamp=(n:number):number=>Math.max(0,Math.min(255,Math.round(n)));
function parseRgb(raw:string):RGB|null{
 const value=raw.trim();
 const h=/^#([a-f\d]{6})$/iu.exec(value);
 if(h)return [0,2,4].map(i=>parseInt(h[1].slice(i,i+2),16)) as RGB;
 const short=/^#([a-f\d]{3})$/iu.exec(value);
 if(short)return [...short[1]].map(x=>parseInt(x+x,16)) as RGB;
 const m=/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/iu.exec(value);
 return m?[Number(m[1]),Number(m[2]),Number(m[3])].map(clamp) as RGB:null;
}
function blend(a:RGB,b:RGB,portion:number):RGB{
 return a.map((v,i)=>clamp(v+(b[i]-v)*portion)) as RGB;
}
function darkFrom(base:RGB):boolean{
 const linear=base.map(n=>{const x=n/255;return x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4});
 return linear[0]*0.2126+linear[1]*0.7152+linear[2]*0.0722<0.35;
}
export function cloudNativeTheme(host:HTMLElement):string{
 const theme=getComputedStyle(host);
 const read=(key:string,fallback:RGB):RGB=>
   parseRgb(theme.getPropertyValue('--dsw-alias-'+key))??fallback;
 // Appearance plugins may make the DSH alias transparent so a background image
 // can show through. Do not mistake that transparent token for a LIGHT palette:
 // use the plugin's real backdrop color before falling back to a default.
 const mode=host.ownerDocument?.documentElement?.getAttribute('data-ds-theme-source')==='dark'?'dark':'light';
 const appearanceBase=parseRgb(theme.getPropertyValue('--dsw-appearance-bg-base-'+mode));
 const primaryInk=parseRgb(theme.getPropertyValue('--dsw-alias-label-primary'));
 const fallback=appearanceBase??(primaryInk!==null&&!darkFrom(primaryInk)?[21,23,28] as RGB:[255,255,255] as RGB);
 const base=read('bg-base',fallback);
 const dark=darkFrom(base);
 const ink=read('label-primary',dark?[233,237,243]:[37,45,56]);
 const muted=read('label-secondary',dark?[166,176,192]:[105,120,139]);
 const layer1=read('bg-layer-1',base);
 const layer2=read('bg-layer-2',blend(base,ink,dark?0.09:0.035));
 const selected=read('bg-layer-3',blend(base,ink,dark?0.15:0.085));
 const border=read('border-l2',blend(base,ink,dark?0.20:0.15));
 const strong=blend(border,muted,dark?0.45:0.50);
 const brand=read('brand-primary',dark?[200,180,146]:[40,48,58]);
 // Every value is an inherited DSH color, not a second Cloud palette.
 const colors:Record<string,RGB>={
   'background-color':base,
   'surface-1':layer1,'surface-2':layer2,'surface-3':selected,
   'surface-active':selected,
   'card-color':layer1,'button-color':layer2,
   'border-weak':border,'border-strong':strong,
   'outline-weak':border,'outline-strong':strong,
   'slate-1':base,'slate-2':layer1,'slate-3':selected,
   'slate-4':border,'slate-5':border,'slate-6':border,
   'slate-7':blend(border,muted,0.25),
   'slate-8':blend(border,muted,0.50),
   'slate-9':blend(border,muted,0.75),
   'slate-10':muted,'slate-11':muted,'slate-12':ink,
   'solid-1':layer1,'solid-2':layer2,'solid-3':selected,
   'solid-blue':selected,'solid-blue-2':base,
   'blue-3':selected,'blue-9':brand,'blue-10':brand,
   'blue-11':brand,'blue-12':ink,'text-blue':ink,
 };
 // Chatwoot also defines its neutral palette directly on body.dark. A
 // root-only theme injection cannot win against these descendant tokens.
 // Keep exactly one authoritative DSH palette at both native levels.
 const declarations=Object.entries(colors).map(([k,v])=>'--'+k+':'+asString(v)+'!important');
 const translucent:Record<string,string>={
   // The account menu uses rgba(var(--alpha-3)); missing this token caused
   // the screenshot's white dropdown background with white menu labels.
   'alpha-1':dark?'255,255,255,.09':'0,0,0,.05',
   'alpha-2':dark?'255,255,255,.12':'0,0,0,.08',
   'alpha-3':asString(layer1).replace(/ /g,',')+',.96',
   'black-alpha-1':dark?'0,0,0,.35':'0,0,0,.12',
   'black-alpha-2':dark?'0,0,0,.2':'0,0,0,.04',
   'white-alpha':dark?'255,255,255,.11':'255,255,255,.8',
   'button-hover-color':dark?'255,255,255,.1':'0,0,0,.05',
   'background-input-box':dark?'255,255,255,.04':'0,0,0,.03',
 };
 const extras:Record<string,RGB>={
   'border-container':border,'solid-active':selected,
   'label-background':layer2,'label-border':border,
 };
 declarations.push(...Object.entries(extras).map(([k,v])=>'--'+k+':'+asString(v)+'!important'));
 declarations.push(...Object.entries(translucent).map(([k,v])=>'--'+k+':'+v+'!important'));
 // The Cloud official login remains untouched. All rules are scoped to the
 // authenticated Cloud document by CloudNativeInbox.applyVisuals().
 return 'html:root,html:root body{color-scheme:'+(dark?'dark':'light')+
   '!important;'+declarations.join(';')+'}'+cloudTypography(host);
}
