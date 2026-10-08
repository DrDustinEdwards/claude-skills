# DECIDE: stop a full node_modules copy per worktree

Job: job_ce77be5595ab (follow-up to job_fc71e9b0d728). For Dustin. Nothing here is switched; every option below needs your yes first.

## What one install costs

Measured 2026-10-08 on this machine, on each repo's main-clone `node_modules` (same package-lock.json a fresh worktree installs from), summing file sizes and counting files. It is a sample of one install per repo, not the whole worktrees folder.

| repo | node_modules | files | lockfile |
|---|---|---|---|
| dustinedwards-info | 993 MB | 59,426 | package-lock.json |
| capsid | 544 MB | 16,521 | package-lock.json |
| carrel | 422 MB | 23,436 | package-lock.json |
| capsomer | 301 MB | 9,291 | package-lock.json |

One install of each: about 2.3 GB and 108,000 files. Sizes are bytes in files; NTFS cluster rounding makes the real disk use higher, most of all for dustinedwards-info's 59,000 small files. A worktree for a dustinedwards-info job costs about 1 GB, which matches the job's estimate; the others cost 0.3 to 0.5 GB. The sizes and file counts were measured; the savings below are reasoning from them and the docs.

## The three options

**(a) node_modules junction to the main clone.** Saves 100% of the per-worktree cost where the worktree's lockfile matches the main clone's. No tool change. The cost is the hazard the job names: a recursive delete that follows the junction empties the main clone's node_modules, and an install inside a junctioned worktree replaces the junction with a full copy. Both have happened. Rules it needs: a driver never installs in a junctioned worktree, and removes the junction itself (`cmd /c rmdir <worktree>\node_modules`, which removes the link only) before any worktree removal. `scripts/disk-guard.mjs` currently deletes `node_modules` with `rmSync(..., { recursive: true })` and would need a junction check added first; I have not added it. A branch that changes a dependency cannot use it.

**(b) pnpm with its shared store.** The pnpm docs say packages are kept in "a content-addressable store" and that "their files are hard-linked from that single place, consuming no additional disk space", sharing "dependencies of the same version across projects" ([pnpm.io/motivation](https://pnpm.io/motivation)). So a worktree's node_modules is mostly links: its marginal disk cost is small (the link entries and the files of packages the store lacks), and deleting a worktree only drops links, never the main clone's files. The store is machine-wide, so the four repos also share packages with each other. Cost to switch: four repos change lockfile (package-lock.json to pnpm-lock.yaml), CI and Renovate config change, and the lockfile and manifest paths are on the loop's protected list, so each repo's PR needs your merge. I did not measure the saved bytes: that needs a real `pnpm install` in each repo, which I did not run because it changes package managers. The hard-link claim is the docs'; I have not checked it on this NTFS volume.

**(c) npm with a shared cache only.** npm's cache is "a content-addressable cache that stores all http request data" ([docs.npmjs.com npm-cache](https://docs.npmjs.com/cli/v10/commands/npm-cache)) and the docs call it "strictly a cache". It saves download time, not disk: the docs do not say installs link from it, and my understanding is that `npm install` still extracts a full copy into each node_modules (not verified here). Expected disk saved: about zero. It also adds a second copy of every tarball.

## Recommendation

Do (b) pnpm, if you want the problem gone for good, and do nothing more in the meantime. Reasons:

- PR #5 already strips node_modules when a job finishes with an open PR and removes the worktree after merge. With that, steady-state use is the number of jobs running at once times about 1 GB at worst, not a number that grows overnight. The 465 GB failure needed nothing cleaning up; that is now fixed.
- Of the two ways to shrink the per-job cost, (a) is the cheaper to start and the one that already hurt you twice. (b) makes the dangerous case impossible, because removing a worktree cannot touch another tree's files.
- (c) does not help.

If you would rather not change package managers, (a) with the two rules above is the fallback, but add the junction check to `disk-guard.mjs` first.

Work to switch to (b): one repo first (capsomer, the smallest, 9,291 files) as a trial, measure the real saving with `pnpm install` against a second worktree, then the other three. No decision is recorded anywhere; reply here with yes, no or "trial only".
