# v19 candidate · YEN-9 / YEN-10 / YEN-14

This review branch is an incremental message-integrity change **on top of draft PR #3** (`70816e5`), not a modification of the immutable, installed v18 release.

## Actual changes

- **YEN-9** — a verified ORIGINAL WhatsApp Socket submission missing an immediate MID can be correlated using strictly same-account/same-room pre/post original Host snapshots, and recorded in the existing once-only submission claim as the MID SHA-256. Only a single new message with matching text and timestamp qualifies. All unresolved/ambiguous cases remain **MID pending / UNKNOWN_NO_RETRY**; no second send or invented ACK. Serialize Cloud submissions per original room.
- **YEN-10** — signed Cloud Page outgoing webhook events without a Meta MID no longer generate bogus inbound-validation failures. Meta Graph error 551 remains an explicitly classified platform rejection; failed outbound status is retained in Cloud Page selection, not reported as sent.
- **YEN-14** — the existing original WhatsApp roster now drives bounded missing Cloud-contact and conversation recovery, followed by original Host phone/avatar hydration. Missing E.164 data is never inferred from LID or display name. Future original roster additions reuse the same Bridge routing index and timer.

No new Sender, Socket, chat database, agent or gateway; no sending test messages to real contacts.

## Reproducibility

Based on draft PR #3 (`yen-15-v18-batch-source-ci`), with a missing **synthetic-only** Bridge test fixture included because the draft omitted it and otherwise 12 Bridge test suites cannot import their dependency.

After staging this incremental patch on the PR #3 worktree:

```sh
cd social-adapters/chatwoot-cloud-direct && node --test *.test.mjs
# 237/237 pass
cd ../chatwoot-bridge && node --test test/*.test.mjs
# 178/178 pass
```

The separate complete formal local source has a larger suite (Cloud 247 + Bridge 204); these counts must not be presented as GitHub-ready independent test results.

## Release and read-receipt gates

- Draft PR #3 itself must remain draft; this v19 branch must not overwrite or change its immutable v18 source hashes.
- Existing native DSH `/api/yenra/social-native-read` already distinguishes provider submission and receipt privacy modes. Cloud conversation-open-to-native-Host wiring must be reviewed with the UI Owner; it is **not** implemented by this patch and local read != provider read ACK.
- All fixes here are **source-only** until the unique release Owner builds, installs and validates a v19 candidate on the authorized owner computer. Do not use this patch for a live sender restart without release approval.
- Provider Graph 551 failures are recipient-unavailable, not an authorization to resend or mask a failed message.
