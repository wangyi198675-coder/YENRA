/**
 * YEN-8: Guard the model-facing yenra_memory tool against Cloud contact
 * sessions accidentally entering the owner-workspace binding path.
 * Proof comes exclusively from the existing MemoryService.verifiedScope().
 * A Cloud title is only an identity comparison key, NEVER an authorization.
 */
export type VerifiedCloudMemoryScope = {
  kind: 'owner'|'contact'
  workspace: string
  channel?: 'Page'|'WhatsApp'|'Personal'
  pageIdentityHash?: string
  cloudIdentityHash?: string
}

const CLOUD_TITLE=/^YENRA:([PWF]):([a-f0-9]{64})$/u
const RELATION_WORKSPACE=/^yenra-relation-v1:[a-f0-9]{64}$/u

export function isCloudMemorySessionTitle(title:string):boolean {
  // Include malformed Cloud titles in the deny-by-default branch so no
  // failed/partial contact identity may fall back to the owner scope.
  return /^YENRA:[PWF]:/u.test(title)
}

export function assertVerifiedCloudMemoryScope(
  title:string, scope:VerifiedCloudMemoryScope,
):void {
  const match=CLOUD_TITLE.exec(title)
  if(!match)throw new Error('Cloud 联系人 Session 标识不完整，禁止回退主人记忆')
  const channel=match[1]==='P'?'Page':match[1]==='W'?'WhatsApp':'Personal'
  const hash=match[2]!
  if(scope.kind!=='contact'||scope.channel!==channel||
    !RELATION_WORKSPACE.test(scope.workspace)||
    (channel==='Page'
      ?scope.pageIdentityHash!==hash||scope.cloudIdentityHash!==undefined
      :scope.cloudIdentityHash!==hash||scope.pageIdentityHash!==undefined))
    throw new Error('Cloud 联系人身份与原生记忆授权不一致，拒绝跨账号访问')
}
