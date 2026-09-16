import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { capRangeLength, parseRangeHeader } from '../electron/utils/rangeParser.js'

describe('parseRangeHeader', () => {
  const SIZE = 1000

  it('parses a normal bounded range', () => {
    assert.deepEqual(parseRangeHeader('bytes=0-499', SIZE), { start: 0, end: 499 })
  })

  it('parses an open-ended range', () => {
    assert.deepEqual(parseRangeHeader('bytes=900-', SIZE), { start: 900, end: 999 })
  })

  it('parses a suffix range', () => {
    assert.deepEqual(parseRangeHeader('bytes=-200', SIZE), { start: 800, end: 999 })
  })

  it('clamps suffix ranges larger than the file', () => {
    assert.deepEqual(parseRangeHeader('bytes=-5000', SIZE), { start: 0, end: 999 })
  })

  it('clamps overlong end offsets instead of 416', () => {
    assert.deepEqual(parseRangeHeader('bytes=900-5000', SIZE), { start: 900, end: 999 })
  })

  it('rejects empty and multipart ranges', () => {
    assert.equal(parseRangeHeader('bytes=-', SIZE), null)
    assert.equal(parseRangeHeader('bytes=0-1,3-4', SIZE), null)
    assert.equal(parseRangeHeader('items=0-10', SIZE), null)
    assert.equal(parseRangeHeader('', SIZE), null)
    assert.equal(parseRangeHeader(null, SIZE), null)
  })

  it('rejects unsatisfiable and inverted ranges (serve 416)', () => {
    assert.equal(parseRangeHeader('bytes=1000-', SIZE), null) // start beyond EOF
    assert.equal(parseRangeHeader('bytes=5000-6000', SIZE), null)
    assert.equal(parseRangeHeader('bytes=500-100', SIZE), null) // start > end
    assert.equal(parseRangeHeader('bytes=-0', SIZE), null)
    // end=0 with a nonzero start is inverted
    assert.equal(parseRangeHeader('bytes=10-0', SIZE), null)
  })

  it('rejects non-numeric and unsafe integers', () => {
    assert.equal(parseRangeHeader('bytes=abc-def', SIZE), null)
    assert.equal(parseRangeHeader('bytes=0-99999999999999999999', SIZE), null)
  })
})

describe('capRangeLength', () => {
  it('caps an open-ended parsed range while retaining its start', () => {
    assert.deepEqual(capRangeLength({ start: 125, end: 999 }, 256), { start: 125, end: 380 })
  })

  it('leaves an already-small range unchanged', () => {
    assert.deepEqual(capRangeLength({ start: 125, end: 300 }, 256), { start: 125, end: 300 })
  })

  it('rejects invalid input', () => {
    assert.throws(() => capRangeLength({ start: 5, end: 4 }, 256), TypeError)
    assert.throws(() => capRangeLength({ start: 0, end: 5 }, 0), TypeError)
  })
})
