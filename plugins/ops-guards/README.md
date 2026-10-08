# ops-guards

One Claude Code plugin with three mods (job_1e4b82452fe0). Tested with Claude Code 2.1.293. Mods are on by default from 2.1.287, so this plugin needs nothing beyond being loaded.

| Mod | What it does |
| --- | --- |
| Heavy-work lock | An install or build (`npm ci`, `npm install`, `npm run build`, `pnpm install`, `yarn build`, `npx playwright install`, `npx vite build`) takes `~/.capsid/overnight-heavy.lock` first, the same file and JSON the nightly scheduler uses, so tabs and the scheduler queue behind each other. A tab that finds it held says who holds it and waits up to 27 minutes, then refuses the command. Full test suites are not heavy here: they run in CI. |
| Key redaction | Secrets in any tool result are replaced with `[REDACTED:<kind>]` before Claude reads them: Capsid operator and agent keys (`capsid_` or `capsid_agent_` plus 64 hex, read from capsid's key generation), `Bearer` tokens, Cloudflare `cfut_` tokens, GitHub tokens, Anthropic keys, named variables such as `CLOUDFLARE_API_TOKEN=`, and private key blocks. Reads of `~/.capsid/*.key` and `.mcp.json` are refused outright (a `Test-Path` or `ls` on them is allowed). |
| Command guard | Refuses `git push` with `--force`, `-f`, `--force-with-lease` or a `+refspec`; `git clean` with `-x` or `-X`; and `rm -r`, `rmdir /s`, `Remove-Item -Recurse` or `git worktree remove` on a tree that holds a `node_modules` junction. Each refusal says the safe alternative. |

The guards read the text of a command, so they are a reminder with teeth, not a wall. `bash -c "..."` and `cmd /c ...` are unwrapped one level. An alias, a script file or a variable is not seen.

## Run it

```
claude --plugin-dir plugins/ops-guards
```

`/plugin` shows `1 mod active` once it loaded. There is no marketplace for this plugin yet, so for every session set `CLAUDE_CODE_PLUGIN_DIRS` to this folder's absolute path (docs: reference, "Settings and environment variables"). Installing it from a marketplace would be a separate change.

## Turn it off

- One guard: set `heavyLock`, `redaction` or `destructiveGuard` to false (all three default to true) in the plugin's options. The docs say a plugin loaded with `--plugin-dir` keeps its values under `pluginConfigs` as `ops-guards@inline`; `/plugin configure` opens the same dialog for an installed plugin. I have not exercised the switches in a live session, only through `claude plugin test`, which passes no options.
- The whole plugin: disable it on the Installed tab of `/plugin`.
- Every mod, one session: `claude --safe-mode`.
- Every mod, every session: `"disableAllHooks": true` in `~/.claude/settings.json` (this also stops settings hooks and the status line).

The guards fail closed. If a guard throws or times out, the call is refused with a message saying so, rather than run unchecked. If a broken guard blocks you, use one of the switches above.

## Tests

- `test/ops-guards-*.test.mjs` in the repo root: the patterns, the command parser and the lock, under `node --test`. CI runs these (`npm test`).
- `tests/ops-guards.test.ts` here: the wiring in `hooks/register.js`, run with `claude plugin test` from this folder. CI does not install Claude Code, so this is run locally.
- `claude plugin validate .` lists the hooks and calls the plugin makes.

## Files

```
.claude-plugin/plugin.json   manifest and the three switches
hooks/hooks.json             points at register.js
hooks/register.js            the wiring; every $ call lives here
hooks/lock.mjs               the lock as a command (a hooks module cannot make an exclusive create)
hooks/lib/redact.mjs         secret patterns and key-file paths
hooks/lib/guard.mjs          command parsing for the guard
hooks/lib/heavy.mjs          which commands are heavy
```
