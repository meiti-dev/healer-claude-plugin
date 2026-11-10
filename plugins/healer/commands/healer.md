---
description: Send this project to Healer for independent verification and repair (tests in an isolated sandbox, never makes it worse)
argument-hint: "[free|pro] [test ids...]"
---

Run Healer on the current project.

1. Call `healer_preparar_envio` with `proyecto` set to the name of the current folder. If the user passed `pro` in "$ARGUMENTS", use `nivel: "pro"`; otherwise `free`. Any other words in "$ARGUMENTS" that look like test ids (for example `tests/test_api.py::test_login` or `test/router.js`) go in `tests`.
2. Run the upload command it returns, in the project folder: the git version if the folder is a git repository, the other one if not. Tell the user what the command does (it packs the project and uploads it to Healer; secret files, binaries and ignored files are dropped on arrival). Its output has the job id.
3. Tell the user the job was sent and that Healer usually takes a few minutes.
4. Call `healer_resultado` with the job id. While it says the job is still queued or running, call it again. Do not change the project in the meantime.
5. When it finishes, give the user a short summary in plain words: the result, failures found and fixed, anything that remains, security findings, and the files Healer proposes to change. Show the diff.
6. Ask the user whether to apply the changes. Only if they say yes, run the numbered apply steps from `healer_resultado` in the project folder, one at a time, and stop if one fails (`git apply --check` refuses if a file changed since it was sent). Never apply without an explicit yes.
7. If Healer could not fix everything, explain what remains and offer to look into it together.

If there is no terminal (for example on claude.ai), ask the user for the GitHub repository and use `healer_revisar_repo` instead of steps 1 and 2; to apply, use `healer_aplicar_en_github` after the user says yes.

If a tool says the API key is missing or invalid, tell the user to run `npx @meiti/healer` in a terminal (it shows a short code to confirm in the browser), or to paste a key from meiti.dev/healer in `/plugin` > healer > Configure, and then restart Claude Code. Do not ask for or handle the key yourself.
