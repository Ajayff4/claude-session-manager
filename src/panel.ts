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
${styles()}
</style></head>
<body>
${body()}
<script nonce="${nonce}">
${script()}
</script>
</body></html>`;
}

function styles(): string {
  return /* css */ `
  @property --rgb-angle { syntax: '<angle>'; inherits: false; initial-value: 0deg; }
  :root { --radius: 10px; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 12px 12px 16px;
    color: var(--vscode-foreground);
    font: 13px/1.45 var(--vscode-font-family);
    background: transparent;
  }
  .section { margin-bottom: 20px; }
  .section-head {
    margin: 0 4px 8px;
    font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
  }
  .list { display: flex; flex-direction: column; gap: 6px; }

  .card {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 10px;
    border: 1px solid var(--vscode-widget-border, rgba(128,128,128,.22));
    border-radius: var(--radius);
    background: var(--vscode-editorWidget-background, rgba(128,128,128,.06));
    transition: background .12s ease, border-color .12s ease;
  }
  .card.clickable { cursor: pointer; }
  .card.clickable:hover { background: var(--vscode-list-hoverBackground); border-color: var(--vscode-focusBorder); }
  .card.active {
    border-color: var(--vscode-focusBorder);
    background: var(--vscode-list-inactiveSelectionBackground, rgba(128,128,128,.1));
  }
  .card.active.live {
    border-color: transparent;
    background:
      linear-gradient(var(--vscode-list-inactiveSelectionBackground, rgba(128,128,128,.1)),
                      var(--vscode-list-inactiveSelectionBackground, rgba(128,128,128,.1))) padding-box,
      linear-gradient(var(--vscode-sideBar-background, #252526),
                      var(--vscode-sideBar-background, #252526)) padding-box,
      conic-gradient(from var(--rgb-angle), #ff1f4b, #22ff66, #2f7bff, #ff1f4b) border-box;
    animation: rgb-angle 5s linear infinite;
  }
  @keyframes rgb-angle { to { --rgb-angle: 360deg; } }
  @media (prefers-reduced-motion: reduce) { .card.active.live { animation: none; } }

  .avatar {
    position: relative; flex: none;
    display: grid; place-items: center;
    width: 34px; height: 34px; border-radius: 11px;
    font-size: 12px; font-weight: 700; letter-spacing: .02em;
    color: var(--tone);
    background: var(--vscode-badge-background, rgba(128,128,128,.18));
    background: linear-gradient(135deg,
      color-mix(in srgb, var(--tone) 24%, transparent),
      color-mix(in srgb, var(--tone) 9%, transparent));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tone) 26%, transparent);
    transition: transform .12s ease;
  }
  .card.clickable:hover .avatar { transform: scale(1.04); }
  .active .avatar { width: 38px; height: 38px; font-size: 13px; border-radius: 12px; }
  .status {
    position: absolute; right: 0; bottom: 0;
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--vscode-charts-green, #3fb950);
    border: 2px solid var(--vscode-sideBar-background, var(--vscode-editor-background));
  }
  .status.off { background: var(--vscode-disabledForeground, #8b949e); }

  .meta { flex: 1; min-width: 0; }
  .top { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .email { font-size: 12px; color: var(--vscode-descriptionForeground); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .email.off { font-style: italic; color: var(--vscode-editorWarning-foreground); }

  .badge {
    flex: none; padding: 0 6px; border-radius: 999px;
    font-size: 10px; font-weight: 600; line-height: 16px; letter-spacing: .03em; text-transform: uppercase;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  }
  .badge.live {
    display: inline-flex; align-items: center;
    padding: 0 7px; background: var(--vscode-charts-green, #3fb950); color: #fff;
  }

  .actions { flex: none; display: flex; align-items: center; gap: 1px; }
  button { font: inherit; border: 0; cursor: pointer; border-radius: 5px; background: transparent; color: inherit; }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .icon-btn {
    display: grid; place-items: center;
    width: 26px; height: 26px; padding: 0;
    color: var(--vscode-icon-foreground); opacity: .7;
    transition: background .1s ease, opacity .1s ease, color .1s ease;
  }
  .icon-btn:hover { background: var(--vscode-toolbar-hoverBackground); opacity: 1; }
  .icon-btn.danger { opacity: 0; pointer-events: none; }
  .card:hover .icon-btn.danger, .card:focus-within .icon-btn.danger { opacity: .7; pointer-events: auto; }
  .icon-btn.danger:hover { color: var(--vscode-errorForeground); opacity: 1; }
  .switch {
    padding: 5px 12px; font-size: 12px; font-weight: 600;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    transition: background .1s ease;
  }
  .switch:hover { background: var(--vscode-button-hoverBackground); }
  .switch:active { transform: translateY(1px); }
  svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }

  footer {
    display: flex; flex-direction: column; gap: 6px;
    padding-top: 14px;
    border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,.22));
  }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    width: 100%; padding: 7px 10px; border-radius: 6px;
    font-weight: 500;
    background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
    transition: background .1s ease;
  }
  .btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .btn.primary:hover { background: var(--vscode-button-hoverBackground); }
  .btn:active { transform: translateY(1px); }
  .row { display: flex; gap: 6px; }
  .hint { margin: 8px 4px 0; font-size: 11.5px; line-height: 1.5; color: var(--vscode-descriptionForeground); text-align: center; }
  .empty {
    padding: 14px 12px; text-align: center; font-size: 12px;
    color: var(--vscode-descriptionForeground);
    border: 1px dashed var(--vscode-widget-border, rgba(128,128,128,.3));
    border-radius: var(--radius);
  }
`;
}

function body(): string {
  return /* html */ `
  <div class="section">
    <div class="section-head">Current account</div>
    <div id="active" class="list"></div>
  </div>
  <div class="section">
    <div class="section-head" id="othersLabel">Switch to</div>
    <div id="others" class="list"></div>
    <div id="empty" class="empty">No other accounts yet. Add a profile to switch between Claude accounts.</div>
  </div>
  <footer>
    <button class="btn primary" data-cmd="add"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Add profile</button>
    <div class="row">
      <button class="btn" data-cmd="import"><svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg>Import</button>
      <button class="btn" data-cmd="export"><svg viewBox="0 0 24 24"><path d="M12 15V4m0 0L8 8m4-4 4 4M5 20h14"/></svg>Export</button>
    </div>
    <div class="hint">Switching reloads the window. Chats, settings and plugins stay shared.</div>
  </footer>
`;
}

function script(): string {
  return /* js */ `
  const vscode = acquireVsCodeApi();
  const KEY = '<svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-4 4 3 3m-6 0 2 2"/></svg>';
  const TRASH = '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
  const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const TONES = [['blue', '#3794ff'], ['green', '#89d185'], ['purple', '#b180d7'], ['orange', '#d18616'], ['red', '#f14c4c'], ['yellow', '#cca700']];
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const send = (cmd, dir) => vscode.postMessage({ cmd, dir });
  const initials = (p) => {
    const words = String(p.displayName || p.name).split(/[\s._-]+/).filter(Boolean);
    const s = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || p.name).slice(0, 2);
    return s.toUpperCase();
  };
  const iconBtn = (cls, svg, label) => {
    const b = el('button', cls);
    b.innerHTML = svg;
    b.title = label;
    b.setAttribute('aria-label', label);
    return b;
  };

  function card(p) {
    const c = el('div', 'card' + (p.active ? ' active' : ' clickable') + (p.loggedIn ? ' live' : ''));
    c.title = p.dir;

    const av = el('div', 'avatar', initials(p));
    const tone = TONES[hue(p.name) % TONES.length];
    av.style.setProperty('--tone', 'var(--vscode-charts-' + tone[0] + ', ' + tone[1] + ')');
    const dot = el('span', 'status' + (p.loggedIn ? '' : ' off'));
    dot.title = p.loggedIn ? 'Logged in' : 'Not logged in';
    av.appendChild(dot);

    const meta = el('div', 'meta');
    const top = el('div', 'top');
    top.appendChild(el('span', 'name', p.name));
    if (p.active) top.appendChild(el('span', 'badge live', 'Active'));
    if (p.plan) top.appendChild(el('span', 'badge', p.plan));
    meta.appendChild(top);
    meta.appendChild(el('div', 'email' + (p.loggedIn ? '' : ' off'), p.loggedIn ? p.email : 'Not logged in'));

    const actions = el('div', 'actions');
    const login = iconBtn('icon-btn', KEY, p.loggedIn ? 'Log in again (terminal)' : 'Log in (terminal)');
    login.onclick = (e) => { e.stopPropagation(); send('login', p.dir); };
    actions.appendChild(login);
    if (!p.active && p.name !== 'default') {
      const del = iconBtn('icon-btn danger', TRASH, 'Delete profile');
      del.onclick = (e) => { e.stopPropagation(); send('delete', p.dir); };
      actions.appendChild(del);
    }

    c.append(av, meta, actions);
    if (!p.active) {
      const sw = el('button', 'switch', 'Switch');
      sw.onclick = (e) => { e.stopPropagation(); send('switch', p.dir); };
      c.appendChild(sw);
      c.onclick = () => send('switch', p.dir);
    }
    return c;
  }

  window.addEventListener('message', ({ data }) => {
    if (data.type !== 'state') return;
    const act = document.getElementById('active'), oth = document.getElementById('others');
    const rest = data.profiles.filter((p) => !p.active);
    act.replaceChildren(...data.profiles.filter((p) => p.active).map(card));
    oth.replaceChildren(...rest.map(card));
    document.getElementById('othersLabel').style.display = rest.length ? '' : 'none';
    document.getElementById('empty').style.display = rest.length ? 'none' : '';
  });
  document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => send(b.dataset.cmd)));
  send('ready');
`;
}
