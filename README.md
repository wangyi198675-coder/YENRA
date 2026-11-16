# YENRA

YENRA's **public, security-reviewed source mirror**. The authoritative running desktop product remains in the owner's authorized local YENRA workspace.

## Current scope

This repository is being populated gradually under [Linear YEN-15](https://linear.app/yenra/issue/YEN-15). It now includes a first reviewed UI-source slice for Chatwoot's **original native contact-list collapse/expand button**, together with standalone source tests.

**This is not a full source mirror or a production build yet.** A successful GitHub Actions check verifies PR traceability, guarded paths, and reviewed source tests; it does **not** demonstrate a runnable YENRA app, a safe installer, WhatsApp delivery acknowledgments, or desktop deployment.

## Development workflow

1. Link work to one [YENRA Linear issue](https://linear.app/yenra).
2. Open a branch and PR containing its `YEN-<number>` identifier.
3. Apply source allowlists, credential/privacy review, GitHub Actions checks, and human code review.
4. Merge only reviewed source. The sole release Owner separately builds and verifies the official DSH/Electron installer before an authorized owner-machine release.
5. No automatic deployment to the owner's or friend's computer.

See [workflow documentation](docs/LINEAR_GITHUB_YENRA_WORKFLOW.md).

## What is never uploaded

Cloud/WhatsApp credentials, tokens, personal messages, contacts and media, profile/DPAPI files, databases, memory, private backups, installation binaries, or run logs. Official DeepSeek Harness / Chatwoot source and third-party material require a separate license and provenance review; **do not bulk-push the local project**.

> The repository is **Public**. Its former “private source repository” description is historical and does not describe GitHub access controls.
