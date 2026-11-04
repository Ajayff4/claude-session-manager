// Run: npm test  (node's built-in runner on compiled output; no test framework)
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createProfile, listProfiles, accountEmail, accountInfo, exportProfiles, importProfiles, prepareDelete, shQuote } from './profiles';

test('createProfile mirrors claude-profiles.sh and is idempotent', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cps-'));
  fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'main@x' } }));

  const p = createProfile('work', home, '/bin/bash');
  createProfile('work', home, '/bin/bash');

  assert.equal(fs.readlinkSync(path.join(p.dir, 'projects')), path.join(home, '.claude', 'projects'));
  // .claude.json copied from main carries main's email, but no credentials yet → not logged in.
  assert.equal(accountEmail(p, home), 'not logged in');
  assert.deepEqual(accountInfo(p, home), { loggedIn: false }); // no borrowed plan chip / name
  const aliases = fs.readFileSync(path.join(home, '.bashrc'), 'utf8').split('\n').filter((l) => l.includes('claude-work'));
  assert.equal(aliases.length, 1);
  assert.deepEqual(listProfiles(home).map((x) => x.name), ['default', 'work']);
  assert.throws(() => createProfile('bad name', home));
  assert.throws(() => createProfile('default', home));
});

test('prepareDelete unlinks shared symlinks (main data survives rm) and drops alias', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cps-del-'));
  fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'projects', 'chat.jsonl'), 'x');
  createProfile('old', home, '/bin/bash');
  createProfile('keep', home, '/bin/bash');

  const dir = prepareDelete('old', home, '/bin/bash');
  fs.rmSync(dir, { recursive: true, force: true });

  assert.ok(fs.existsSync(path.join(home, '.claude', 'projects', 'chat.jsonl')));
  const rc = fs.readFileSync(path.join(home, '.bashrc'), 'utf8');
  assert.ok(!rc.includes('claude-old') && rc.includes('claude-keep'));
  assert.deepEqual(listProfiles(home).map((x) => x.name), ['default', 'keep']);
  assert.throws(() => prepareDelete('default', home));
  assert.throws(() => prepareDelete('../x', home));
});

test('export/import round-trips profiles; logins only when asked, never clobbered by default', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'cps-src-'));
  fs.mkdirSync(path.join(src, '.claude'), { recursive: true });
  const p = createProfile('team', src, '/bin/bash');
  fs.writeFileSync(path.join(p.dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 't@x', organizationType: 'claude_pro' } }));
  fs.writeFileSync(path.join(p.dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'secret' } }));

  // Profiles-only export carries no personal data at all: names only.
  assert.deepEqual(exportProfiles(false, src).profiles, [{ name: 'default' }, { name: 'team' }]);
  const bundle = JSON.parse(JSON.stringify(exportProfiles(true, src)));

  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'cps-dst-'));
  fs.mkdirSync(path.join(dst, '.claude'), { recursive: true });
  const r = importProfiles(bundle, false, dst, '/bin/bash');
  assert.deepEqual(r.created, ['team']);
  const imported = { name: 'team', dir: path.join(dst, '.claude-team') };
  assert.deepEqual(accountInfo(imported, dst), { loggedIn: true, email: 't@x', displayName: undefined, plan: 'Pro' });
  assert.equal(fs.statSync(path.join(imported.dir, '.credentials.json')).mode & 0o777, 0o600);

  assert.deepEqual(importProfiles(bundle, false, dst, '/bin/bash').skipped, ['team (already logged in)']);
  assert.throws(() => importProfiles({ format: 'nope' }, false, dst));
});

test('hostile folder names are never listed; quoting survives quotes', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cps-evil-'));
  fs.mkdirSync(path.join(home, ".claude-x';touch pwned;'"), { recursive: true });
  assert.deepEqual(listProfiles(home).map((x) => x.name), ['default']);
  assert.equal(shQuote("a'b"), `'a'\\''b'`);
});

test('new profile folder and its .claude.json are owner-only', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cps-perm-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude.json'), '{}', { mode: 0o664 });
  const p = createProfile('p', home, '/bin/bash');
  assert.equal(fs.statSync(p.dir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(p.dir, '.claude.json')).mode & 0o777, 0o600);
});
