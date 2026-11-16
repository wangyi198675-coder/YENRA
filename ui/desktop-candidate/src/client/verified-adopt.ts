/** One scope check for sync OSS and async Chatwoot draft adapters.
 * This is a UI-only confirmation. It never invokes a channel Sender.
 */
export type VerifiedAdoptTarget={accountRef:string;roomRef:string}
export type VerifiedAdoptAdapter=(
  accountRef:string,roomRef:string,text:string
)=>boolean|Promise<boolean>

/** Never claim success or write an adoption memory before a Cloud promise resolves. */
export async function confirmVerifiedAdoption(
  adapter:VerifiedAdoptAdapter|null,
  target:VerifiedAdoptTarget,
  text:string,
  stillSelected:()=>boolean,
):Promise<boolean>{
  if(!adapter||!target.accountRef||!target.roomRef||
     typeof text!=='string'||!text.trim()||text.length>2000||!stillSelected())return false
  try{
    const accepted=await adapter(target.accountRef,target.roomRef,text.trim())
    return accepted===true&&stillSelected()
  }catch{return false}
}
