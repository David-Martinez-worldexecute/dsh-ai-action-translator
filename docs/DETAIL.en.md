# AI Action Translator · Details

A study aid for DeepSeek Harness that explains what the agent is doing while it does it — and teaches you how an agent actually runs along the way. Written for beginners and students: plain language first, exact terminology second.

---

## The problems it solves

Two questions come up constantly when someone watches an agent work:

> "What is it actually doing? Why this step? What does this error mean?"

> "It already started — can I still change direction?"

This plugin does not change what the AI does. It adds a human-readable layer before and after each action, and it marks the points where you can safely interrupt. The goal is that you can always answer three things: **which tool ran, what it touched, and which layer of the project it sits in.**

---

## What it does

| Capability | What you get |
| --- | --- |
| **Action translation** | Each tool call is explained in plain language: what it did, why, and what the result means. |
| **Step-by-step parse** | `stepParse` (on by default): breaks the action into numbered steps, each naming the tool, the file, and the project layer. It splits only what matters — no redundant recap. |
| **Graduated depth** | `knowledgeLevel` has four levels: `plain` (one sentence), `guided` (plain language plus one term), `balanced` (input → processing → output), `deep` (adds implementation and code-structure detail). |
| **Project map** | A fixed six-layer map — entry point → configuration and dependencies → core modules → tools and service boundaries → output and interface → tests and verification. Every explanation says which layer it happens in, and unknown parts are marked `to be confirmed`. |
| **Stage summary** | At the end of a verifiable small step: what was finished, where it sits on the map, what is still unknown, and what to observe or practice next. |
| **Mid-way intervention** | It tells you where you can interrupt and what changing direction costs at that moment — "nothing written yet, changing your mind is free" versus "already written, changing your mind needs a rollback". |
| **Persona and tone** | `persona` (up to 600 characters) controls how it addresses you. Tone only affects wording — never commands, code, tool choice, or safety boundaries. |
| **Action timeline** | `timeline` (on by default): every tool call of the session is kept as a read-only list with category, duration, and success/failure. It lives **in the panel only and is never injected into the prompt**, so reviewing history costs no context. |
| **Term cards** | `glossary` (on by default): words like `waterfall`, `peerDependency`, `HMR`, `EPERM` get one sentence the first time they appear — explained once, not repeated. For terms outside the table it is told to explain from observable behavior, not to invent a definition. |
| **Failure book** | `failureBook` (on by default): errors are filed by layer (auth / permission / path / dependency / network / service / syntax / test). The same class is stored once and its hit count accumulates, so the next time you hit something similar you can check which layer it was and how it was fixed. |
| **Config presets** | Three presets — complete beginner, has some basics, deep diver. You do not have to tune all 20 fields by hand. |
| **Export / import** | Save your configuration as JSON and move it between machines. |
| **Runtime stats** | Observed actions, sensitive hits, previews, saves, uptime, and a ring buffer of the last 20 warnings and errors. |
| **Pre-flight guard** | `guardMode`: before an action runs, it checks for high-risk shapes (recursive delete / power commands / permission changes / credential reads / destructive git / writes into system directories / dependency installs / service stops / outbound connections). `warn` only flags; `deny` actually blocks. It reads arguments and never rewrites them; with `off` it does not even subscribe. |
| **Agent roster** | Every timeline row says *which* agent did it; the panel shows how many agents took part and how many are still live. System-level calls with no agent context are left blank rather than guessed as "the main agent". |
| **Sidebar pane** | A right-sidebar tab — timeline, failure book, and term cards always one click away. Read-only review, still never injected into the prompt. |
| **Learning drills** | `drill`: after `drillEvery` real actions it hands out one recall exercise (what you saw / the technical point / what to practise next), quoting only actions that actually ran, and never twice for the same batch. |
| **Assembly note** | Panel switches are runtime state while the static prompt section is baked at startup; each turn it computes a short "what is active, what is switched off, do not present the off ones as working" note. |

---

## What it does not do

- **It does not register tools.** It adds no capability to the agent.
- **It does not intercept, veto, or rewrite anything.** It only subscribes to `tools/result`, which is a plain broadcast. It deliberately does not use the `tools/pre-execute`, `tools/execute`, or `tools/post-execute` waterfalls.
- **It does not use the network.** Zero network code.
- **It does not read or write your project files.** Its only write target is `~/.dsh/ai-action-translator/` (settings and the failure book).
- **It does not execute actions for you.**
- **It does not claim to know hidden reasoning.** It only explains observable actions and the evidence they leave. It never fabricates a chain of thought.
- **It does not make decisions for you.** It explains trade-offs; the choice stays yours.

---

## How to use it

The main entry point is the **section it registers in the DSH settings page**: change the switches, save, and the next turn uses the new settings. No restart is needed for configuration changes.

There is also an independent full page, reachable from the "open full page" button in that section.

> ⚠️ Do not type `/api/ai-action-translator/` into the address bar yourself. The DSH kernel locks `/api*` routes behind the launch token and a signed session cookie, so a hand-typed URL returns `401 dsh web authentication required`. Use the entry inside the settings page.

The panel reads a read-only `GET /activity` endpoint for the timeline, failure book, and glossary. It is the same origin-gated route as everything else.

---

## Scope

This plugin is **DSH-only**. It depends on:

- `systemPrompt.section()` and `systemPrompt.context()` to inject the policy and the recent-action digest,
- the `settings.section` UI slot for the configuration panel,
- `~/.dsh/` as its data directory.

On a different host or a lower DSH version, behavior is not guaranteed. The supported range is declared in `package.json` as `dsh.engines.dsh` (`>=0.2.2-rc.3`).

---

## Security boundaries

- **Loopback plus same-origin only.** The panel only answers `127.0.0.1`, `[::1]`, and `localhost`, and it checks the `Origin`/`Referer` for same-origin requests.
- **64 KB body limit.** Oversized bodies get `413`; malformed JSON and unknown fields get `400`. `enabled` and `order` can only be set in YAML, never over HTTP.
- **Secret shapes are intercepted.** Arguments whose keys look like `password`, `secret`, `token`, `api_key`, `credential`, `authorization`, `cookie`, or `session_id` are replaced with `***` before anything is recorded.
- **Zero network, zero runtime dependencies.** The package has no runtime dependency; the only dev dependency is the schema library.
- **Clean lifecycle.** Everything is registered through `ctx.effect` or a disposer, so uninstalling leaves nothing behind.

---

## Verification

```bash
npm ci
npm run verify   # syntax check + tests + privacy scan
```

Eight test groups (152 tests total): plugin contract, server modules and documentation regressions, the browser half, the activity layer (classifier, failure layers, timeline, failure book, glossary, `/activity` route), the pre-flight guard (10 rules, three modes, allow channels, quiet exception), the agent roster, the learning drills, and the multi-host adapters (all three `settings.json` files must be pure JSON; the hook scripts are actually fed stdin; each host's reply envelope has the right shape; the `PostToolUse` entry really appends to `.aiact/timeline.jsonl` while `audit` off writes nothing; tokens and Bearer values never land on disk verbatim; `mode: 'off'`, a broken policy, and malformed stdin all fail open; `_core/` must not mention a host by name; the generator is idempotent). There is also a fake-host load smoke test (`node scripts/load-smoke.mjs`) that runs `apply()` end to end — it exercises the guard allow path, roster registration, drill card emission, and both prompt contexts. It proves the wiring, not that the plugin is installed into a real DSH.
