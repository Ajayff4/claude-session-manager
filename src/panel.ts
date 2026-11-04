// Sidebar webview: profile cards. All rendering happens in the webview script from a `state` message;
// clicks post `{ cmd, dir }` back to the extension.
import * as vscode from 'vscode';
import * as crypto from 'crypto';

export interface CardState {
  name: string;
  dir: string;
  active: boolean;
  loggedIn: boolean;
  email?: string;
  displayName?: string;
  plan?: string;
}

export type PanelMsg = { cmd: 'switch' | 'login' | 'delete' | 'add' | 'import' | 'export' | 'refresh' | 'ready'; dir?: string };

export class ProfilesPanel implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(private getState: () => CardState[], private onMsg: (m: PanelMsg) => unknown) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    // No local files at all (default would expose the extension + workspace folders to the webview).
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = html(crypto.randomBytes(16).toString('base64'));
    view.webview.onDidReceiveMessage((m: PanelMsg) => (m.cmd === 'ready' ? this.refresh() : this.onMsg(m)));
    view.onDidChangeVisibility(() => view.visible && this.refresh());
  }

  refresh(): void {
    this.view?.webview.postMessage({ type: 'state', profiles: this.getState() });
  }
}

function html(nonce: string): string {
  return /* html */ `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  :root { --r: 8px; --gap: 10px; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 12px 12px 16px; color: var(--vscode-foreground); font: 13px/1.4 var(--vscode-font-family); background: transparent; }
  .eyebrow { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--vscode-descriptionForeground); margin: 4px 2px 8px; }
  .list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }
  .card { display: flex; align-items: center; gap: var(--gap); padding: 10px; border-radius: var(--r);
          border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.25));
          background: var(--vscode-editorWidget-background, rgba(128,128,128,.06)); transition: border-color .12s, background .12s; }
  .card.clickable { cursor: pointer; }
  .card.clickable:hover { background: var(--vscode-list-hoverBackground); border-color: var(--vscode-focusBorder); }
  .card.active { border-color: var(--vscode-focusBorder); box-shadow: inset 3px 0 0 var(--vscode-focusBorder); padding: 14px 12px; }
  .avatar { flex: none; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center;
            font-weight: 600; font-size: 14px; color: #fff; text-transform: uppercase; position: relative; }
  .active .avatar { width: 42px; height: 42px; font-size: 17px; }
  .dot { position: absolute; right: -1px; bottom: -1px; width: 11px; height: 11px; border-radius: 50%;
         border: 2px solid var(--vscode-sideBar-background); background: var(--vscode-charts-green, #3fb950); }
  .dot.off { background: var(--vscode-disabledForeground, #888); }
  .meta { min-width: 0; flex: 1; }
  .row1 { display: flex; align-items: center; gap: 6px; }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .active .name { font-size: 14px; }
  .sub { color: var(--vscode-descriptionForeground); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub.warn { color: var(--vscode-editorWarning-foreground); }
  .badge { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 10px; letter-spacing: .03em;
           background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .badge.live { background: var(--vscode-charts-green, #3fb950); color: #fff; }
  .actions { display: flex; gap: 4px; flex: none; }
  button { font: inherit; border: 0; border-radius: 5px; cursor: pointer; padding: 5px 10px;
           background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  button.icon { padding: 5px 7px; line-height: 0; background: transparent; color: var(--vscode-icon-foreground); }
  button.icon:hover { background: var(--vscode-toolbar-hoverBackground); }
  button.icon.danger:hover { color: var(--vscode-errorForeground); }
  .card .icon.danger { opacity: 0; }
  .card:hover .icon.danger, .icon.danger:focus-visible { opacity: 1; }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .toolbar { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
  .toolbar button { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 7px 6px; }
  .hint { margin-top: 14px; font-size: 11.5px; color: var(--vscode-descriptionForeground); }
</style></head>
<body>
  <div class="eyebrow">Active account</div>
  <div id="active" class="list"></div>
  <div class="eyebrow" id="othersLabel">Switch to</div>
  <div id="others" class="list"></div>
  <div class="toolbar">
    <button class="primary" data-cmd="add"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Add</button>
    <button data-cmd="import"><svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg>Import</button>
    <button data-cmd="export"><svg viewBox="0 0 24 24"><path d="M12 15V4m0 0L8 8m4-4 4 4M5 20h14"/></svg>Export</button>
  </div>
  <div class="hint">Switching reloads the window. Chat history is shared across profiles.</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const KEY = '<svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-4 4 3 3m-6 0 2 2"/></svg>';
  const TRASH = '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
  const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const send = (cmd, dir) => vscode.postMessage({ cmd, dir });

  function card(p) {
    const c = el('div', 'card' + (p.active ? ' active' : ' clickable'));
    c.title = p.dir;
    const av = el('div', 'avatar', (p.displayName || p.name)[0]);
    const h = hue(p.name);
    av.style.background = 'linear-gradient(135deg, hsl(' + h + ' 65% 52%), hsl(' + ((h + 40) % 360) + ' 70% 42%))';
    av.appendChild(el('span', 'dot' + (p.loggedIn ? '' : ' off')));
    const meta = el('div', 'meta');
    const r1 = el('div', 'row1');
    r1.appendChild(el('span', 'name', p.name));
    if (p.active) r1.appendChild(el('span', 'badge live', 'ACTIVE'));
    if (p.plan) r1.appendChild(el('span', 'badge', p.plan.toUpperCase()));
    meta.appendChild(r1);
    meta.appendChild(el('div', 'sub' + (p.loggedIn ? '' : ' warn'), p.loggedIn ? p.email : 'Not logged in'));
    const act = el('div', 'actions');
    const login = el('button', 'icon'); login.innerHTML = KEY;
    login.title = p.loggedIn ? 'Log in again (terminal)' : 'Log in (terminal)';
    login.setAttribute('aria-label', login.title);
    login.onclick = (e) => { e.stopPropagation(); send('login', p.dir); };
    act.appendChild(login);
    if (!p.active && p.name !== 'default') {
      const del = el('button', 'icon danger'); del.innerHTML = TRASH;
      del.title = 'Delete profile'; del.setAttribute('aria-label', del.title);
      del.onclick = (e) => { e.stopPropagation(); send('delete', p.dir); };
      act.appendChild(del);
    }
    if (!p.active) {
      const sw = el('button', 'primary', 'Switch');
      sw.onclick = (e) => { e.stopPropagation(); send('switch', p.dir); };
      act.appendChild(sw);
      c.onclick = () => send('switch', p.dir);
    }
    c.append(av, meta, act);
    return c;
  }

  window.addEventListener('message', ({ data }) => {
    if (data.type !== 'state') return;
    const act = document.getElementById('active'), oth = document.getElementById('others');
    act.replaceChildren(...data.profiles.filter((p) => p.active).map(card));
    const rest = data.profiles.filter((p) => !p.active);
    oth.replaceChildren(...rest.map(card));
    document.getElementById('othersLabel').style.display = rest.length ? '' : 'none';
  });
  document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => send(b.dataset.cmd)));
  send('ready');
</script>
</body></html>`;
}
