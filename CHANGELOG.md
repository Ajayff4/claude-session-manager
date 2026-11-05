# Changelog

## 0.2.0

- Switching profiles reloads the window automatically, no confirmation dialog
- Redesigned sidebar panel: cleaner cards, theme-aware avatar colors, empty state
- Animated RGB border on the active, logged-in profile
- Login and logout work without the standalone `claude` CLI by falling back to the Claude Code extension's bundled binary
- New profiles show up in the panel immediately after creation
- Panel title shows "Claude Profiles" once instead of "Claude Profiles: Profiles"

## 0.1.0

First release.

- Sidebar panel with account cards: email, plan, login status
- Switch accounts from the panel or the status bar; the choice persists across restarts
- Add, log in to and delete profiles (delete logs out first and uses the system trash)
- Export and import profiles, with logins optional
- Chat history, settings, plugins, skills, agents and hooks shared across profiles
