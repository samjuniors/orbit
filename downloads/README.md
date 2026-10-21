# ORBIT Windows Downloads

### 1. Traditional Windows Installer (`Orbit-Setup.exe`)
[📥 **Download Orbit-Setup.exe** (24 MB)](./Orbit-Setup.exe?raw=true)

- **Installer Type**: Windows Setup Wizard (Inno Setup 6).
- **Features**:
  - Graphical Next $\rightarrow$ Install setup wizard.
  - Automatic `PATH` registration (run `orbit` from any terminal or Command Prompt).
  - Clean uninstallation via Windows Settings $\rightarrow$ Installed Apps.
  - Built-in in-app auto-update (`orbit update`).
  - No Node.js required (single-file SEA engine runtime embedded).

#### Silent / Unattended Installation:
```powershell
.\Orbit-Setup.exe /SILENT
```

---

### 2. Desktop GUI Application (`Orbit-Desktop-Setup.exe`)
For the full dark-mode graphical desktop application with interactive task checklists, live execution runner, and canary test center:

- Download the latest installer from [GitHub Releases](https://github.com/samjuniors/orbit/releases/latest).
- File: `Orbit-Desktop-Setup-0.7.0.exe` (~93 MB).
