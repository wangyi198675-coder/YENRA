/** Explicit human retry for a failed ORIGINAL DSH Modify turn.
 * This is ephemeral UI-only state: no automatic model replay, second queue,
 * sender, persistence or cross-contact draft reuse.
 */
export type FailedManualModify={
  sessionId:string
  contactKey:string
  sourceKey:string
  seed:string
}

/** Only the same verified native Session, contact AND last Cloud/Host message
 * can recover the original external-language edit. Never reuse stale text.
 */
export function retryableManualModify(
  failure:FailedManualModify|null,
  current:{sessionId?:string;contactKey?:string;sourceKey?:string},
  generating:boolean,
):string|null {
  if(!failure||generating||
    !current.sessionId||!current.contactKey||!current.sourceKey||
    failure.sessionId!==current.sessionId||
    failure.contactKey!==current.contactKey||
    failure.sourceKey!==current.sourceKey)return null
  const seed=failure.seed.trim()
  return seed&&seed.length<=2000&&!/[\u3400-\u9fff]/u.test(seed)?seed:null
}
