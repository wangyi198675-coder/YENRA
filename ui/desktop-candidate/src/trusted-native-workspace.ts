/**
 * The installed official DSH profile is the authorization boundary.
 * Resolve owner Work Sessions from the ORIGINAL WorkspaceRegistry, not a
 * developer-machine CWD, frontend hint, contact title or second registry.
 */
import {isAbsolute,resolve,normalize as normalizePath} from 'node:path';
import {existsSync} from 'node:fs';
import type {Context} from '@deepseek-ai/cordis';

const canonical=(value:string|undefined)=>
  typeof value==='string'&&isAbsolute(value)
    ?normalizePath(value).replaceAll('\\','/').replace(/\/+$/u,'').toLowerCase():'';

/** Existing source install's trusted Work Session migration path only. */
export function installedYenraRoot():string{
  const home=process.env.DSH_HOME;
  if(!home||!isAbsolute(home))return '';
  const root=resolve(home,'..','..');
  return existsSync(resolve(root,'ui','desktop-candidate','package.json'))?root:'';
}
function legacyInstalledWorkspace():string{
  return canonical(installedYenraRoot());
}

type Registry={list:()=>readonly {path:string}[]};
/** The ONE original WorkspaceRegistry instance, bound inside this plugin's own
 * lifecycle. Reading it from the root context property can be unavailable
 * before/without an explicit inject; this keeps the SAME official service. */
let boundRegistry:Registry|undefined;

/** Bind the original registry once, through the official injector. */
export function installTrustedWorkspaceBinding(ctx:Context):void{
  ctx.inject(['workspaceRegistry'],scope=>scope.effect(()=>{
    const service=(scope as unknown as {workspaceRegistry?:Registry}).workspaceRegistry;
    if(service)boundRegistry=service;
    return()=>{if(boundRegistry===service)boundRegistry=undefined};
  },'YENRA trusted official WorkspaceRegistry binding'));
}

function registryOf(ctx:Context):Registry|undefined{
  const probe=ctx as unknown as {
    get?:(key:string)=>unknown;
    workspaceRegistry?:Registry;
  };
  try{
    const viaGet=probe.get?.('workspaceRegistry');
    if(viaGet&&typeof (viaGet as Registry).list==='function')return viaGet as Registry;
  }catch{/* not visible from this scope; fall back below */}
  try{
    const viaProperty=probe.workspaceRegistry;
    if(viaProperty&&typeof viaProperty.list==='function')return viaProperty;
  }catch{/* un-injected property access must never break the caller */}
  return boundRegistry;
}

/** One authenticated local DSH account's own registered Workspace. */
export function isTrustedNativeWorkspace(ctx:Context,cwd:string|undefined):boolean{
  const actual=canonical(cwd);
  if(!actual)return false;
  const installed=legacyInstalledWorkspace();
  if(installed&&actual===installed)return true;
  const registry=registryOf(ctx);
  if(!registry)return false;
  try{
    return registry.list().some(workspace=>canonical(workspace.path)===actual);
  }catch{return false}
}

/** Bounded, read-only diagnostics for evidence; contains only paths the
 * original Host already reports as registered. Never contains messages. */
export function trustedWorkspaceDiagnostics(ctx:Context):{
  installedRoot:string;registered:string[];
}{
  const registry=registryOf(ctx);
  let registered:string[]=[];
  try{registered=(registry?.list()??[]).map(item=>item.path)}catch{}
  return {installedRoot:installedYenraRoot(),registered};
}
