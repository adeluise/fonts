# fonts-skill

**Moved to [adeluise/skills](https://github.com/adeluise/skills).** This is now read-only.

An opinionated Claude Code skill for picking and setting up typefaces. Surfaces a curated font list, asks about your project context with interactive prompts, and handles the full setup — imports, CSS custom properties, framework config.

## Install

Clone directly into your Claude Code skills directory:

```sh
mkdir -p ~/.claude/skills
git clone https://github.com/adeluise/fonts-skill.git ~/.claude/skills/fonts
```

Or, if you already have it cloned elsewhere, symlink it:

```sh
mkdir -p ~/.claude/skills
ln -s /path/to/fonts-skill ~/.claude/skills/fonts
```

## Usage

Invoke the skill directly:

```
/fonts
```

You'll get prompts to select:

1. **Project type** — marketing site, SaaS app, editorial/blog, portfolio
2. **Vibe** — clean/minimal, bold/expressive, editorial/serious, friendly/warm
3. **Role** — full pairing, headings only, body only

Pick from the chips or choose "Other" to type your own answer.

The skill filters down to 2–4 font recommendations presented as selectable options. Once you pick, it detects your stack and sets everything up automatically — no confirmation step.

For **SaaS apps**, the skill will also recommend a monospace font for code blocks, data tables, and technical UI after you've chosen your main pairing.

You can also trigger it naturally in conversation:

```
I need a font pairing for a marketing landing page
```

## What's in the list

13 hand-picked typefaces:

| Font | Classification | Source | Tags |
|------|---------------|--------|------|
| Apfel Grotezk | Sans | Collletttivo | heading |
| Bricolage Grotesque | Sans | Google Fonts | heading |
| Epilogue | Sans | Google Fonts | heading |
| Geist | Sans | Google Fonts | heading, body |
| Geist Mono | Mono | Google Fonts | code |
| Necto Mono | Mono | Uncut | code |
| Newsreader | Serif | Google Fonts | heading, body |
| Nyght Serif | Serif | Uncut | heading |
| Ortica | Serif | Uncut | heading |
| Satoshi | Sans | Fontshare | heading, body |
| Spectral | Serif | Google Fonts | heading, body |
| Uncut Sans | Sans | Uncut | body |
| Zodiak | Serif | Fontshare | heading, body |

## Customizing

Edit `fonts.md` to add, remove, or reorder fonts. The skill reads this file every time it's invoked — no restart needed. Follow the existing table format and tag fonts with `heading`, `body`, `code`, or a combination.
