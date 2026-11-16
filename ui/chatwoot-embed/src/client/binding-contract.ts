/** Boundary only: the existing Desktop owner still owns every brain operation.
 * A future producer must resolve Chatwoot account+conversation to the ORIGINAL
 * Host-authorized accountRef+roomRef. A URL or untrusted postMessage is not proof.
 * No producer is supplied here: that end-to-end interface remains a blocker.
 */
export interface VerifiedContact {
  accountRef: string
  roomRef: string
}
export interface InboxBindingSink {
  onSelected(accountRef: string, roomRef: string): void
  onDeselected(): void
  onRoomData?(accountRef: string, roomRef: string, originalHostReply: unknown): void
  /** Only a verified active conversation may request draft insertion; no automatic send. */
  bindAdoptDraft?(adapter: ((accountRef: string, roomRef: string, text: string) => Promise<boolean>) | null): void
  /** Open the right-hand Brain from the iframe's native AI button. */
  onBrainToggle?(): void
  /** Must clear the old mature-inbox adoption callback before mounting iframe. */
  clearLegacyAdoption(): void
}
export interface VerifiedSelectionSource {
  /** Host-approved mapping producer, NOT iframe DOM scraping or arbitrary IPC. */
  subscribe(listener: (contact: VerifiedContact | null) => void): () => void
}
