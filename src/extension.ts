// Switching writes CLAUDE_CONFIG_DIR into the Claude extension's own `claudeCode.environmentVariables`
// user setting (it watches that setting), then reloads the window. The setting persists, so the last
// pick is the default on next launch.
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import {
  Profile, MAIN, HOME, NAME_RE, listProfiles, accountInfo, accountEmail, createProfile, exportProfiles, importProfiles,
  prepareDelete, shQuote,
} from './profiles';
import { ProfilesPanel, PanelMsg } from './panel';

interface EnvEntry { name: string; value: string }
const ENV_KEY = 'environmentVariables';

// Effective value (user + workspace) — used only to tell which profile is active.
const envEntries = (): EnvEntry[] => vscode.workspace.getConfiguration('claudeCode').get<EnvEntry[]>(ENV_KEY) || [];
// User-level value only — what we read-modify-write. Using the merged value would copy env vars from a
// repo's .vscode/settings.json (e.g. ANTHROPIC_BASE_URL → attacker proxy) into your global settings.
const userEnvEntries = (): EnvEntry[] =>
  vscode.workspace.getConfiguration('claudeCode').inspect<EnvEntry[]>(ENV_KEY)?.globalValue || [];

// Claude extension only honors an absolute CLAUDE_CONFIG_DIR here; otherwise it falls back to VS Code's own env.
function currentDir(): string {
  const e = envEntries().find((x) => x.name === 'CLAUDE_CONFIG_DIR' && path.isAbsolute(x.value || ''));
  const v = e ? e.value : process.env.CLAUDE_CONFIG_DIR;
  return v ? path.resolve(v) : MAIN;
}

function currentProfile(): Profile {
  const dir = currentDir();
  return listProfiles().find((p) => p.dir === dir) || { name: path.basename(dir), dir };
}

async function switchTo(p: Profile): Promise<void> {
  if (p.dir === currentDir()) return;
  const rest = userEnvEntries().filter((x) => x.name !== 'CLAUDE_CONFIG_DIR');
  // Default = no entry. Setting it to ~/.claude would move state to ~/.claude/.claude.json and log you out.
  const next = p.dir === MAIN ? rest : [...rest, { name: 'CLAUDE_CONFIG_DIR', value: p.dir }];
  await vscode.workspace.getConfiguration('claudeCode').update(ENV_KEY, next, vscode.ConfigurationTarget.Global);
  if (p.dir === MAIN && process.env.CLAUDE_CONFIG_DIR) {
    vscode.window.showWarningMessage(
      `VS Code was started with CLAUDE_CONFIG_DIR=${process.env.CLAUDE_CONFIG_DIR}, so 'default' can't apply. Start VS Code without it.`);
    return;
  }
  await vscode.commands.executeCommand('workbench.action.reloadWindow');
}

// `claude` may not be on PATH at all: the official extension ships its own CLI, and many users never
// install the standalone one. Check PATH, then ~/.local/bin, then the extension's bundled binary.
function claudeBinary(): string {
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const usable = (f?: string) => {
    if (!f) return false;
    try { fs.accessSync(f, fs.constants.X_OK); return true; } catch { return false; }
  };
  const bundled = vscode.extensions.getExtension('anthropic.claude-code')?.extensionPath;
  return [
    ...(process.env.PATH || '').split(path.delimiter).map((d) => path.join(d, exe)),
    path.join(HOME, '.local', 'bin', exe),
    bundled && path.join(bundled, 'resources', 'native-binary', exe),
  ].find(usable) || exe;
}

function loginInTerminal(p: Profile): void {
  // A repo's .vscode/settings.json can point CLAUDE_CONFIG_DIR anywhere; never write a login outside a known profile.
  if (!listProfiles().some((x) => x.dir === p.dir)) {
    vscode.window.showErrorMessage(`Refusing to log in: ${p.dir} is not a Claude profile (set by workspace settings?).`);
    return;
  }
  const bin = shQuote(claudeBinary());
  const t = vscode.window.createTerminal({ name: `Claude login: ${p.name}` });
  t.show();
  const prefix = p.dir === MAIN ? `env -u CLAUDE_CONFIG_DIR ${bin}` : `CLAUDE_CONFIG_DIR=${shQuote(p.dir)} ${bin}`;
  t.sendText(`${prefix} auth login && ${prefix} auth status`);
}

async function addProfile(): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: 'New Claude profile name (creates ~/.claude-<name>)',
    validateInput: (v) => !NAME_RE.test(v) ? 'Letters, digits, - or _ only' : v === 'default' ? 'Reserved name' : null,
  });
  if (!name) return;
  let p: Profile;
  try {
    p = createProfile(name);
  } catch (e) {
    vscode.window.showErrorMessage(`Could not create profile '${name}': ${(e as Error).message}`);
    return;
  }
  // Not awaited: callers refresh the panel when this returns, but the profile is already created,
  // so it should appear immediately instead of waiting for the prompt below to be dismissed.
  void vscode.window.showInformationMessage(`Profile '${name}' created. Log in now?`, 'Log in (terminal)', 'Switch to it')
    .then((pick) => {
      if (pick === 'Log in (terminal)') loginInTerminal(p);
      if (pick === 'Switch to it') return switchTo(p);
    })
    .then(undefined, (e) => vscode.window.showErrorMessage(`Could not switch profile: ${(e as Error).message}`));
}

// `claude auth logout` for one profile. execFile = no shell, so the path can't inject anything.
// Resolves to an error message, or undefined on success.
async function logout(dir: string): Promise<string | undefined> {
  return new Promise<string | undefined>((res) =>
    execFile(claudeBinary(), ['auth', 'logout'], { env: { ...process.env, CLAUDE_CONFIG_DIR: dir }, timeout: 30_000 },
      (e, _out, stderr) => res(e ? (String(stderr).trim() || e.message) : undefined)));
}

async function deleteProfile(p?: Profile): Promise<void> {
  if (!p) {
    const cur = currentDir();
    const pick = await vscode.window.showQuickPick(
      listProfiles().filter((x) => x.dir !== MAIN && x.dir !== cur)
        .map((x) => ({ label: x.name, description: accountEmail(x), profile: x })),
      { placeHolder: 'Delete which Claude profile?' });
    if (!pick) return;
    p = pick.profile;
  }
  if (p.dir === MAIN) { vscode.window.showWarningMessage("The default profile can't be deleted."); return; }
  if (p.dir === currentDir()) { vscode.window.showWarningMessage(`'${p.name}' is active. Switch to another profile first.`); return; }
  const cred = path.join(p.dir, '.credentials.json');
  const loggedIn = fs.existsSync(cred);
  const ok = await vscode.window.showWarningMessage(
    `Delete profile '${p.name}' (${accountEmail(p)})?`,
    { modal: true, detail: `${loggedIn ? 'Logs the account out first, then ' : ''}moves ${p.dir} to the trash (with its prompt history). Shared chat history in ~/.claude is not touched.` },
    'Log Out & Delete');
  if (!ok) return;
  try {
    if (loggedIn) {
      const err = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Logging out '${p.name}'…` }, () => logout(p!.dir));
      if (err) {
        const go = await vscode.window.showWarningMessage(`Logout failed for '${p.name}'. Delete anyway?`, {
          modal: true,
          detail: `${err}\n\nThe login token is still wiped from this machine, but Anthropic may treat it as valid until it expires.`,
        }, 'Delete Anyway');
        if (!go) return;
      }
      // Whatever logout did, the token file is removed permanently, never sent to the trash.
      fs.rmSync(cred, { force: true });
    }
    const dir = prepareDelete(p.name);
    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(dir), { recursive: true, useTrash: true });
    } catch {
      const hard = await vscode.window.showWarningMessage(`Trash unavailable. Permanently delete ${dir}?`, { modal: true }, 'Delete Permanently');
      if (!hard) return;
      fs.rmSync(dir, { recursive: true, force: true });
    }
    vscode.window.showInformationMessage(`Profile '${p.name}' deleted.`);
  } catch (e) {
    vscode.window.showErrorMessage(`Could not delete '${p.name}': ${(e as Error).message}`);
  }
}

async function doExport(): Promise<void> {
  const mode = await vscode.window.showQuickPick([
    { label: 'Profiles only', description: 'profile names only, no personal data; log in again after import', creds: false },
    { label: 'Profiles + logins', description: 'includes login tokens — anyone with the file can use your accounts', creds: true },
  ], { placeHolder: 'What to export?' });
  if (!mode) return;
  if (mode.creds) {
    const ok = await vscode.window.showWarningMessage(
      'Export live login tokens?',
      { modal: true, detail: 'The file will contain Claude login tokens (and any MCP server logins, e.g. GitLab) plus account emails for every profile. Anyone who gets it can use those accounts until the tokens expire. It is not encrypted: move it only over a channel you trust, then delete it.' },
      'Export with logins');
    if (!ok) return;
  }
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(HOME, `claude-profiles${mode.creds ? '-with-logins' : ''}.json`)),
    filters: { JSON: ['json'] },
  });
  if (!uri) return;
  fs.writeFileSync(uri.fsPath, JSON.stringify(exportProfiles(mode.creds), null, 2), { mode: 0o600 });
  fs.chmodSync(uri.fsPath, 0o600); // `mode` only applies to new files; overwriting keeps old (maybe public) perms
  vscode.window.showInformationMessage(`Exported ${listProfiles().length} profiles to ${uri.fsPath}`);
}

async function doImport(): Promise<void> {
  const [uri] = await vscode.window.showOpenDialog({ filters: { JSON: ['json'] }, canSelectMany: false }) || [];
  if (!uri) return;
  try {
    const raw = JSON.parse(fs.readFileSync(uri.fsPath, 'utf8'));
    let overwrite = false;
    const all: any[] = Array.isArray(raw?.profiles) ? raw.profiles : [];
    const withLogins = all.filter((p: any) => p?.credentials);
    if (!withLogins.length) {
      // Even without logins, an import creates folders and ~/.bashrc lines: show what, ask first.
      const ok = await vscode.window.showInformationMessage('Import these profiles?', {
        modal: true, detail: all.map((p) => `• ${String(p?.name)}`).join('\n') || '(none)',
      }, 'Import');
      if (!ok) return;
    } else {
      // A file from someone else could log you into THEIR account, so your prompts and code go to them.
      // The email shown is whatever the file claims, so only trust files you made yourself.
      const list = withLogins.map((p: any) => `• ${String(p.name)}: ${String(p.oauthAccount?.emailAddress ?? 'unknown account')}`).join('\n');
      const ok = await vscode.window.showWarningMessage('Import logins from this file?', {
        modal: true,
        detail: `${list}\n\nOnly import a file you exported yourself. A file from anyone else can sign this machine into an account they control, and they would see everything you send to Claude.`,
      }, 'I made this file, import');
      if (!ok) return;
      const pick = await vscode.window.showQuickPick(
        [{ label: 'Keep existing logins', o: false }, { label: 'Replace existing logins', o: true }],
        { placeHolder: 'File contains logins. For profiles already logged in here:' });
      if (!pick) return;
      overwrite = pick.o;
    }
    const r = importProfiles(raw, overwrite);
    const parts = [
      r.created.length && `created ${r.created.join(', ')}`,
      r.loggedIn.length && `logged in ${r.loggedIn.join(', ')}`,
      r.skipped.length && `skipped ${r.skipped.join(', ')}`,
    ].filter(Boolean);
    vscode.window.showInformationMessage(`Import done: ${parts.join('; ') || 'nothing new'}.`);
  } catch (e) {
    vscode.window.showErrorMessage(`Import failed: ${(e as Error).message}`);
  }
}

async function showPicker(): Promise<void> {
  const cur = currentDir();
  type Item = vscode.QuickPickItem & { profile?: Profile; action?: () => unknown };
  const items: Item[] = listProfiles().map((p) => ({
    label: `${p.dir === cur ? '$(check) ' : ''}${p.name}`, description: accountEmail(p), detail: p.dir, profile: p,
  }));
  items.push(
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label: '$(add) Add profile…', action: addProfile },
    { label: '$(key) Log in current profile (terminal)…', action: () => loginInTerminal(currentProfile()) },
  );
  const sel = await vscode.window.showQuickPick(items, { placeHolder: 'Switch Claude profile' });
  if (!sel) return;
  if (sel.action) { await sel.action(); return; }
  if (sel.profile) await switchTo(sel.profile);
}

export function activate(context: vscode.ExtensionContext): void {
  const byDir = (dir?: string) => listProfiles().find((p) => p.dir === dir);
  const cur = () => currentDir();
  const panel = new ProfilesPanel(
    () => listProfiles().map((p) => ({ ...p, ...accountInfo(p), active: p.dir === cur() })),
    async (m: PanelMsg) => {
      const p = byDir(m.dir);
      if (m.cmd === 'switch' && p) await switchTo(p);
      else if (m.cmd === 'login') loginInTerminal(p || currentProfile());
      else if (m.cmd === 'delete' && p) await deleteProfile(p);
      else if (m.cmd === 'add') await addProfile();
      else if (m.cmd === 'import') await doImport();
      else if (m.cmd === 'export') await doExport();
      refresh();
    });

  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  bar.command = 'claudeProfiles.switch';
  const refresh = () => {
    const p = currentProfile();
    bar.text = `$(account) Claude: ${p.name}`;
    bar.tooltip = `${accountEmail(p)}\n${p.dir}\nClick to switch`;
    panel.refresh();
  };
  refresh();
  bar.show();
  const after = (fn: () => unknown) => async () => { await fn(); refresh(); };
  context.subscriptions.push(
    bar,
    vscode.window.registerWebviewViewProvider('claudeProfiles.list', panel),
    vscode.commands.registerCommand('claudeProfiles.switch', showPicker),
    vscode.commands.registerCommand('claudeProfiles.add', after(addProfile)),
    vscode.commands.registerCommand('claudeProfiles.login', () => loginInTerminal(currentProfile())),
    vscode.commands.registerCommand('claudeProfiles.import', after(doImport)),
    vscode.commands.registerCommand('claudeProfiles.export', doExport),
    vscode.commands.registerCommand('claudeProfiles.refresh', refresh),
    vscode.commands.registerCommand('claudeProfiles.delete', after(() => deleteProfile())),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('claudeCode') && refresh()),
    // Pick up emails after a terminal login finishes, or changes made outside VS Code.
    vscode.window.onDidCloseTerminal(refresh),
    vscode.window.onDidChangeWindowState((s) => s.focused && refresh()),
  );
}

export function deactivate(): void {}
