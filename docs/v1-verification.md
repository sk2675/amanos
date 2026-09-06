# V1 verification record

Verified on 6 September 2026 against commit `f74b43c` and its ancestors. The implementation commits are stacked on the release-review branch and are not present on `main` until the review pull request is merged.

## Issue evidence

| Issue | Implementation evidence | Test or artefact evidence |
| --- | --- | --- |
| #1 TypeScript CLI skeleton | `fa91d17` | `test/args.test.ts`, `test/help.test.ts`; `npm run build` |
| #2 Workspace foundation | `c8f06e7` | `test/paths.test.ts`, `test/config.test.ts`, `test/state.test.ts`, `test/atomic.test.ts` |
| #3 `amanos init` | `cd18d69` | `test/init.test.ts` |
| #4 repository discovery | `b2f8be2` | `test/repos.test.ts` |
| #5 deterministic parser | `aa29ab4` | `test/parser.test.ts` and bilingual Markdown/HTML fixtures |
| #6 append-only decision store | `f6a088c` | `test/decisions.test.ts` |
| #7 possible-replacement links | `4435718` | replacement-link cases in `test/decisions.test.ts` |
| #8 candidate impact scan | `4435718` | `test/impact.test.ts` |
| #9 scan orchestration | `352da3a` | `test/scan.test.ts` |
| #10 status command | `4d546f4` | `test/status.test.ts` |
| #11 watcher | `4d546f4` | `test/watcher.test.ts` |
| #12 error resilience | `d485c7c` | unreadable-source, broken-repository, and recovery cases in `test/scan.test.ts` and `test/status.test.ts` |
| #13 V1 end to end | `c1c9096` | `test/e2e.test.ts` exercises two real Git repositories without network access |
| #14 Windows/Linux CI | `f6a088c` | `.github/workflows/ci.yml`; the review PR must pass both matrix jobs before merge |
| #15 no-op agent seam | `4d546f4` | `test/agent.test.ts` and the injected-adapter case in `test/scan.test.ts` |
| #16 user documentation | `f74b43c` | `README.md`, `site/src/pages/docs.astro`, and a successful Astro production build |

No V1 issue needs to be reopened based on this audit: every issue has implementation plus test or artefact evidence. The V1 milestone must nevertheless remain open until the commits are merged and the corrected package is released.

## Reproducible verification

From a clean checkout with Node.js 20 or newer:

```bash
npm ci
npm run verify:v1
npm --prefix site ci
npm --prefix site run build
```

`verify:v1` performs strict typechecking, the full Vitest suite, a TypeScript build, the site content policy, and a package smoke test. The smoke test creates a tarball with `npm pack`, installs it into a new temporary consumer directory, executes the installed `amanos --help` binary, checks all four V1 commands, and removes the temporary directory.

## Status reconciliation

As of 6 September 2026, all status surfaces describe the same state: **V1 release candidate, not released**.

- Git branch: implementation is ready for pull-request review but is not yet on `main`.
- V1 milestone: remains open until merge and publication are verified.
- README and `/docs`: identify the source build as the supported preview path.
- npm: `amanos@0.0.1` exists but is explicitly identified as a broken pre-V1 stub.
- GitHub Releases: no V1 release exists yet.

The transition from release candidate to released is governed by [`releasing.md`](./releasing.md).
