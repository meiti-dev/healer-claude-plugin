---
name: render
description: Use the render tools to verify what a web screen really shows after changing UI code, before saying a visual change works, or when the user reports something on screen you cannot see. A map of the screen (role, name, text, state, position) instead of a screenshot, actions by intent, and proof of what changed.
---

# When to use render

You usually change UI code without seeing the result. Render lets you check it, fast and as text:

- After changing something the user will see (a button, a form, a menu, a permission that shows or hides something), open the page and prove the change is there and works.
- When the user says "I don't see X" or "the button does nothing": open the page as that user would see it and read the map.
- Before and after a change that could break a screen: `render_compare` says WORSE, BETTER or SAME.

Do not use it for backend-only changes, for pages you cannot reach from this machine, or as a replacement for the project's own tests.

# How to use it well

1. `render_open` returns the map and visual issues it measured (overflow, cut text, covered elements, small touch targets, low contrast, broken images, unnamed buttons), plus the requests that failed while loading.
2. Signed-in pages: pass the session the way the app keeps it (`storage` for localStorage keys, `cookies`, or `headers`), using test accounts. Never type real passwords into a page. Each session runs in its own browser context, so sessions do not leak into each other.
3. Elements that appear after a request (role checks, data loaded late): pass `wait_for` instead of guessing a delay.
4. `render_act` does one action by intent and tells you what appeared, disappeared, changed or moved, and the requests it sent. "Nothing changed" is a finding.
5. `render_expect` gives yes or no with the exact proof. Open with `expect_page` (something only that page has, like its title or the app name: not a control every page shares) so a landing page, a login or an error screen is reported as such. On a page that did not load or is not the expected one, negative checks answer CANNOT PROVE: never report that as "it is not there".
6. An unnamed button in the map is a real accessibility bug (a screen reader cannot announce it): report it.

Render is a MEITI tool, verified by Healer with exams that have known answers on every version.
