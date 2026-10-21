# Updater security model

## Release discovery and trust

The CLI discovers the latest official GitHub Release through the GitHub Releases API over HTTPS. The update path accepts only release assets whose initial URL is HTTPS on `github.com`; after redirects, the final URL must remain HTTPS on `github.com` or `release-assets.githubusercontent.com`. The selected asset URL must identify the exact release tag.

An update requires `release-manifest.json` from that same release. The manifest must use schema version 1, repeat the exact release tag, include a full 40-character source commit, and contain exactly one entry for the selected asset. Its SHA-256 digest and byte size must match the GitHub Release asset metadata. The downloaded bytes are then checked against both values before a temporary file is created or the installed executable is touched.

The expected digest is therefore obtained independently from the executable, via the HTTPS GitHub Release metadata/manifest channel. The manifest is not a detached cryptographic signature: this design trusts GitHub's TLS-delivered release metadata and the repository's release publishing credentials. A compromised repository account, release workflow, or trusted GitHub delivery path could publish a malicious binary and matching manifest. Future hardening could add signed provenance verified against a pinned maintainer key.

## Replacement and recovery

The verified binary is written to a sibling temporary path with exclusive creation. Replacement first renames the current executable to `.old`, then moves the verified download into place. ORBIT launches the replacement with `--version` and requires the expected version before deleting the backup.

If replacement or the health check fails, ORBIT removes the failed replacement and restores the previous executable. If restoration itself fails, the old executable remains at the `.old` recovery path and is never automatically deleted. A subsequent update refuses to overwrite an existing recovery backup. Operators should preserve and manually restore that file before retrying.

The installer asset path is also verified against the manifest, but ORBIT only downloads it and asks the user to run it manually. It does not claim transactional rollback for the external installer.

## Failure behavior and limitations

- Missing manifest, invalid tag/name/URL, size mismatch, digest mismatch, incomplete download, and HTTP errors fail closed.
- Failed verification does not replace the current executable.
- A failed replacement or post-replacement version check attempts rollback.
- A failed rollback preserves the backup for manual recovery.
- Git-checkout and npm-global update modes remain package-manager/Git workflows; this integrity path applies to the self-updating standalone binary.
- The release manifest is integrity metadata, not a signature. Trust ultimately depends on GitHub account/workflow security and HTTPS.
