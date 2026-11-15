---
description: Check a screen in a real browser like an agent: a map of what is there, actions by intent and proof of what changed (no screenshots)
argument-hint: "<url> [what to check]"
---

Check the screen at the URL in "$ARGUMENTS" with the render tools. The rest of "$ARGUMENTS", if any, says what the user wants checked.

1. Call `render_open` with the URL (width 375 if the user mentions a phone, otherwise 1280). If the page needs a signed-in user, ask the user how their app keeps the session (for example a localStorage key or a cookie) and pass it in `storage` or `cookies`; never type a real password into the page. If something appears only after a request (a button that depends on the user's role), pass it in `wait_for`.
   Pass `expect_page` with something that identifies the page you meant to open (its title, part of the URL, or an element only that page has). The browser knows whether a page loaded, not whether it is the right one.
2. Read the page state first (LOADED, DID NOT LOAD, NOT THE EXPECTED PAGE): if it did not load or is not the expected page, say so and stop; nothing on it proves anything. Then read the map: say what is on the screen, the visual issues it reports and any request that failed while loading.
3. If the user asked for a flow, do it one step at a time with `render_act` (click, fill, select, check, key, goto by label or visible text) and read what changed after each step. "Nothing changed" means the control did nothing: report it.
4. Prove what matters with `render_expect` (exists, not_exists, appeared, request with its status, no_errors). A "not_exists" only proves something if the page loaded: also expect something that must be there. Use `no_errors` with `ignore` for errors that are not the app's own (a blocked analytics script).
5. To compare two versions of the same app (before and after a change), use `render_compare`.
6. Close the session with `render_close` and give the user a short report: what works, what does not (with the proof from the map), and the visual issues worth fixing.
