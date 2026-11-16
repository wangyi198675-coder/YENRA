/** Explicit owner-provided Chat scope, never inferred from a generic Brain panel. */
export function isVisibleBrainScope(pane:Pick<HTMLElement,'isConnected'|'dataset'|'closest'>|null,sessionId:string,visibility:string):boolean {
 return Boolean(pane?.isConnected&&pane.dataset.yenraBrainSession===sessionId
  &&pane.dataset.yenraBrainActive==='true'&&!pane.closest('[hidden],[aria-hidden="true"],[inert]')&&visibility!=='hidden')
}
