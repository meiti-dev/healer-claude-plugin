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

Offer the `/healer` command, or use the tools directly:

1. `healer_preparar_envio` returns a one-time upload link and the command to upload the project from its folder (tar + curl). Run it in the project folder; it prints the job id. Without a terminal, use `healer_revisar_repo` with a GitHub repository instead.
2. `healer_resultado` checks the job; call it again while it is running.
3. Show the summary and the diff. Apply only after the user says yes: run the numbered `git apply` steps from the result (it refuses any file that changed since it was sent), or `healer_aplicar_en_github` for a repository.

Use `nivel: "free"` unless the user chose pro. On the free level, free AI providers may keep what they receive and the repaired code may be used for training; for private code, use pro.

Healer's guarantee: what comes back is repaired or equal, never worse. What it could not fix is reported, not hidden.
