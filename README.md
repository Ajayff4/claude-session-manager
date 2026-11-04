# Claude Account Switcher

Got more than one Claude Code account? Switch between them in VS Code with one click, no logging out and back in.

> Unofficial, not affiliated with Anthropic. Needs the official [Claude Code](https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code) extension.

## What you get

- 🗂️ **Sidebar panel** with a card per account: name, email, plan, logged in or not
- ⚡ **One-click switch** from the panel or the `Claude: <name>` status bar item
- 💬 **Shared history:** every account sees the same chats, settings, plugins and skills
- 🔑 **Log in, add, delete** accounts right from the panel
- 📦 **Export / import** your accounts to another machine

## Quick start

1. Open the **Claude Profiles** panel in the activity bar.
2. Click **Add**, give the account a name, then **Log in**.
3. Click any card to switch. The window reloads and Claude uses that account.

Your normal `~/.claude` shows up as **default**.

## How it works

Each extra account lives in `~/.claude-<name>`. Switching sets `CLAUDE_CONFIG_DIR` for the Claude extension and reloads the window. Same as running `CLAUDE_CONFIG_DIR=~/.claude-<name> claude` in a terminal, so your profiles work there too.

## Good to know

- 🔒 **Nothing leaves your machine.** No network calls, no telemetry, no dependencies.
- ⚠️ **"Export with logins" files contain real login tokens.** Treat them like passwords and delete them after importing.
- ⚠️ **Only import files you exported yourself.** Someone else's file can sign you into *their* account.
- Deleting an account logs it out and moves its folder to the trash. Shared chats are never touched.
- Needs VS Code 1.90+ and the `claude` CLI. Tested on Linux and macOS.

## Develop

```bash
npm install
npm test
npm run package
```

Press **F5** to try it in a sandboxed VS Code window.

## License

[MIT](https://github.com/Ajayff4/claude-session-manager/blob/HEAD/LICENSE)
