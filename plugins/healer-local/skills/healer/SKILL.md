---
name: healer
description: Suggest independent verification with Healer when the user is about to merge or ship, after large changes, or when tests fail and the cause is not obvious. Healer runs the project's tests in an isolated sandbox, repairs what fails and only returns changes that leave the project better, never worse.
---

# When to suggest Healer

Healer is a second, independent check: it does not trust that the code works, it runs it. Suggest it (do not run it on your own) when:

- The user is about to merge, open a pull request or deploy, and wants a check that does not depend on the model that wrote the code.
- A change touched many files, or a dependency or runtime was upgraded.
- Tests fail and the cause is not clear after a first look.
- The user asks for a security or quality review: Healer also runs a security audit and a quality score.

Do not suggest it for one-line edits, questions about the code, or projects without anything runnable.

# How to use it

Offer the `/healer` command, or call the tools directly:

1. `healer_revisar` sends the project (the files git would send; binaries, files over 1 MB and secret files such as `.env` are skipped). Leave `nivel` out unless the user named a level: the organization rule applies (pro unless the owner changed it). If a job would run on free (the user asked for free, or the pro repairs of the plan are used up) and the organization asks for confirmation, Healer answers that it needs the user's yes and queues nothing: tell the user what free means (free AI providers may keep what they receive, and the code may be used for training) and send it again with `confirmar_free: true` only if they agree. When the pro repairs are used up, `solo_revisar: true` runs the checks without repairing and without AI. Never set `confirmar_free` on your own. When the user describes a bug in words (what they did, what they expected, what happened), pass it as `bug`: Healer first writes a test that reproduces it and only repairs if that test fails with the current code. If the result says the bug was reproduced, offer the user to add that test to the project.

`healer_info` says the server version, every tool with a fingerprint, the organization rule for the AI level and the pro repairs left. Call it when a tool you expect is missing or behaves differently than described, or before a repair if you need to know whether free would need the user's yes.
2. `healer_resultado` checks the job; call it again while it is running.
3. Show the summary, what each file fixes and the diff. Check each change against the rest of the project before recommending it. `healer_aplicar` writes the changes only after the user says yes (pass `archivos` to write only the approved files), and refuses any file the user edited after sending. If the result says "NEEDS THE USER'S ACCEPTANCE", tell the user first: Healer added a dependency so the tests could run and it lowers the quality score. Pass `acepto_puntaje_menor: true` only if they accept it; otherwise leave that file out of `archivos`.

# Quick local check and the commit hook

`healer_check` runs Healer rules on the project locally, in seconds: nothing leaves the computer and no AI is used. Use it before committing, or when the user asks for a quick check; pass `archivos` to see only what touches those files. Each finding names its rule; if something is on purpose, the user can say so next to the code with `// healer-ignore: <rule> <reason>`. `completo: true` sends a full review without AI (Pentagon, Semgrep, tests) only when the user asks; Healer skips it if it already watches the repo.

`healer_hook` turns the check before every commit on or off (`accion: on | off | status`), only when the user asks. It warns and never blocks unless `bloquear: true`. `completo: true` also sends a full review without AI after each commit, except when Healer already watches the repo, so there are never two runs of the same change.

# Screen review (no repair)

To prove that a UI change really shows up, without running the full review, use `healer_revisar_pantalla`: Healer starts the app in its sandbox, opens each page and answers YES / NO / CANNOT PROVE for what you expect. You set the expectations from what you know about the code; give each page an `expect_page` (its title or something only that page has). You do not need to ask the user how the app starts: leave out `start_command` and `port` and Healer finds them (`.healer.json` "screen", the command that worked last time, or package.json / the Python entry file) and reports where they came from and whether the app answered. Send them only if the user told you, or if a review says the command Healer chose did not start. It uses no AI and changes nothing. CANNOT PROVE means the page did not load or is not the expected one: say so, never "it is not there".

Healer's guarantee: what comes back is repaired or equal, never worse. What it could not fix is reported, not hidden.
