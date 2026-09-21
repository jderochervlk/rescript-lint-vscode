import { Effect, Layer, ManagedRuntime, Option } from 'effect'
import * as vscode from 'vscode'
import { LanguageClient } from 'vscode-languageclient/node'
import type { LanguageClientOptions } from 'vscode-languageclient/node'
import { decodeSettings } from './settings.js'
import { resolveServer, ServerFilesLive } from './server.js'
import type { Launch } from './server.js'
import { ClientError, ClientFactory, sessionLayer } from './session.js'
import type { ClientHandle, Session } from './session.js'
import { Controller, ControllerLive, SessionSource, failureMessage } from './controller.js'
import type { StartupError } from './controller.js'

function operation(
  action: ClientError['operation'],
  run: () => Promise<void>,
): Effect.Effect<void, ClientError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => new ClientError({ operation: action, detail: String(cause) }),
  }).pipe(
    Effect.timeoutFail({
      duration: '15 seconds',
      onTimeout: () =>
        new ClientError({ operation: action, detail: 'The language server timed out.' }),
    }),
  )
}

function clientOptions(launch: Launch, output: vscode.LogOutputChannel): LanguageClientOptions {
  const folder = Option.flatMap(launch.root, (root) =>
    Option.fromNullable(vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root))),
  )
  return {
    documentSelector: [
      {
        scheme: 'file',
        language: 'rescript',
        ...Option.match(folder, {
          onNone: () => ({}),
          onSome: (value) => ({
            pattern: { baseUri: value.uri.toString(), pattern: '**/*.{res,resi}' },
          }),
        }),
      },
    ],
    ...Option.match(folder, {
      onNone: () => ({}),
      onSome: (workspaceFolder) => ({ workspaceFolder }),
    }),
    outputChannel: output,
    diagnosticCollectionName: 'rescript-lint',
  }
}

function createClient(
  launch: Launch,
  output: vscode.LogOutputChannel,
): Effect.Effect<ClientHandle, ClientError> {
  return Effect.try({
    try: () => {
      const client = new LanguageClient(
        'rescript-lint',
        'ReScript Lint',
        {
          command: launch.command,
          args: [...launch.args],
          options: Option.match(launch.root, {
            onNone: () => ({ shell: false }),
            onSome: (cwd) => ({ shell: false, cwd }),
          }),
        },
        clientOptions(launch, output),
      )
      return {
        start: operation('start', () => client.start()),
        restart: operation('restart', () => client.restart()),
        dispose: operation('dispose', () => client.dispose()),
      }
    },
    catch: (cause) => new ClientError({ operation: 'create', detail: String(cause) }),
  })
}

function configuredSession(output: vscode.LogOutputChannel): Layer.Layer<Session, StartupError> {
  const config = vscode.workspace.getConfiguration('rescriptLint')
  const settings = decodeSettings({
    enable: config.get<unknown>('enable', true),
    serverPath: config.get<unknown>('serverPath', ''),
    nodePath: config.get<unknown>('nodePath', 'node'),
  })
  const roots = (vscode.workspace.workspaceFolders ?? []).map((folder) =>
    Option.some(folder.uri.fsPath),
  )
  return Layer.unwrapEffect(
    settings.pipe(
      Effect.flatMap((value) =>
        value.enable
          ? Effect.forEach(roots.length === 0 ? [Option.none<string>()] : roots, (root) =>
              resolveServer(value, root),
            )
          : Effect.succeed([]),
      ),
      Effect.map(sessionLayer),
    ),
  ).pipe(
    Layer.provide(ServerFilesLive),
    Layer.provide(
      Layer.succeed(ClientFactory, {
        create: (launch) => createClient(launch, output),
        report: (error) => Effect.sync(() => output.error(error.detail)),
      }),
    ),
  )
}

let activeRuntime: Option.Option<ManagedRuntime.ManagedRuntime<Controller, never>> = Option.none()

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('ReScript Lint', { log: true })
  const runtime = ManagedRuntime.make(
    ControllerLive.pipe(
      Layer.provide(
        Layer.succeed(SessionSource, {
          load: Effect.sync(() => configuredSession(output)),
          report: (cause) =>
            Effect.sync(() => {
              output.error(failureMessage(cause))
              output.error(
                'Check rescriptLint.serverPath, then run ReScript Lint: Restart Language Server.',
              )
              output.show(true)
            }),
        }),
      ),
    ),
  )
  activeRuntime = Option.some(runtime)
  context.subscriptions.push(
    output,
    vscode.commands.registerCommand('rescriptLint.showOutput', () => output.show()),
    vscode.commands.registerCommand('rescriptLint.restart', () =>
      runtime.runPromise(Effect.flatMap(Controller, (controller) => controller.reload)),
    ),
  )
  await runtime.runPromise(Effect.flatMap(Controller, (controller) => controller.reload))
}

export async function deactivate(): Promise<void> {
  const runtime = activeRuntime
  activeRuntime = Option.none()
  if (Option.isSome(runtime)) await runtime.value.dispose()
}
