<div align="center">
  <img src="assets/icon_256.png" alt="LlamaDeck Logo" width="128" />
</div>

<h1 align="center">LlamaDeck</h1>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.3.0-black?style=flat-square" alt="Version 1.3.0" />
  <img src="https://img.shields.io/badge/Electron-191970?style=flat-square&logo=Electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vite-B73BFE?style=flat-square&logo=vite&logoColor=FFD62E" alt="Vite" />
</p>

<br/>

LlamaDeck is a fast, native desktop interface designed to streamline managing and running local Large Language Models using llama.cpp. It strips away the friction of command-line execution and manual file management, providing a unified workspace to discover, download, configure, and serve models.

Built by and for local AI enthusiasts, LlamaDeck ensures you spend less time wrestling with terminal arguments and more time interacting with models.

## Features

**Integrated Model Hub**
Search Hugging Face directly within the application. Browse repositories, view file details, and download GGUF models with a single click without ever opening a browser.

![Model Hub](assets/screenshots/model-hub.png)

**Smart Download Manager**
Pause, resume, or cancel large model downloads reliably. You can also paste direct GGUF links. When a download completes, LlamaDeck automatically generates an execution template with recommended threads, batch sizes, and context windows tailored to the model's parameters and quantization level.

![Model Download](assets/screenshots/model-download.png)

**Template-Based Execution**
Save your configurations as reusable templates. Run multiple models simultaneously on different ports without conflict. Launch them in "Chat UI" mode to automatically open the built-in llama.cpp web interface, or "API Only" mode to serve them silently in the background.

![My Templates](assets/screenshots/my-templates.png)

![Template Settings](assets/screenshots/template-edit-model-settings-parameters.png)

**Version and Backend Management**
Running cutting-edge models sometimes requires different builds of llama.cpp. LlamaDeck lets you maintain and seamlessly switch between multiple backend binaries. It automatically checks the ggml-org repository for new releases and lets you download and extract them straight from the settings panel.

**Visual Command Editor**
Stop memorizing execution flags. Edit backend-specific commands through a structured user interface. Toggle booleans, set limits on numerical inputs, and define default parameter values for the llama.cpp server.

![Settings](assets/screenshots/settings.png)

**PowerShell CLI**
Control the installed app from PowerShell. The GUI and CLI operate on the same templates, active backend, and running model sessions. Standard commands return one JSON value for reliable scripting:

```powershell
# Discover the installed command contract and exit codes.
llamadeck capabilities | ConvertFrom-Json

# Use IDs in automation.
$template = llamadeck template get "My Model" | ConvertFrom-Json
llamadeck template validate $template.id | ConvertFrom-Json
llamadeck template start $template.id | ConvertFrom-Json
llamadeck template wait $template.id --ready --timeout 180 | ConvertFrom-Json

# Inspect sessions and follow newline-delimited JSON logs.
llamadeck status | ConvertFrom-Json
llamadeck template logs $template.id --tail 100 --follow

# Switch the global backend used by unpinned templates.
llamadeck backend list | ConvertFrom-Json
llamadeck backend use b1234 | ConvertFrom-Json

# Inspect and control the app-managed LiteLLM proxy.
llamadeck litellm status | ConvertFrom-Json
llamadeck litellm start | ConvertFrom-Json
llamadeck litellm test | ConvertFrom-Json
llamadeck litellm models | ConvertFrom-Json
llamadeck litellm logs --tail 100 --follow

# Validate and apply LiteLLM YAML. Config reads always redact secrets.
llamadeck litellm config get | ConvertFrom-Json
llamadeck litellm config validate --file .\litellm.yaml | ConvertFrom-Json
llamadeck litellm config set --file .\litellm.yaml | ConvertFrom-Json

# Create, update, or validate a strict JSON template document.
llamadeck template create --file .\template.json | ConvertFrom-Json
llamadeck template update $template.id --file .\changes.json | ConvertFrom-Json
llamadeck template validate --file .\template.json | ConvertFrom-Json

# Destructive operations require explicit confirmation.
llamadeck template delete $template.id --yes | ConvertFrom-Json
```

Log commands with `--follow` emit newline-delimited JSON rather than one JSON array. Template and LiteLLM config validation exit with code 2 when the returned result has `valid: false`. Pass `--file -` to read a document from stdin. LiteLLM status, logs, errors, installation output, and config reads redact API keys; `config get` is an inspection copy, not a secret-preserving export.

The Windows installer adds the CLI shim to your user `PATH`; open a new PowerShell window after installing or updating. CLI commands start LlamaDeck when needed and communicate with the app over an authenticated per-user named pipe. Portable zip users can run `.\resources\cli\llamadeck.cmd` directly or add that folder to `PATH`.

Run `llamadeck --help` for human-readable usage or `llamadeck --help --json` for the machine-readable contract.

## Installation

### Download the Release
The fastest way to get started is to use the pre-compiled installer.

1. Navigate to the [Releases](https://github.com/andersondanieln/hexllama/releases) page.
2. Download the installer for your operating system.
3. Run the installer and launch LlamaDeck.

### Run Locally
If you want to build from source or modify the project, you can easily run the development environment.

Prerequisites:
- Node.js 18 or higher
- npm

```bash
# Clone the repository
git clone https://github.com/andersondanieln/hexllama.git

# Enter the project directory
cd hexllama

# Install dependencies
npm install

# Start the development server
npm run dev
```

To build the production app bundles without creating an installer:
```bash
npm run build
```

To package an installable desktop build for your current OS:
```bash
npm run package
```

On Windows, `npm run package` uses `electron-builder` to produce:
- an NSIS installer (`.exe`)
- a portable archive (`.zip`)

The packaged artifacts are written to the default `dist/` output directory.

### Windows Install Flow
If you are building and installing this yourself on Windows:

1. Install Node.js 18+.
2. Run `npm install` in the repo root.
3. Run `npm run package`.
4. Open the generated installer from `dist/`.
5. Follow the installer prompts and choose the install directory if needed.

Notes:
- The current config builds Windows `x64` and `arm64` targets.
- The installer is not code-signed in this repo, so Windows SmartScreen may warn until you trust it locally.
- Uninstall keeps app data by default, so templates and settings are preserved unless you remove them manually.

## Acknowledgements

This project exists because of the incredible foundational work of Georgi Gerganov and the ggml-org community. Please consider supporting the development of [llama.cpp](https://github.com/ggerganov/llama.cpp).

## Privacy and Terms

LlamaDeck is provided as is, without warranty of any kind. The developers assume no liability for damages or issues arising from the use of this software.

This application is strictly local. It does not collect, store, or transmit any telemetry or personal data. Note that downloading models relies on third-party services like Hugging Face, and executing backends relies on the downloaded binaries, both of which are subject to their own respective privacy policies.
