---
name: fonts
description: "Preview fonts live on the user's own running dev server, then write the ones they choose into their code. Use when the user mentions fonts, typefaces or typography, asks what font to use, says a font looks generic, or wants to restyle a project's font."
dependencies: node>=18
allowed-tools: Bash(node *), Bash(curl *), Read, Write, Edit, Glob, Grep
---

# Fonts

A curated list of 19 Google fonts, a browser picker that applies them to the
user's actual running app, and the setup code that makes the choice permanent.

The user picks in the browser. You write the code. Nothing else writes files.

## Running the picker

1. **Launch it from the project root, in the background:**

   ```
   FONTS_SKILL=1 node <this skill's directory>/scripts/preview.mjs
   ```

   It starts the project's dev script, proxies it, and serves the picker on top,
   then prints `Font picker → http://localhost:PORT/__fonts/` to stderr. Take the
   port from that line — it moves if 7373 is taken. `FONTS_SKILL=1` is what tells
   the picker someone is listening, so its button reads "Apply to code" rather
   than "Save selection".

2. **Give the user the URL and stop.** One line: open this, pick fonts, hit
   Apply. Don't narrate what the script is doing — they'll be gone for minutes.

3. **Wait for them, in the background:**

   ```
   curl -s --max-time 300 http://localhost:PORT/__fonts/wait
   ```

   That request hangs until something happens, then returns one of three events.
   `apply` carries the selection. `done` means the session is over — closing the
   tab ends it, a reload doesn't. If they tell you in chat that they're finished,
   end it yourself with `curl -s -X POST http://localhost:PORT/__fonts/done`.
   `idle` is a heartbeat every 90 seconds so the request never dies of old age —
   on `idle`, just issue it again. Keep re-issuing until you get `done`.

4. **On `apply`,** read `.fonts-selection.json` and write the setup. Then report
   back, since the button reads "Code updated" only once this arrives:

   ```
   curl -s -X POST http://localhost:PORT/__fonts/status \
     -H 'content-type: application/json' -d '{"state":"done"}'
   ```

   If you couldn't write it, post `{"state":"failed","message":"<one line>"}`
   instead. Then wait again — applying is a step in the loop, not the end of it.
   They can keep changing fonts, and each round reloads through HMR showing the
   fonts coming from their real code rather than the preview.

5. **On `done`,** delete `.fonts-selection.json`. The picker and the dev server
   have already shut themselves down.

With no dev server the picker still runs — it serves a type specimen in place of
the app, so fonts can be chosen before a project exists.

## The selection file

```json
{
  "header": { "name": "Archivo", "stroke": "SANS_SERIF", "class": "neo-grotesque", "variable": true,
              "wght": [100, 900], "weights": null, "wdth": [62, 125],
              "weight": 600, "width": 112.5,
              "css": "https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&display=swap",
              "stack": "\"Archivo\", system-ui, \"Helvetica Neue\", sans-serif" },
  "text":   { "name": "Geist", ..., "wdth": null, "weight": null, "width": null, ... },
  "mono":   { "name": "Geist Mono", ... },
  "lineHeight": { "text": 1.5 },
  "pins": { "header": { "weight": 400 } }
}
```

`stack` is the finished `font-family` value — use it verbatim rather than
rebuilding it. `lineHeight.text` is already resolved from the text font's stroke.

**Every role is optional.** Fonts start unset, so `header`, `text` and `mono`
each appear only if the user picked one. `lineHeight.text` is there only when
`text` is.

`wght` and `wdth` are the font's variable axis ranges, `weights` its static
instances. `weight` and `width` are the user's overrides — a `font-weight`, and
a `font-stretch` percentage from the ladder 50 / 62.5 / 75 / 87.5 / 100 / 112.5 /
125 / 150 / 200 — and they are `null` when the user left that axis alone. **Null
means write nothing for that axis**, and don't mention it. The picker previews
only what Apply writes, and Apply writes only what the user touched.

`pins` is the exception, and it's there only when one is needed: a role the user
left alone whose weight or width another role's override would have moved
through inheritance, and the value it renders at today. Keyed by role, same
`weight` and `width` names, absent when nothing needs holding.

## Writing the setup

**Write the roles the selection carries and nothing else.** A role that isn't in
the file is one the user never touched: leave its import, its variable and its
rules exactly as the project already has them. Don't delete them, don't rewrite
them, don't leave a `--font-mono` pointing at nothing.

One fork only: **does this project depend on `next`?** Check `package.json`.

App Router vs Pages Router, Tailwind v3 vs v4 vs none, where the global
stylesheet lives — read the project. Those change which file you edit, not what
you write.

### Next.js — `next/font/google`

Self-hosts at build time, so no runtime request to Google and no layout shift.

```tsx
import { Archivo, Geist, Geist_Mono } from 'next/font/google'

const header = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--font-header' })
const text = Geist({ subsets: ['latin'], variable: '--font-text' })
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' })

// on <html>:
className={`${header.variable} ${text.variable} ${mono.variable}`}
```

**A font with a `wdth` range needs `axes: ['wdth']`.** Without it `next/font`
self-hosts the weight axis alone and any `font-stretch` you write silently does
nothing. A static face takes its `weights` instead — `Gloock({ subsets:
['latin'], weight: '400', variable: '--font-header' })`.

Import names are family names with underscores: `Geist_Mono`, `EB_Garamond`,
`Libre_Franklin`. Only import, declare and class-name the roles you're writing.

### Everything else — stylesheet link

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="<the css url from the selection>">
```

Merge the selection's `css` URLs — one, two or three of them — into a single
request: join the `family=` parameters with `&`, keep one `&display=swap` at the
end. Each URL already
carries every axis the font needs, `wdth` included, in the order Google wants;
don't append anything.

### Both paths

```css
html { -webkit-text-size-adjust: 100%; }

body { font-family: var(--font-text), <fallback tail>; line-height: <lineHeight.text>; }
h1, h2, h3, h4, h5, h6 { font-family: var(--font-header), <fallback tail>; }
code, pre, kbd, samp { font-family: var(--font-mono), <mono fallback tail>; }
```

One line per role in the selection, none for a role that isn't there.

When a role has a non-null `weight`, add `font-weight: N` to that same selector,
and `font-stretch: N%` when `width` is non-null. One base declaration per role,
no `!important`, nothing at all for a null.

```css
h1, h2, h3, h4, h5, h6 { font-weight: 600; font-stretch: 112.5%; }
body { font-weight: 400; }
code, pre, kbd, samp { font-weight: 500; }
```

**Then write `pins`, one base declaration per entry, on that role's selectors.**
Same shape, plus a comment saying what it's for. A `font-weight` on `body` reaches
headings and code on any page whose reset hands them down — Tailwind's preflight
sets `font-weight: inherit` on `h1`–`h6` — so the pin holds the roles the user
never touched at the weight they already had.

```css
/* pinned: keeps headings at their current weight */
h1, h2, h3, h4, h5, h6 { font-weight: 400; }
```

In a Tailwind or shadcn project these are often inert — a `font-bold` on the
heading is a utility class and outranks an element selector. Don't fight it with
`!important`. Tell the user in one line that the weights set per element in their
components still win, and offer to repoint those utility classes if they want the
override to reach them.

**Only define `:root { --font-header: … }` yourself on the stylesheet path.** On
Next, `next/font` sets those variables through the class names you put on
`<html>`, and redefining them in CSS overrides the generated family with a name
the browser can't resolve. The fallback tail is `stack` with the leading quoted
family name removed.

With Tailwind, point the theme at the variables so the utilities work — v4 in an
`@theme` block, v3 under `theme.extend.fontFamily` as arrays like
`['var(--font-header)', 'system-ui', 'sans-serif']`. One key per role you wrote —
no `mono` key if there's no mono in the selection. **Reuse the project's
existing key names.** If it already has `font-heading` and `font-body` wired
through its components, repoint those rather than adding `font-header` and
`font-text` beside them — otherwise the old utilities keep pointing at the old
fonts and the page ends up running two type systems at once.

## Rules

1. **Variable axes get a range, never a list.** `wght@100..900` is one file;
   `wght@400;700` is two static instances and usually more bytes. `wdth` works
   the same way, and a two-axis URL names both in alphabetical order —
   `wdth,wght@62..125,100..900`. Check `"variable"` in the selection — 17 of the
   19 are.

2. **Omit `weight` in `next/font` for variable fonts.** Passing explicit weights
   forces static instances instead of the variable file. Only Gloock (400) and
   DM Mono (400, 500) take a weight list, from the selection's `weights`. That's
   the loader's `weight` option — the selection's `weight` is unrelated, and is
   always a CSS declaration, never an argument here.

3. **Use `stack` verbatim.** Fallbacks are chosen per stroke — `system-ui` for
   sans, `Charter` for serif, `ui-monospace` for mono — and a mismatched fallback
   shifts the layout while the webfont loads.

4. **Set `-webkit-text-size-adjust: 100%`.** One line, and without it iOS resizes
   text on rotation. The bug is invisible until someone turns their phone.

5. **Serif body copy takes 1.7 line-height, sans takes 1.5.** Already resolved
   in `lineHeight.text`.

6. **Read the project's real sizes and weights before writing.** If a role's
   font has a `floor` and the project sets it smaller, or the font is static and
   the project asks for a weight it doesn't ship, say so in one line first. Write
   `font-synthesis: none` for static faces so the browser doesn't fake the bold.

## Answering without the picker

`fonts.json` carries `note`, `caution`, `class`, `floor` and `avoid_with` for
every font. Read it and answer directly when someone asks what a face is like or
what pairs with what. Two fonts sharing a `class` shouldn't be paired;
`avoid_with` holds the explicit exceptions; `floor` is the size below which a
face stops working.

## Don'ts

- Don't add fonts that aren't in `fonts.json`. The list is the opinion — if
  someone asks for one that isn't on it, say so rather than wiring it up.
- Don't launch the picker to answer a question. Starting a dev server to say
  what Lora looks like is absurd; read `fonts.json`.
- Don't write files before the user has applied a selection. The preview is
  theirs to change until they commit to it.
- Don't leave `.fonts-selection.json` behind once the session ends.
- Don't pick for them. If they ask you to choose, offer two or three from
  `fonts.json` with reasons and let them decide.
