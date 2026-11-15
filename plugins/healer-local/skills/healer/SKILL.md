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

1. `healer_revisar` sends the project (the files git would send; binaries, files over 1 MB and secret files such as `.env` are skipped). Use `nivel: "free"` unless the user chose pro.
2. `healer_resultado` checks the job; call it again while it is running.
3. Show the summary, what each file fixes and the diff. Check each change against the rest of the project before recommending it. `healer_aplicar` writes the changes only after the user says yes (pass `archivos` to write only the approved files), and refuses any file the user edited after sending.

# Screen review (no repair)

To prove that a UI change really shows up, without running the full review, use `healer_revisar_pantalla`: Healer starts the app in its sandbox, opens each page and answers YES / NO / CANNOT PROVE for what you expect. You set the expectations from what you know about the code; give each page an `expect_page` (its title or something only that page has). You do not need to ask the user how the app starts: leave out `start_command` and `port` and Healer finds them (`.healer.json` "screen", the command that worked last time, or package.json / the Python entry file) and reports where they came from and whether the app answered. Send them only if the user told you, or if a review says the command Healer chose did not start. It uses no AI and changes nothing. CANNOT PROVE means the page did not load or is not the expected one: say so, never "it is not there".

Healer's guarantee: what comes back is repaired or equal, never worse. What it could not fix is reported, not hidden.
