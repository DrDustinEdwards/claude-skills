// Wiring tests for register.js, run with `claude plugin test` from this folder. The
// decisions themselves (patterns, lock format, command parsing) are tested under plain
// `node --test` in the repo's test/ folder, which CI runs. CI does not install Claude
// Code, so this file is run locally.
import { expect, test } from 'claude-code/testing'

const GOOD_KEY = 'capsid_' + 'a1b2c3d4'.repeat(8)

function stubSession($: any, on: any, calls: string[][] = []) {
  on('session.cwd', () => ({ value: 'C:\\w\\wt' }))
  on('session.id', () => ({ value: '3f2a9c1e-5b7d-4e8a' }))
  on('ui.log', () => ({ value: undefined }))
  return calls
}

test('a force push is refused and never reaches the tool', async ($, on) => {
  stubSession($, on)
  let ran = false
  on('tool.call', () => {
    ran = true
    return { result: 'pushed' }
  })
  const out: any = await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' })
  expect(out.deny).toMatch(/Force pushes are not allowed/)
  expect(ran).toBe(false)
})

test('a planted key in a tool result never reaches the model', async ($, on) => {
  stubSession($, on)
  on('tool.call', () => ({ result: 'token is ' + GOOD_KEY + ' ok' }))
  const out: any = await $.tool.call({ tool: 'Bash', command: 'echo hello' })
  expect(JSON.stringify(out)).not.toContain('a1b2c3d4')
  expect(JSON.stringify(out)).toContain('[REDACTED:capsid-key]')
})

test('reading a key file is refused, checking it exists is not', async ($, on) => {
  stubSession($, on)
  on('tool.call', () => ({ result: 'True' }))
  const read: any = await $.tool.call({ tool: 'Read', file_path: 'C:\\Users\\email\\.capsid\\agent-claude-skills-driver.key' })
  expect(read.deny).toMatch(/never read into a session/)
  const cat: any = await $.tool.call({ tool: 'Bash', command: 'cat ~/.capsid/agent-seat.key' })
  expect(cat.deny).toMatch(/never read into a session/)
  const exists: any = await $.tool.call({ tool: 'PowerShell', command: 'Test-Path "C:\\Users\\email\\.capsid\\agent-claude-skills-driver.key"' })
  expect(exists.deny).toBeUndefined()
})

test('a recursive delete of a tree holding a node_modules junction is refused', async ($, on) => {
  stubSession($, on)
  let ran = false
  on('tool.call', () => {
    ran = true
    return { result: 'deleted' }
  })
  on('process.run', ($, e: any) => {
    const argv: string[] = e.argv
    if (argv[0] === 'cmd' && argv.includes('/S')) return { value: { exitCode: 0, stdout: 'C:\\w\\wt\\node_modules\r\n', stderr: '' } }
    return { value: { exitCode: 1, stdout: '', stderr: 'unexpected' } }
  })
  const out: any = await $.tool.call({ tool: 'Bash', command: 'rm -rf C:/w/wt' })
  expect(out.deny).toMatch(/holds a node_modules junction/)
  expect(out.deny).toMatch(/rmdir/)
  expect(ran).toBe(false)
})

test('a recursive delete with no junction under it goes through', async ($, on) => {
  stubSession($, on)
  on('tool.call', () => ({ result: 'deleted' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  const out: any = await $.tool.call({ tool: 'Bash', command: 'rm -rf C:/w/wt' })
  expect(out.deny).toBeUndefined()
})

test('an install takes the lock, runs, and gives it back', async ($, on) => {
  stubSession($, on)
  const lockCalls: string[] = []
  const order: string[] = []
  on('tool.call', () => {
    order.push('tool')
    return { result: 'installed' }
  })
  on('process.run', ($, e: any) => {
    const sub = e.argv[2]
    lockCalls.push(sub + ' ' + e.argv[3])
    order.push(sub)
    return { value: { exitCode: 0, stdout: sub === 'release' ? '{"released":true}\n' : '{"ok":true}\n', stderr: '' } }
  })
  const out: any = await $.tool.call({ tool: 'Bash', command: 'npm ci' })
  expect(out.deny).toBeUndefined()
  expect(order).toEqual(['acquire', 'tool', 'release'])
  expect(lockCalls[0]).toBe('acquire tab-3f2a9c1e')
})

test('an install waits for a holder, then runs', async ($, on) => {
  stubSession($, on)
  const seen: string[] = []
  on('tool.call', () => ({ result: 'installed' }))
  on('process.run', ($, e: any) => {
    const sub = e.argv[2]
    seen.push(sub)
    if (sub === 'acquire') return { value: { exitCode: 0, stdout: '{"ok":false,"holder":{"ns":"scheduler","pid":1,"started":"2026-10-08T01:00:00.000Z"}}', stderr: '' } }
    if (sub === 'wait') return { value: { exitCode: 0, stdout: '{"ok":true}', stderr: '' } }
    return { value: { exitCode: 0, stdout: '{"released":true}', stderr: '' } }
  })
  const out: any = await $.tool.call({ tool: 'Bash', command: 'npm run build' })
  expect(out.deny).toBeUndefined()
  expect(seen).toEqual(['acquire', 'wait', 'release'])
})

test('a lock that never frees refuses the install after three waits', async ($, on) => {
  stubSession($, on)
  const seen: string[] = []
  let ran = false
  on('tool.call', () => {
    ran = true
    return { result: 'installed' }
  })
  on('process.run', ($, e: any) => {
    seen.push(e.argv[2])
    return { value: { exitCode: 0, stdout: '{"ok":false,"holder":{"ns":"scheduler","pid":1,"started":"2026-10-08T01:00:00.000Z"}}', stderr: '' } }
  })
  const out: any = await $.tool.call({ tool: 'Bash', command: 'npm install' })
  expect(out.deny).toMatch(/still held after 27 minutes/)
  expect(seen).toEqual(['acquire', 'wait', 'wait', 'wait'])
  expect(ran).toBe(false)
})

test('a test run or a lint is not heavy and takes no lock', async ($, on) => {
  stubSession($, on)
  let processCalls = 0
  on('tool.call', () => ({ result: 'ok' }))
  on('process.run', () => {
    processCalls += 1
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  await $.tool.call({ tool: 'Bash', command: 'npm run lint' })
  await $.tool.call({ tool: 'Bash', command: 'node --test test/x.test.mjs' })
  expect(processCalls).toBe(0)
})
