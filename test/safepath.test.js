import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { resolveWithinRoot } from '../electron/utils/safePath.js'

describe('resolveWithinRoot', () => {
  const ROOT = path.join('C:', 'downloads', 'nexus')

  it('resolves a normal nested path', () => {
    const out = resolveWithinRoot(ROOT, 'movie', 'file.mp4')
    assert.equal(out, path.resolve(ROOT, 'movie', 'file.mp4'))
  })

  it('returns the root itself for empty segments', () => {
    assert.equal(resolveWithinRoot(ROOT, ''), path.resolve(ROOT))
  })

  it('rejects parent-directory escapes', () => {
    assert.equal(resolveWithinRoot(ROOT, '..', 'secret.txt'), null)
    assert.equal(resolveWithinRoot(ROOT, 'movie', '..', '..', 'evil.exe'), null)
    assert.equal(resolveWithinRoot(ROOT, '..\\..\\Windows\\System32'), null)
  })

  it('normalizes leading separators to in-root paths instead of escaping', () => {
    const out = resolveWithinRoot(ROOT, '/etc/passwd')
    assert.equal(out, path.resolve(ROOT, 'etc', 'passwd'))
  })

  it('allows sibling-name prefixes that merely share a prefix', () => {
    // C:\downloads\nexus-evil is NOT inside C:\downloads\nexus
    const out = resolveWithinRoot(path.join('C:', 'downloads'), 'nexus-evil', 'x.txt')
    assert.equal(out, path.resolve('C:', 'downloads', 'nexus-evil', 'x.txt'))
  })
})
