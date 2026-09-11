---
name: foxing
description: Project-specific conventions for the Foxing monorepo (apps/web Next.js + apps/mobile Expo). Encodes journal import boundaries, the Card variant system, font/token names, storage rules, Supabase access patterns, and platform-specific icon/styling rules. Load when working in apps/web or apps/mobile, when writing TSX with design tokens, when touching journal admin or public routes, when migrating the DB, or when uploading cover assets.
---

# foxing

Project-specific conventions for the Foxing codebase. Loads on demand; not a replacement for CLAUDE.md.

Repo root: `C:\Users\email\Documents\foxing`
Supabase project ref: `ekjpsuewrkvqzbuteurc`

---

## 1. journal-shared.ts import boundary

`lib/journal.ts` is marked `server-only`. Importing it from a client component pulls the server-only marker into the browser bundle and breaks the build.

- Client components (anything with `'use client'`, the admin editor, any interactive journal UI): import from `@/lib/journal-shared`.
- Server components, route handlers, server actions: either path works. Prefer `@/lib/journal` for query helpers; it re-exports the shared types and pure formatters from `journal-shared`.

Lives in `journal-shared.ts`:
- `JOURNAL_TAGS`
- `JournalPost`, `JournalPostSummary`, `JournalPostFull` types
- `estimateReadingTime`, `readingMinutes`, `formatLongDate`

Anything that touches `createAdminClient()` or the database stays in `journal.ts`.

---

## 2. Card variant system

`components/ui/card.tsx` exports the only two card hover patterns Foxing uses. Do not invent new ones. Do not hand-roll card hover behavior.

- `variant="content"` (default): border-only hover. Container stays still; the `CardTitle` color shifts to `brand-text` via the parent `group` class. Use for text-first cards (journal posts, reading lists, articles).
  - Token path: `border-border-subtle` -> `hover:border-border-interactive`; title `text-text-primary` -> `group-hover:text-brand-text`.
- `variant="entity"`: shadow lift on hover. Border and title stay static. Use for object cards representing a person or group (people, reading clubs).
  - Token path: `shadow-sm` -> `hover:shadow-md`. Border stays `border-border-subtle`.

Exception: `BookCard` does not use this primitive. Its cover-image translate + scale hover is correct for that context and must not be migrated.

Sub-components: `CardLabel`, `CardTitle`, `CardBody`, `CardMeta`. All four bake in the correct font and color tokens; do not override the font family on these.

---

## 3. Design tokens (verified against apps/web/app/globals.css)

All colors and shadows are CSS custom properties driven by `[data-mode="light"]` and `[data-mode="dark"]`. Never hardcode hex outside `globals.css`. Use the Tailwind class names below (the Tailwind config maps each `--token` to a class).

Backgrounds: `bg-bg-base`, `bg-bg-surface`, `bg-bg-elevated`, `bg-bg-sunken`, `bg-bg-hover`, `bg-bg-selected`, `bg-bg-disabled`.

Text: `text-text-primary`, `text-text-secondary`, `text-text-tertiary`, `text-text-disabled`, `text-text-on-brand`, `text-text-on-amber`, `text-text-on-dark`.

Brand: `text-brand-text`, `bg-brand-ui`, `hover:text-brand-hover`, `bg-brand-secondary`, `bg-brand-subtle`, `text-brand-subtle-text`.

Borders: `border-border-subtle`, `border-border-default`, `border-border-interactive`, `border-border-strong`, `border-border-brand`, `border-border-focus`.

Status: `text-success`, `bg-success-bg`, `border-success-border` (and the `-interactive` variants). Same pattern for `warning`, `error`, `info`.

Shadows: `shadow-sm`, `shadow-md`, `shadow-lg`. They auto-swap in dark mode via globals.css.

---

## 4. Fonts

Four families, all loaded via `next/font` and exposed as CSS custom properties used inside Tailwind class names:

- `font-dm-sans` -- body UI text. Set on `body` as the default.
- `font-dm-mono` -- numbers, labels, metadata, the wordmark, monospaced UI.
- `font-fraunces` -- display + headings. Used by `CardTitle`, journal headings, hero copy.
- `font-source-serif-4` -- long-form body prose. Used by `CardBody`, `.prose-foxing`, `.journal-prose`.

Do not introduce a fifth font. Do not call DM Sans "Inter" or Fraunces "Serif" in comments or copy.

---

## 5. Storage: covers

Cover images go to the Cloudflare R2 bucket `foxing-covers` only. Never store a third-party image URL as `cover_url` -- always download and upload. Use `lib/r2.ts` `uploadToR2()` for new uploads.

(See the `covers` skill for full lookup order and stub-detection logic.)

R2 buckets in use:
- `foxing-covers` -- book + book club covers
- `foxing-epubs` -- reader files
- `foxing-avatars` -- user avatars
- `foxing-journal-images` -- inline journal images

---

## 6. Supabase access

- Admin / service-role: `createAdminClient()` from `lib/supabase/admin.ts`. Server only. Never expose to a client component. Required for `generateStaticParams` (cookies are not available during static generation).
- Cookies-based auth: `createServerClient()` for route handlers and server components that need the signed-in user.
- DB migrations: use the Supabase MCP `apply_migration` tool only. Never run raw DDL through `execute_sql`. Migration name + SQL only -- the MCP records the migration in the history.
- Project ref for CLI calls: `ekjpsuewrkvqzbuteurc`. CLI is always run from repo root, not from `apps/web/`:
  ```
  npx supabase functions deploy <name> --project-ref ekjpsuewrkvqzbuteurc
  npx supabase secrets set KEY=value --project-ref ekjpsuewrkvqzbuteurc
  ```

---

## 7. Tiers

Two tiers exist: `free` and `plus`. Do not reference any other tier name in code, copy, schema, or comments. The legacy `patron` value lives in the DB enum but is not a product surface -- treat as `plus` if encountered.

---

## 8. No em dashes

A PostToolUse hook scans for em dashes (U+2014) after every file edit. Use a hyphen `-`, an "and", a comma, or split the sentence. This applies to code, comments, copy, and commit messages. Before pushing, grep `apps/web/app` and `apps/web/components` for the U+2014 character across `*.tsx` / `*.ts`; the search must return 0 matches.

---

## 9. No icon libraries on web

Web (`apps/web/`) uses inline SVG only. Do not add `lucide-react`, `@heroicons/react`, `react-icons`, `@phosphor-icons/react`, or any other icon package. Copy the SVG path directly into the component and style with Tailwind.

Mobile (`apps/mobile/`) uses `phosphor-react-native` exclusively. Note: `@phosphor-icons/react-native` does not exist on npm -- if you see that import, it is wrong.

---

## 10. No emoji in UI

No emoji in UI, copy, badges, error messages, tooltips, or code. The fox emoji in the nav, footer, auth screens, and admin chrome is the only sanctioned exception. This applies to admin pages too.

---

## 11. Mobile styling

`apps/mobile/` uses NativeWind for styling (Tailwind class names on RN components). When `tailwind.config.js` or any NativeWind token changes, Metro must be restarted with `expo start --clear` or the new tokens will not be picked up.

Web tasks must not touch `apps/mobile/`. Mobile tasks must not touch `apps/web/`. One terminal per task.

---

## 12. URL + namespace traps

- Books: `/book/[slug]`, not `/book/[id]`.
- Authors: `/author/jane-austen`, not `/author/Jane%20Austen`.
- Clubs: `/clubs/[slug]`, not `/clubs/[uuid]`.

Three distinct book club surfaces -- never mix them:
- `/clubs` -- user-created reading clubs
- `/book-clubs` -- celebrity picks (Oprah, Reese, etc.)
- `/book-of-the-month` -- Foxing's own monthly pick

---

## 13. Pre-push check

From `apps/web/`:
```
npx tsc --noEmit
```
Must pass before every push. A Stop hook also runs this from repo root at session end.
