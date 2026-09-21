import assert from 'node:assert/strict'
import { Effect } from 'effect'
import * as vscode from 'vscode'

function diagnostics(
  uri: vscode.Uri,
  hasErrors: boolean,
): Effect.Effect<readonly vscode.Diagnostic[], Error> {
  return Effect.async<readonly vscode.Diagnostic[]>((resume) => {
    const check = (): void => {
      const values = vscode.languages
        .getDiagnostics(uri)
        .filter((value) => value.source === 'rescript-lint')
      if (values.length > 0 === hasErrors) resume(Effect.succeed(values))
    }
    const listener = vscode.languages.onDidChangeDiagnostics(check)
    check()
    return Effect.sync(() => {
      listener.dispose()
    })
  }).pipe(
    Effect.timeoutFail({
      duration: '20 seconds',
      onTimeout: () =>
        new Error(`Timed out waiting for linter diagnostics (hasErrors=${String(hasErrors)})`),
    }),
  )
}

async function replace(document: vscode.TextDocument, text: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit()
  edit.replace(
    document.uri,
    new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
    text,
  )
  assert.equal(await vscode.workspace.applyEdit(edit), true)
}

export async function run(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]
  assert.ok(folder)
  const config = vscode.workspace.getConfiguration('rescriptLint')
  const linter = process.env['RESCRIPT_LINT_TEST_BINARY']
  assert.ok(typeof linter === 'string' && linter.length > 0)
  await config.update('serverPath', `${linter}.missing`, vscode.ConfigurationTarget.Global)
  const extension = vscode.extensions.getExtension<unknown>('jderochervlk.rescript-lint-vscode')
  assert.ok(extension)
  await extension.activate()
  await config.update('serverPath', linter, vscode.ConfigurationTarget.Global)
  await vscode.commands.executeCommand('rescriptLint.restart')
  const document = await vscode.workspace.openTextDocument(
    vscode.Uri.joinPath(folder.uri, 'Smoke.res'),
  )
  await vscode.window.showTextDocument(document)
  assert.equal(document.languageId, 'rescript')
  const first = await Effect.runPromise(diagnostics(document.uri, true))
  console.log('Initial diagnostics received.')
  assert.ok(first.some((diagnostic) => diagnostic.code === 'no-console'))
  await replace(document, 'let greeting = "hello"\n')
  assert.deepEqual(await Effect.runPromise(diagnostics(document.uri, false)), [])
  console.log('Unsaved edit cleared diagnostics.')
  await replace(document, 'Console.log("back")\n')
  await Effect.runPromise(diagnostics(document.uri, true))
  assert.equal(await document.save(), true)
  await vscode.commands.executeCommand('rescriptLint.restart')
  console.log('Server restarted.')
  await Effect.runPromise(diagnostics(document.uri, true))
  await vscode.commands.executeCommand('rescriptLint.showOutput')
  await vscode.languages.setTextDocumentLanguage(document, 'plaintext')
  assert.deepEqual(await Effect.runPromise(diagnostics(document.uri, false)), [])
  await vscode.commands.executeCommand('workbench.action.closeAllEditors')
  console.log(
    'ReScript Lint editor smoke test passed: startup recovery, diagnostics, unsaved edits, save, restart, and language-mode changes.',
  )
}
