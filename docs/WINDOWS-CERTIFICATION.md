# Windows certification

## Automated certification workflow

`.github/workflows/windows-certification.yml` runs on pull requests, pushes to `main`, and manual dispatch. It uses GitHub-hosted `windows-latest` runners and records the Windows edition/version/build in the job log.

| Product surface | Build/runtime toolchain | Automated checks |
|---|---|---|
| CLI source | Node.js 22 | Syntax checks and full engine test suite |
| Standalone CLI | Node.js 22 build; bundled Node runtime | Build, `--version`, guard smoke test, then Windows updater integration |
| CLI installer | Inno Setup 6 | Silent clean install into a path containing spaces, first launch, `--help`, Start Menu shortcut, same-version reinstall, uninstall |
| Legacy desktop/tray | Node.js 24 build toolchain; Electron runtime | Syntax checks, tests, x64 NSIS build, silent install into a path containing spaces, process launch smoke test, uninstaller |

The CLI updater integration test uses a real Windows runner and a built ORBIT executable. It verifies that replacement waits for the running process to exit, works with paths containing spaces, validates the replacement by invoking `--version`, removes the backup only after success, and restores the prior executable after a failed health check.

The CLI installer test also verifies that user data outside the installation directory survives reinstall and uninstall. The desktop/tray installer is built and independently launched; it is not treated as the CLI.

## Evidence boundaries

A green workflow certifies the exact commit tested on the GitHub-hosted Windows image shown in that run. The `windows-latest` label moves over time; use the recorded OS edition, version, and build in the run log rather than interpreting this as certification for every Windows release.

### Latest successful certification

- Run: [Windows certification workflow](https://github.com/samjuniors/orbit/actions/runs/39583767435)
- Observed OS: Microsoft Windows Server 2025 Datacenter, build 26100.
- CLI executable and Inno Setup build/test toolchain: Node.js 22.
- Legacy desktop/tray build/test toolchain: Node.js 24.
- Result: both CLI/installer and desktop/tray jobs passed, including updater replacement and rollback integration.

The installer workflow currently tests a clean install, same-version repair/reinstall, and uninstall. It does **not** claim a version-to-version upgrade from a previously published CLI release until a prior supported release installer is available and that specific upgrade path is exercised. This is a separate acceptance item, not inferred from reinstall coverage.

These checks do not certify Authenticode signing, SmartScreen reputation, antivirus vendor allow-listing, domain-managed device policy, or every Windows permission/UAC configuration. Unsigned distribution remains subject to Windows security warnings.

## Support statements

- **CLI source/npm mode:** requires Node.js 20 or newer and Git; tested by the general CI matrix.
- **Standalone CLI:** bundles the Node runtime; this workflow builds and smoke-tests it on Windows x64 using Node.js 22 as the build toolchain.
- **CLI Inno Setup installer:** this workflow tests install, first launch, same-version reinstall, PATH/shortcut integration, and uninstall on the recorded Windows runner.
- **Legacy desktop/tray:** separately built and launched as a Windows x64 Electron/NSIS application using Node.js 24 as the build toolchain.
- **Cross-version installer upgrade:** pending a previous supported release artifact and a dedicated upgrade test.
