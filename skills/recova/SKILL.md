---
name: recova
description: Project-specific conventions for the Recova codebase. Encodes design tokens, auth helpers, cron pattern, and field-name gotchas so sessions start with correct context. Triggers on session start when working in the recova repo, when writing TSX with design tokens, when writing crons, or when touching the admin/blog area.
trigger: "working in the Recova repo: design tokens, auth helpers, crons, or the admin and blog area"
namespaces: ["foxhound"]
version: 1.0.0
status: live
source: human
termination: "the change uses the repo's tokens, helpers, and field names, and its checks pass"
interface:
  inputs: "a Recova task and the files it touches"
  outputs: "code that matches the repo's conventions"
---

# Recova Project Skill

## Stack
- Next.js 16.2.4 App Router, React 19, TypeScript 5, Tailwind CSS v4
- Supabase (SSR client via `@supabase/ssr`, admin client via `lib/supabase/admin.ts`)
- Stripe (platform account + Connect), Resend, Anthropic Claude
- Vercel hosting, Sentry error tracking

## Critical conventions

### No em dashes
Never use em dashes anywhere, not in code, copy, or comments. Use a regular hyphen or rewrite the sentence. Recovery emails have a hard scrubber for AI-generated dashes; the rest of the codebase follows the same rule by convention.

### Field names (blog/admin)
- Blog post body field is named `body` not `content`
- Blog post published flag is `published` (boolean) not `is_published`
- Blog post author is a free-text `author` string field not a FK

### Auth patterns
- Admin routes (server components / pages): `requireAdminAudited()` from `lib/supabase/require-admin-audited.ts`
- Admin+operator API routes: `requireAdminOrOperator()` from `lib/supabase/require-admin-or-operator.ts`
- Admin-email check: `isAdminEmail(email)` from `lib/account.ts` (reads comma-separated `ADMIN_EMAIL`)
- Never roll a custom auth check, use the helpers

### Vault paths
- Files in the Recova Vault are at repo-relative paths
- e.g. `read_file("app/admin/blog/BlogPostForm.tsx")` reads from the repo root
- Session state files (TASK.md, backlog.md etc) are stored in the Vault KV

### CANONICAL_TAGS for blog
`payment-recovery`, `decline-codes`, `disputes`, `subscription-intelligence`, `comparisons`

Defined twice: as an array of `{slug, label}` in `app/(marketing)/blog/archive/page.tsx`, and as a `Set<string>` in `components/admin/blog/TagPills.tsx`. Free-form tags remain valid, but only these slugs roll up into the indexed cluster pages.

### Database / Supabase
- Admin client: `import { createAdminClient } from '@/lib/supabase/admin'` then `createAdminClient()` (zero args)
- Never inline: `createClient(URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })`. The helper bakes the option preset.
- Helper exclusions: `lib/intelligence/customer-context-ssr.ts` has its own `adminSupabase()` (predates the migration), `lib/supabase/require-admin-audited.ts` uses both `createServerClient` and `createClient` for an audit-logging flow, leave both alone
- Supabase MCP is NOT configured for Recova (deliberate security decision per docs/CLAUDE.md, production holds encrypted Stripe tokens + PII)
- Service-role key bypasses RLS, server-only paths only

### Design tokens (Tailwind v4 via `@theme inline` in `app/globals.css`)

**Text** (four-stop scale, all defined as `--text` / `--text-secondary` etc):
- `text-text` (primary, 15.2:1 AAA on bg) — headers, stat values, currently-selected nav
- `text-text-secondary` (subheadings, column headers)
- `text-text-tertiary` (labels, captions, metadata, most common non-primary tier)
- `text-text-subtle` (footer, empty states, decorative)
- `text-text-primary` does NOT exist, use `text-text`
- `text-muted` is deprecated, migrate to `text-text-tertiary` or `text-text-subtle`

**Surfaces:**
- `bg-bg` (page background)
- `bg-surface` (cards, panels)
- `bg-surface2` (hover rows, secondary surface)
- Elevation ladder: `--bg` -> `--surface` -> `--surface2`, never skip

**Borders:**
- `border-border` (card outlines)
- `border-border-sub` (table row dividers)
- `border-border-i` (input outlines, stronger than `--border`)
- `border-amber-border-interactive` (ghost button border, WCAG 1.4.11 compliant)
- `border-border-secondary` does NOT exist

**Amber (brand):**
- `bg-amber` / `text-amber` (CTAs, logo, primary metrics — one per card max)
- `text-amber-text` (inline amber text on dark/light surfaces, AA-safe variant)
- `bg-amber-bg` (alert fills, decorative)
- `text-on-amber` (always-dark overlay for text on amber buttons)
- `bg-amber-dark` (button hover state)

**Status (text variants are contrast-tuned, use them for inline text on tinted backgrounds):**
- Inline text: `text-success-text`, `text-error-text`, `text-warning-text`, `text-cobalt-text`
- Raw chart/icon colors: `text-green`, `text-red`, `text-orange`, `text-blue`
- `text-success`, `text-error`, `text-warning` do NOT exist
- Backgrounds: `bg-green-bg`, `bg-red-bg`, `bg-orange-bg`, `bg-blue-bg`, `bg-amber-bg`, `bg-cobalt-bg`

**Special:**
- `text-purple` / `bg-purple-bg`: Stripe Connect UI and win-back attribution only, no other use
- `text-on-amber`: always-dark overlay for amber buttons

**Semantic font scale** (added 2026-06-05, partial migration):
- `text-display` (1.75rem, hero stat values)
- `text-title` (1.25rem, page titles, PageHeader)
- `text-body` (1rem)
- `text-label` (0.8125rem)
- `text-micro` (0.6875rem)

**Hard rules:**
- Never hardcode hex in TSX (no `bg-[#222420]`, no `style={{color: '#xxx'}}`)
- Never use `style={{ color, background, border }}` for finite-enum values, map to className
- Inline style is acceptable only for runtime-dynamic numeric values (computed widths, chart dims)
- Amber on active state: only the 2px `border-b-2` underline on primary nav links, never as text or background fill

### Cron pattern (every cron must follow this exactly)
1. Verify `Authorization: Bearer ${process.env.CRON_SECRET}`, return 401 if wrong
2. `acquireLock(supabase, 'cron-name', CRON_LOCK_TTL_SECONDS)` from `lib/cron-lock.ts`, return 200 with `{skipped: 'already running'}` if locked
3. Main logic in try/catch
4. `recordCronSuccess(...)` on success, `notifyCronFailure(...)` on error (both in `lib/cron-monitor.ts`)
5. `releaseLock(...)` in finally block
6. Return JSON with counts: processed, skipped, errors

Demo accounts are excluded by `DEMO_STRIPE_PREFIX` filter in `lib/constants.ts`, never write processing logic that touches demo accounts.

### tsc before every push
Run `npx tsc --noEmit` before every git push. Fix all type errors. `typescript.ignoreBuildErrors: true` in `next.config.ts` means type errors do not block builds, but we still fix them.

### Button styles
- Primary CTA: `btn-primary` class (defined in `app/globals.css`)
- Ghost/secondary: `btn-ghost` class
- Subtle secondary: `btn-ghost-subtle` class
- Danger: `text-red border-red` treatment
- Stripe Connect only: purple (`bg-purple` etc)

### Workflow gotchas
- `git add` after a `git rm` silently skips the rest of the add-list, never include a `git rm`'d path in the subsequent `git add`
- No AI attribution in commits or user-facing surfaces (no `Co-Authored-By: Claude`, no "AI" markers in PRs)
- Never name Claude or Anthropic in user-facing copy, always say "AI"
- Vercel CLI is not installed on this machine, use Vercel MCP for deploy verification (`list_deployments`, `get_runtime_logs`)
- Sentry MCP is read-only (search_issues, get_sentry_resource), resolution stays manual in Sentry UI
- Recova Admin MCP `get_cron_log` requires an `account_id` parameter even for platform-level queries, pass `DEMO_ACCOUNT_ID_1` (`00000000-0000-0000-0000-000000000001`) to satisfy the wrapper

## Key files to read at session start
- `docs/CLAUDE.md` always first
- `docs/context.md` current product status
- `vault/priorities.md` (via Recova Vault) what is blocked and in progress
- `docs/decisions.md` what has already been decided
- `docs/AGENTS.md` confirmed findings that prevent repeated mistakes
- `docs/reference/design.md` for any UI work
- `docs/reference/database.md` for any schema work
- `lib/constants.ts` for fee percentages, timing windows, model names
- `lib/products.ts` for product definitions and pricing
