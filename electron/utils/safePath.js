/**
 * Path-containment helpers for renderer-supplied file paths.
 * Pure module with no dependencies so it can be unit-tested with plain node.
 */
import path from 'node:path'

/**
 * Join untrusted segments onto a root directory and reject directory escapes.
 * @param {string} root trusted base directory
 * @param {...string} segments untrusted path segments (may contain ../)
 * @returns {string | null} resolved absolute path inside root, or null on escape.
 */
export function resolveWithinRoot(root, ...segments) {
  const resolvedRoot = path.resolve(root)
  const cleaned = segments.map(s =>
    String(s || '').replace(/[/\\]+/g, path.sep).replace(/^[\\/]+/, '')
  )
  const resolved = path.resolve(path.join(resolvedRoot, ...cleaned))
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    return null
  }
  return resolved
}
