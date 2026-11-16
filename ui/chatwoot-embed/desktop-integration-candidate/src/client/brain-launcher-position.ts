/**
 * YENRA Brain launcher UI-only preference, shared by the ONE DSH renderer.
 * Relative coordinates survive pane resizing, DPI changes and restarts.
 * No social data, native Session or second storage system is created.
 */
export const BRAIN_LAUNCHER_POSITION_KEY='yenra.desktop.v2.brainLauncherPosition.v1'
export type BrainLauncherPosition={x:number;y:number}
export type BrainLauncherBounds={minX:number;maxX:number;minY:number;maxY:number}
const clamp=(n:number,min:number,max:number)=>Math.min(max,Math.max(min,n))
const normalized=(position:unknown):position is BrainLauncherPosition=>{
  if(!position||typeof position!=='object'||Array.isArray(position))return false
  const p=position as Record<string,unknown>
  return typeof p.x==='number'&&Number.isFinite(p.x)&&p.x>=0&&p.x<=1&&
    typeof p.y==='number'&&Number.isFinite(p.y)&&p.y>=0&&p.y<=1
}
export function parseBrainLauncherPosition(input:string|null):BrainLauncherPosition|null{
  if(!input||input.length>96)return null
  try{
    const parsed:unknown=JSON.parse(input)
    return normalized(parsed)?{x:parsed.x,y:parsed.y}:null
  }catch{return null}
}
export function brainLauncherBounds(socialWidth:number,socialHeight:number):BrainLauncherBounds{
  const width=Number.isFinite(socialWidth)?Math.max(0,socialWidth):0
  const height=Number.isFinite(socialHeight)?Math.max(0,socialHeight):0
  // Keep the 40px click target inside the conversation body, clear of
  // native contact rail, title and composer. Leave 4px at the divider.
  const maxX=Math.max(0,width-44)
  const minX=Math.min(308,maxX)
  const minY=48
  const maxY=Math.max(minY,height-132)
  return {minX,maxX,minY,maxY}
}
export function brainLauncherPixelPosition(position:BrainLauncherPosition|null,b:BrainLauncherBounds){
  return {
    x:Math.round(b.minX+(b.maxX-b.minX)*(position?.x??1)),
    y:Math.round(b.minY+(b.maxY-b.minY)*(position?.y??0.46))
  }
}
export function brainLauncherNormalizedPosition(x:number,y:number,b:BrainLauncherBounds):BrainLauncherPosition{
  return {
    x:b.maxX<=b.minX?1:clamp((x-b.minX)/(b.maxX-b.minX),0,1),
    y:b.maxY<=b.minY?0:clamp((y-b.minY)/(b.maxY-b.minY),0,1)
  }
}

/** Release gesture: snap to nearest horizontal chat edge, preserve vertical freedom.
 * The existing normalized preference stores only UI geometry. */
export function brainLauncherSnapToEdge(position:BrainLauncherPosition):BrainLauncherPosition{
  return {x:position.x<0.5?0:1,y:position.y}
}
