import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_STREAM_RANGE_BYTES,
  MAX_WINDOW_PIECES,
  MIN_WINDOW_PIECES,
  STREAM_WINDOW_BYTES,
  computeSeekWindow,
  shouldMoveWindow,
  windowPieceCount
} from '../electron/utils/streamWindow.js'

const KB = 1024
const MB = 1024 * 1024

describe('tuning constants', () => {
  it('serves far more per response than the old 8MB cap', () => {
    // The cap governs how often Chromium reconnects and the main process
    // rebuilds a FileIterator, so it should be a small number per movie.
    assert.equal(MAX_STREAM_RANGE_BYTES, 256 * MB)
    assert.ok(MAX_STREAM_RANGE_BYTES > 8 * MB)
  })

  it('keeps a substantial read-ahead budget', () => {
    assert.ok(STREAM_WINDOW_BYTES >= 32 * MB)
  })
})

describe('windowPieceCount', () => {
  it('converts a byte budget into pieces', () => {
    assert.equal(windowPieceCount(256 * KB, 64 * MB), 256)
    assert.equal(windowPieceCount(1 * MB, 64 * MB), 64)
  })

  it('floors the window so lookahead always exists', () => {
    // A huge piece length must not collapse the window to nothing.
    assert.equal(windowPieceCount(64 * MB, 64 * MB), MIN_WINDOW_PIECES)
  })

  it('caps tiny pieces so the swarm is not spread across a huge range', () => {
    assert.equal(windowPieceCount(16 * KB, 64 * MB), MAX_WINDOW_PIECES)
  })

  it('rejects invalid inputs', () => {
    assert.equal(windowPieceCount(0, 64 * MB), 0)
    assert.equal(windowPieceCount(-1, 64 * MB), 0)
    assert.equal(windowPieceCount(256 * KB, 0), 0)
    assert.equal(windowPieceCount(null, 64 * MB), 0)
  })
})

describe('computeSeekWindow', () => {
  const base = {
    pieceLength: 256 * KB,
    fileStartPiece: 0,
    fileEndPiece: 4000
  }

  it('anchors the window at the piece containing the request', () => {
    const w = computeSeekWindow({ ...base, requestStart: 0 })
    assert.equal(w.start, 0)
    assert.equal(w.end, 255) // 64MB / 256KB = 256 pieces
  })

  it('follows the playhead forward', () => {
    const w = computeSeekWindow({ ...base, requestStart: 256 * KB * 100 })
    assert.equal(w.start, 100)
    assert.equal(w.end, 355)
  })

  it('adds the file offset for multi-file torrents', () => {
    // Second file starting at 10MB: byte 0 of that file is piece 40.
    const w = computeSeekWindow({ ...base, fileOffset: 10 * MB, requestStart: 0 })
    assert.equal(w.start, 40)
  })

  it('clamps to the file piece range so neighbours are not selected', () => {
    const w = computeSeekWindow({ ...base, fileEndPiece: 20, requestStart: 100 * MB })
    assert.equal(w.start, 20)
    assert.equal(w.end, 20)
  })

  it('clamps a request that starts before the file', () => {
    const w = computeSeekWindow({ ...base, fileStartPiece: 10, requestStart: 0 })
    assert.equal(w.start, 10)
  })

  it('rejects unusable inputs', () => {
    assert.equal(computeSeekWindow({ ...base, pieceLength: 0, requestStart: 0 }), null)
    assert.equal(computeSeekWindow({ ...base, requestStart: -1 }), null)
    assert.equal(computeSeekWindow({ ...base, fileEndPiece: 5, fileStartPiece: 10, requestStart: 0 }), null)
  })
})

describe('shouldMoveWindow', () => {
  it('always selects the very first window', () => {
    assert.equal(shouldMoveWindow(null, { start: 0, end: 255 }), true)
    assert.equal(shouldMoveWindow(undefined, { start: 0, end: 255 }), true)
  })

  it('does not thrash while the playhead stays inside the window', () => {
    // Progressive buffering re-requests the same start repeatedly.
    const prev = { start: 0, end: 255 }
    assert.equal(shouldMoveWindow(prev, { start: 0, end: 255 }), false)
    assert.equal(shouldMoveWindow(prev, { start: 10, end: 265 }), false)
  })

  it('re-anchors as the playhead reaches the covered tail', () => {
    // This is the stall fix: once the playhead approaches the end of the
    // window the swarm must get fresh forward demand, otherwise _gcSelections
    // drops the fully-downloaded selection and nothing re-selects ahead.
    const prev = { start: 0, end: 255 }
    assert.equal(shouldMoveWindow(prev, { start: 200, end: 455 }), true)
  })

  it('moves on a backward seek', () => {
    const prev = { start: 500, end: 755 }
    assert.equal(shouldMoveWindow(prev, { start: 20, end: 275 }), true)
  })

  it('moves when the previous window is malformed', () => {
    assert.equal(shouldMoveWindow({ start: NaN, end: 10 }, { start: 0, end: 255 }), true)
  })

  it('never moves without a computed window', () => {
    assert.equal(shouldMoveWindow({ start: 0, end: 255 }, null), false)
  })

  it('keeps forward demand alive across a long playback run', () => {
    // Simulate steady playback: the window must keep getting re-anchored and
    // must always extend beyond the playhead.
    const piece = 256 * KB
    const step = 10 * piece // playhead advances 10 pieces per tick
    let live = null
    for (let tick = 0; tick < 60; tick++) {
      const requestStart = tick * step
      const next = computeSeekWindow({
        pieceLength: piece,
        fileStartPiece: 0,
        fileEndPiece: 100000,
        requestStart
      })
      assert.ok(next, 'window should always compute')
      if (shouldMoveWindow(live, next)) live = next
      assert.ok(live.end > requestStart / piece, 'window must extend past the playhead')
    }
  })
})
