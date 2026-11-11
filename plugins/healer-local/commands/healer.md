---
description: Send this project to Healer for independent verification and repair (tests in an isolated sandbox, never makes it worse)
argument-hint: "[free|pro] [test ids...]"
---

Run Healer on the current project.

1. Call `healer_revisar` with the current working directory. If the user passed `pro` in "$ARGUMENTS", use `nivel: "pro"`; otherwise `free`. Any other words in "$ARGUMENTS" that look like test ids (for example `tests/test_api.py::test_login` or `test/router.js`) go in `tests`.
2. Tell the user the job was sent and that Healer usually takes a few minutes.
3. Call `healer_resultado` with the job id. While it says the job is still queued or running, call it again. Do not do anything else to the project in the meantime.
4. When it finishes, give the user a short summary in plain words: the result, failures found and fixed, anything that remains, security findings, and the files Healer proposes to change, with what each one fixes. Show the diff for each file. Before recommending a file, check its change against the rest of the project (for example, that a field or function it uses really exists, and how the server handles what it sends); say plainly if you would leave one out and why.
5. Ask the user which changes to apply: all, some, or none. Only if they say yes, call `healer_aplicar`, passing `archivos` with only the approved files when they chose some (it tells Healer what was applied). If they apply none, call `healer_informar_decision` with the files left out. Never apply without an explicit yes.
6. If Healer could not fix everything, explain what remains and offer to look into it together.

If the tool says Healer is not connected, tell the user to run `npx @meiti/healer` in a terminal (it shows a short code to confirm in the browser), then restart Claude Code and try again. Do not ask for or handle the key yourself.
