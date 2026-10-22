// The node_modules link probe, as a command (a hooks module cannot read the disk).
//
//   node junctions.mjs <target>   prints {"link": "<first node_modules link>" | null}
//
// It walks the target with lstat and never follows a link, so the path goes to no
// shell: a target holding `&` or quotes is only ever a file name here. Node reports a
// Windows junction as a symbolic link, the same way `dir /AL` lists it.
import { lstatSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const isNodeModules = (name) => name.toLowerCase() === 'node_modules'

export function findNodeModulesLink(target) {
  let st
  try {
    st = lstatSync(target)
  } catch {
    return null
  }
  if (st.isSymbolicLink()) return isNodeModules(basename(target)) ? target : null
  if (!st.isDirectory()) return null
  const stack = [target]
  while (stack.length) {
    const dir = stack.pop()
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        if (isNodeModules(entry.name)) return p
      } else if (entry.isDirectory()) {
        stack.push(p)
      }
    }
  }
  return null
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify({ link: findNodeModulesLink(process.argv[2]) }))
}
