// Profile filesystem logic, no vscode import so it can be tested with plain node.
// A profile is ~/.claude-<name> (same layout as claude-profiles.sh) or the default ~/.claude.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface Profile {
  name: string;
  dir: string;
}

export const HOME = os.homedir();
export const MAIN = path.join(HOME, '.claude');
// Symlinked to ~/.claude so settings, plugins and chat history (projects) are shared across accounts.
const SHARED = ['CLAUDE.md', 'settings.json', 'settings.local.json', 'plugins', 'skills', 'agents', 'hooks', 'projects'];
export const NAME_RE = /^[A-Za-z0-9_-]+$/;

export function listProfiles(home = HOME): Profile[] {
  const main = path.join(home, '.claude');
  const dirs = fs.readdirSync(home)
    // NAME_RE: a folder like ".claude-x';rm -rf ~;'" must never become a profile (its path reaches a shell).
    .filter((n) => n.startsWith('.claude-') && NAME_RE.test(n.slice('.claude-'.length))
      && fs.statSync(path.join(home, n), { throwIfNoEntry: false })?.isDirectory())
    .sort()
    .map((n) => ({ name: n.slice('.claude-'.length), dir: path.join(home, n) }));
  return [{ name: 'default', dir: main }, ...dirs];
}

// POSIX single-quote escaping for anything placed in a shell line (terminal, ~/.bashrc).
export const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
// Same format claude-profiles.sh writes. Only for shell-safe paths; otherwise no alias is written at all.
const SAFE_PATH = /^[A-Za-z0-9_\/.-]+$/;
const aliasLine = (name: string, dir: string) =>
  SAFE_PATH.test(dir) ? `alias claude-${name}='CLAUDE_CONFIG_DIR=${dir} claude'` : undefined;

// Default profile keeps its state in ~/.claude.json; others in <dir>/.claude.json.
const stateFile = (p: Profile, home: string) =>
  p.dir === path.join(home, '.claude') ? path.join(home, '.claude.json') : path.join(p.dir, '.claude.json');
const credFile = (p: Profile) => path.join(p.dir, '.credentials.json');

// Write to a temp file then rename: a crash or a concurrent Claude CLI write can't leave a half-written
// ~/.claude.json or ~/.bashrc. Keeps the target's existing permissions.
function writeAtomic(file: string, data: string, mode?: number): void {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const keep = fs.statSync(file, { throwIfNoEntry: false })?.mode;
  fs.writeFileSync(tmp, data, { mode: mode ?? (keep !== undefined ? keep & 0o777 : 0o600), flag: 'wx' });
  fs.renameSync(tmp, file);
}

function readJson(file: string): any {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; }
}

export interface AccountInfo {
  loggedIn: boolean;
  email?: string;
  displayName?: string;
  plan?: string; // "Pro", "Max", ...
}

export function accountInfo(p: Profile, home = HOME): AccountInfo {
  const a = readJson(stateFile(p, home))?.oauthAccount;
  // Only checks the token file exists; never reads tokens just to draw the UI.
  const loggedIn = fs.existsSync(credFile(p)) && !!a?.emailAddress;
  const sub: string | undefined = a?.organizationType?.replace(/^claude_/, '');
  // A fresh profile's .claude.json is a copy of main's, so its oauthAccount is main's until it logs in.
  if (!loggedIn) return { loggedIn };
  return {
    loggedIn,
    email: a.emailAddress,
    displayName: a.displayName,
    plan: sub ? sub[0].toUpperCase() + sub.slice(1) : undefined,
  };
}

export function accountEmail(p: Profile, home = HOME): string {
  const i = accountInfo(p, home);
  return i.loggedIn && i.email ? i.email : 'not logged in';
}

// Prepares ~/.claude-<name> for deletion and returns its path: unlinks the shared symlinks (so no delete can
// ever reach into ~/.claude) and drops the shell alias. Caller removes the folder (trash or rm).
export function prepareDelete(name: string, home = HOME, shell = process.env.SHELL || ''): string {
  if (!NAME_RE.test(name) || name === 'default') throw new Error(`Cannot delete profile '${name}'`);
  const dir = path.join(home, `.claude-${name}`);
  if (!fs.lstatSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`No profile folder ${dir}`);
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.lstatSync(p).isSymbolicLink()) fs.unlinkSync(p);
  }
  const rc = path.join(home, path.basename(shell) === 'zsh' ? '.zshrc' : '.bashrc');
  const line = aliasLine(name, dir);
  if (line && fs.existsSync(rc)) {
    const text = fs.readFileSync(rc, 'utf8');
    const kept = text.split('\n').filter((l) => l !== line).join('\n');
    if (kept !== text) writeAtomic(rc, kept);
  }
  return dir;
}

// ---- export / import ----
// Without credentials the bundle is profile names only (no emails/ids: nothing personal).
// With credentials it also carries each account's label so the UI can show it after import.
export interface BundleProfile { name: string; oauthAccount?: unknown; credentials?: unknown }
export interface Bundle { format: 'claude-profiles'; version: 1; exportedAt: string; profiles: BundleProfile[] }

export function exportProfiles(withCredentials: boolean, home = HOME): Bundle {
  return {
    format: 'claude-profiles',
    version: 1,
    exportedAt: new Date().toISOString(),
    profiles: listProfiles(home).map((p) => {
      const out: BundleProfile = { name: p.name };
      const cred = withCredentials ? readJson(credFile(p)) : undefined;
      if (cred) {
        out.credentials = cred;
        const acct = readJson(stateFile(p, home))?.oauthAccount;
        if (acct) out.oauthAccount = acct;
      }
      return out;
    }),
  };
}

export interface ImportResult { created: string[]; loggedIn: string[]; skipped: string[] }

// Never overwrites an existing login unless `overwrite` is set.
export function importProfiles(raw: unknown, overwrite = false, home = HOME, shell?: string): ImportResult {
  const b = raw as Bundle;
  if (!b || b.format !== 'claude-profiles' || b.version !== 1 || !Array.isArray(b.profiles)) {
    throw new Error('Not a claude-profiles export file');
  }
  const res: ImportResult = { created: [], loggedIn: [], skipped: [] };
  const existing = new Set(listProfiles(home).map((p) => p.name));
  for (const bp of b.profiles) {
    const name = String(bp?.name ?? '');
    if (name !== 'default' && !NAME_RE.test(name)) { res.skipped.push(`${name} (bad name)`); continue; }
    const p = name === 'default' ? { name, dir: path.join(home, '.claude') } : createProfile(name, home, shell);
    if (!existing.has(name)) res.created.push(name);
    if (!bp.credentials || typeof bp.credentials !== 'object') continue;
    if (fs.existsSync(credFile(p)) && !overwrite) { res.skipped.push(`${name} (already logged in)`); continue; }
    // Unlink first so a planted symlink can't redirect the token write; 'wx' = create new, owner-only.
    fs.rmSync(credFile(p), { force: true });
    fs.writeFileSync(credFile(p), JSON.stringify(bp.credentials, null, 2), { mode: 0o600, flag: 'wx' });
    if (bp.oauthAccount && typeof bp.oauthAccount === 'object' && !Array.isArray(bp.oauthAccount)) {
      const sf = stateFile(p, home);
      writeAtomic(sf, JSON.stringify({ ...(readJson(sf) || {}), oauthAccount: bp.oauthAccount }, null, 2));
    }
    res.loggedIn.push(name);
  }
  return res;
}

export function createProfile(name: string, home = HOME, shell = process.env.SHELL || ''): Profile {
  if (!NAME_RE.test(name) || name === 'default') throw new Error(`Invalid profile name: ${name}`);
  const main = path.join(home, '.claude');
  const dir = path.join(home, `.claude-${name}`);
  // Owner-only: the folder will hold login tokens and a copy of MCP config (which can contain API keys).
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const f of SHARED) {
    const src = path.join(main, f), dst = path.join(dir, f);
    if (fs.existsSync(src) && !fs.existsSync(dst)) fs.symlinkSync(src, dst);
  }
  // MCP servers / project state copied once; login overwrites the account part.
  const mainJson = path.join(home, '.claude.json'), json = path.join(dir, '.claude.json');
  if (fs.existsSync(mainJson) && !fs.existsSync(json)) {
    fs.copyFileSync(mainJson, json);
    fs.chmodSync(json, 0o600);
  }
  // Terminal alias, same as claude-profiles.sh.
  const rc = path.join(home, path.basename(shell) === 'zsh' ? '.zshrc' : '.bashrc');
  const line = aliasLine(name, dir);
  const rcText = fs.existsSync(rc) ? fs.readFileSync(rc, 'utf8') : '';
  if (line && !rcText.split('\n').includes(line)) {
    fs.appendFileSync(rc, (rcText === '' || rcText.endsWith('\n') ? '' : '\n') + line + '\n');
  }
  return { name, dir };
}
