// Regression test for the "stuck on Fetching Torrent Metadata" hang.
//
// awaitTorrentMetadata() is the guard that keeps parseTorrent() from parking
// forever on a main-client torrent whose metadata will never arrive. These tests
// pin the three properties the fix depends on: it resolves on the event, it
// resolves to null on timeout, and it never rejects.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  MAIN_CLIENT_METADATA_GRACE_MS,
  awaitTorrentMetadata
} from '../electron/utils/awaitMetadata.js'

const makeTorrent = (opts = {}) => {
  const t = new EventEmitter()
  t.metadata = opts.metadata ?? null
  t.files = opts.files ?? []
  t.infoHash = opts.infoHash ?? 'abc'
  return t
}

describe('awaitTorrentMetadata', () => {
  it('uses a short default grace period', () => {
    // A long default is the bug: a paused or peerless main-client torrent
    // never emits metadata, so the Stream tab would sit on the spinner.
    assert.ok(MAIN_CLIENT_METADATA_GRACE_MS <= 10000,
      `grace period must stay short, got ${MAIN_CLIENT_METADATA_GRACE_MS}ms`)
  })

  it('resolves immediately when metadata is already present', async () => {
    const t = makeTorrent({ metadata: { name: 'x' }, files: [{}] })
    assert.equal(await awaitTorrentMetadata(t, 5000), t)
  })

  it('resolves when metadata arrives before the timeout', async () => {
    const t = makeTorrent()
    const p = awaitTorrentMetadata(t, 5000)
    setTimeout(() => {
      t.metadata = { name: 'late' }
      t.files = [{ length: 1 }]
      t.emit('metadata')
    }, 20)
    assert.equal(await p, t)
  })

  it('resolves to null instead of hanging when metadata never arrives', async () => {
    // The regression: a paused / peerless torrent emits nothing.
    const t = makeTorrent()
    const started = Date.now()
    const result = await awaitTorrentMetadata(t, 60)
    assert.equal(result, null, 'must fall back, not hang')
    assert.ok(Date.now() - started < 2000, 'must respect the grace period')
  })

  it('never rejects, even on timeout', async () => {
    const t = makeTorrent()
    await assert.doesNotReject(() => awaitTorrentMetadata(t, 30))
  })

  it('resolves to null when metadata fires but files are empty', async () => {
    const t = makeTorrent()
    const p = awaitTorrentMetadata(t, 2000)
    t.metadata = { name: 'no files' }
    t.files = []
    t.emit('metadata')
    assert.equal(await p, null)
  })

  it('tolerates a null torrent', async () => {
    assert.equal(await awaitTorrentMetadata(null, 1000), null)
  })

  it('removes its listener after timing out so it does not leak', async () => {
    const t = makeTorrent()
    await awaitTorrentMetadata(t, 30)
    assert.equal(t.listenerCount('metadata'), 0, 'listener must be cleaned up')
  })

  it('removes its listener when it resolves via the event', async () => {
    const t = makeTorrent()
    const p = awaitTorrentMetadata(t, 2000)
    t.metadata = { name: 'ok' }
    t.files = [{}]
    t.emit('metadata')
    await p
    assert.equal(t.listenerCount('metadata'), 0)
  })

  it('tolerates a torrent without event-emitter methods', async () => {
    // Defensive: a malformed object must not throw synchronously.
    const result = await awaitTorrentMetadata({ metadata: null, files: [] }, 20)
    assert.equal(result, null)
  })
})
