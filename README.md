# ReScript Lint for VS Code

Lint diagnostics for ReScript, powered by
[@jvlk/rescript-lint](https://github.com/jderochervlk/rescript-lint).
Runs alongside the [official ReScript extension](https://marketplace.visualstudio.com/items?itemName=chenglou92.rescript-vscode),
which provides syntax highlighting, completion, navigation, and compiler diagnostics.

## Install the Development Build

This extension is not published on the VS Code Marketplace yet.

1. Install Node.js 24+, pnpm, and VS Code 1.126 or newer.
2. Clone this repository and build a VSIX:

   ```sh
   git clone https://github.com/jderochervlk/rescript-lint-vscode.git
   cd rescript-lint-vscode
   pnpm install
   pnpm package
   ```

3. In VS Code, run **Extensions: Install from VSIX...** and select
   `rescript-lint-vscode-0.1.0.vsix`. Install the official ReScript extension too
   if VS Code has not already installed it.
4. Configure a local linter using one of the examples below, then open a trusted
   ReScript workspace and a `.res` or `.resi` file.

The linter npm package is still being prepared. The extension does not download
or install it automatically. Once available, it can use a workspace installation
at `node_modules/@jvlk/rescript-lint/bin/rescript-lint.mjs`.
If that file is absent, it tries `rescript-lint` on `PATH`.

## Local Linter

For a native executable, add this to VS Code settings:

```json
{
  "rescriptLint.serverPath": "/absolute/path/to/rescript-lint"
}
```

For the npm package's ES module launcher:

```json
{
  "rescriptLint.serverPath": "/absolute/path/to/bin/rescript-lint.mjs",
  "rescriptLint.nodePath": "/absolute/path/to/node"
}
```

The launcher requires Node.js 24 or newer. Paths with spaces are supported;
do not add shell quotes to the settings. The extension supplies `lsp --stdio`.
In SSH, WSL, or container workspaces, these paths refer to the remote machine.

Use **ReScript Lint: Restart Language Server** after changing settings or workspace
folders. It reloads configuration and starts one linter per workspace folder.
Use **ReScript Lint: Show Output** to inspect startup failures and server logs.
Set `rescriptLint.enable` to `false` and restart the language server to disable
linting. Reloading the VS Code window also applies these changes.

## Develop

Run `pnpm install`, open this repository in VS Code, and press F5 to launch an
Extension Development Host. The launch configuration builds the extension first.
Configure your local linter in that host and open a ReScript project.

```sh
pnpm check
pnpm package
```

Verify diagnostics on opening a file, editing unsaved text, saving, and closing
the file. Also verify that compiler diagnostics from the official ReScript
extension remain available.

The unit suite enforces at least 90% coverage per application module. The small
VS Code host adapter is excluded from unit coverage because it requires the
editor runtime; the real-editor smoke test exercises it against a built linter:

```sh
code --extensions-dir .vscode-test/extensions --install-extension chenglou92.rescript-vscode
RESCRIPT_LINT_TEST_BINARY=/absolute/path/to/rescript-lint pnpm test:editor
```

The smoke test downloads a separate VS Code installation by default. Set
`VSCODE_EXECUTABLE_PATH` to an existing VS Code executable to reuse it. It uses a
temporary profile and workspace, and keeps logs in `.vscode-test/logs`. It checks
startup recovery, diagnostics, unsaved edits, save, restart, and language-mode
changes. In PowerShell, set these environment variables through `$env:` first.

## Publishing

Marketplace publication is a separate step. Verify access to the `jderochervlk`
publisher, test the packaged VSIX with a distributable linter, update the version
and changelog, then publish through `vsce`. Never commit publisher tokens.
