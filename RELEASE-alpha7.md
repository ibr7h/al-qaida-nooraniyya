# alpha.7 release gate

Status: **not approved for production**. Keep PR #1 in draft until device evidence is recorded.
Pushing to `main` starts the existing Pages deployment; do not merge to obtain a test URL.

## Automated evidence

Reviewed base: `3244f9d6aff8df3cc8a3da0b5274d6024abd8827`.
Its 16 existing Node tests passed. Four added cases (network/source media errors in
each page) failed before the fix. The fix reloads a failed same-source media resource
before retrying, preserving the existing user-gesture playback path and healthy playback.

Run `node --test tests/pwa-regressions.cjs` on the final candidate. Expected: 20 passing.
The PWA regressions workflow runs these checks for PRs targeting main.
These are Node simulations and static integrity checks, not browser/device certification.
No assets, cache identities, manifests, or release number changed in this follow-up.

## Minimal Android acceptance session — pending

Use an isolated HTTPS preview. For migration, serve alpha.6 and then the candidate
at the SAME preview origin and path. A different preview URL does not test migration.
Do not clear site data between versions. Do not publish to production for this test.

Record final commit SHA, preview URL, Android version, Chrome version, device model,
test date and results below. Check both index.html and mobile-v2.html.

| Check | Pass condition | Result |
| --- | --- | --- |
| Fresh installation | Both identities install and launch their correct page from their icons | Pending |
| Audio and recovery | A clip and a sequence play; an uncached clip fails offline, then the SAME clip retries successfully after reconnecting without page reload | Pending |
| Offline relaunch | Download a lesson, close and reopen both apps offline; correct page and downloaded audio remain available | Pending |
| Upgrade alpha.6 to candidate | Existing downloaded lesson survives, both pages reach alpha.7, no blocked overlay or repeated reload loop | Pending |
| Focus View | Single letter and long group: readable marks, reachable close/navigation controls, portrait and landscape including width above 767 CSS px | Pending |

Final candidate SHA: pending

Device / Android / Chrome: pending

Preview URL / date / evidence: pending

Release decision: pending. A passing CI run does not complete these device checks.
If a device check fails, fix only the demonstrated failure and rerun its affected path.
