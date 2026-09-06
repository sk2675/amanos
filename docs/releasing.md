# Release process

This checklist is the required status reconciliation for every Amanos release. A release is not complete while README, `/docs`, the GitHub milestone, GitHub Releases, and npm disagree.

## Release candidate

1. Confirm that every issue assigned to the release has commit, test, or artefact evidence. For V1, use [`v1-verification.md`](./v1-verification.md).
2. Set the intended version in `package.json` and `package-lock.json` and update the CLI-facing release status in README and `site/src/pages/docs.astro`.
3. Run the complete local gate:

   ```bash
   npm ci
   npm run verify:v1
   npm --prefix site ci
   npm --prefix site run build
   ```

4. Review `npm pack --dry-run` and confirm that the tarball contains only the package manifest, CLI output under `dist/`, README, and LICENSE.
5. Merge only after the pull-request checks pass on Windows and Linux.

## Publication

1. Confirm that npm lists the expected owner and that the npm trusted publisher is restricted to this repository, `release.yml`, and the `npm` GitHub environment.
2. Create a GitHub release whose tag is exactly `v` followed by the package version. Publishing the release invokes the protected npm workflow.
3. Verify in a fresh directory, using the registry rather than a local tarball:

   ```bash
   npm install --global amanos@<version>
   amanos --version
   amanos --help
   ```

4. Verify that npm metadata and provenance match `package.json`, and that the GitHub release points to the same commit and version.
5. Deprecate only the broken version, never the whole package:

   ```bash
   npm deprecate amanos@0.0.1 "Broken pre-V1 stub; install amanos@<version> instead."
   ```

6. Change README and `/docs` from release candidate to released, then verify the deployed site.
7. Close the matching GitHub milestone only after the registry smoke test and status updates pass.

If any post-publication check fails, keep the milestone open, record the failure on the release issue, and do not describe V1 as released.
