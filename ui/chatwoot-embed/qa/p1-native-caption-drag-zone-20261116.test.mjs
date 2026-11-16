import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const src=new URL('../desktop-integration-candidate/src/client/',import.meta.url)
const ui=readFileSync(new URL('ui.tsx',src),'utf8')
const css=readFileSync(new URL('v2-desktop.css',src),'utf8')

test('one in-flow YENRA caption and one narrow drag-only hit surface',()=>{
 assert.equal((ui.match(/<header className="v2-topbar">/g)||[]).length,1)
 assert.equal((ui.match(/<span className="v2-caption-drag-zone"/g)||[]).length,1)
 assert.match(ui,/<span className="v2-caption-drag-zone" aria-hidden="true"\s*\/>/)
 assert.equal((ui.match(/<nav className="v2-modes"/g)||[]).length,1)
 assert.equal((ui.match(/<DraggableBrainLauncher\b/g)||[]).length,1)
})
test('drag zone is native, scoped to merged Windows caption, not the Cloud webview',()=>{
 assert.match(css,/\.v2-caption-drag-zone\{display:none\}/)
 assert.match(css,/html\[data-windows-titlebar\]:not\(\[data-fullscreen\]\) \.yenra-v2\[data-yenra-merged-header=true\] \.v2-caption-drag-zone\{/)
 const zone=css.match(/html\[data-windows-titlebar\]:not\(\[data-fullscreen\]\) \.yenra-v2\[data-yenra-merged-header=true\] \.v2-caption-drag-zone\{([^}]+)\}/)?.[1]
 assert.ok(zone)
 assert.match(zone,/position:fixed;top:0/)
 assert.match(zone,/height:40px;pointer-events:auto;-webkit-app-region:drag/)
 assert.match(zone,/left:max\(645px,calc\(var\(--yenra-caption-mode-center\) \+ 48px\)\)/)
 assert.match(zone,/width:clamp\(0px/)
 assert.match(zone,/var\(--yenra-caption-brain-width,360px\)/)
 assert.match(ui,/['\"]--yenra-caption-brain-width['\"]:visibleBrainWidth\+'px'/)
 assert.match(zone,/- 110px\),160px/)
 assert.match(css,/\.yenra-v2\[data-yenra-merged-header=true\] \.v2-topbar\{pointer-events:none;-webkit-app-region:no-drag\}/)
 assert.match(css,/\.yenra-v2\[data-yenra-merged-header=true\] \.v2-topbar nav\{pointer-events:auto\}/)
 assert.match(css,/\.v2-brain-head :is\(button,input,\[role=button\]\)\{-webkit-app-region:no-drag\}/)
})
test('transparent Chat/Work modes no longer intercept central native drag zone',()=>{
 const modeRule=css.match(/html\[data-windows-titlebar\]\[data-yenra-caption-menu=ready\] \.yenra-v2\[data-yenra-merged-header=true\] \.v2-modes\{([^}]+)\}/)?.[1]
 assert.ok(modeRule)
 assert.match(modeRule,/left:max\(555px,calc\(var\(--yenra-caption-mode-center\) - 42px\)\)/)
 assert.match(css,/\.v2-modes>\.v2-mode\{\s*opacity:0;pointer-events:none;transition:none/)
 assert.match(css,/\.v2-modes:is\(:hover,:focus-within\)>\.v2-mode\{opacity:1;pointer-events:auto\}/)
 assert.match(css,/@media\(hover:none\)\{[\s\S]*?\.v2-modes>\.v2-mode\{opacity:1;pointer-events:auto\}/)
 assert.match(css,/\.v2-topbar :is\(button,nav,input\)\{-webkit-app-region:no-drag\}/)
 assert.match(ui,/onClick=\{openNativeWork\}/)
 assert.match(ui,/onClick=\{openNativeChat\}/)
})
test('hidden-on-idle navigation reveals clear of Cloud name, with a separate bounded native drag strip',()=>{
 // Owner's real 1191px Cloud header had a contact name ending x=461,
 // while the old mode's first button occupied x=422..470.
 for(const [viewport,center,brain] of [
  [1191,596,320],[1153,576,320],[1090,545,320],[1360,680,360]
 ]){
  const modeLeft=Math.max(555,center-42)-66 // existing translateX(-50%)
  const modeRight=modeLeft+132
  const dragLeft=Math.max(645,center+48)
  const dragWidth=Math.max(0,Math.min(160,viewport-brain-dragLeft-110))
  const dragRight=dragLeft+dragWidth
  assert.ok(modeLeft>=480,'modes do not cover the measured Cloud contact title')
  assert.ok(modeLeft>461,'no screenshot name overlap')
  assert.ok(dragLeft-modeRight>=24,'24px clear buffer between controls and draggable strip')
  assert.ok(dragRight<=viewport-brain-110,'Cloud native search/actions remain clickable')
  assert.ok(dragWidth>=0)
 }
 // At <=1024px host the Cloud guest is too narrow for merged-caption mode.
 assert.match(ui,/window\.innerWidth>=900&&workspaceWidth-visibleBrainWidth>=769/)
})
