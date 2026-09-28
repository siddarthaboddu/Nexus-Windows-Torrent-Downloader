/**
 * Bounded wait for a WebTorrent torrent's metadata.
 *
 * Pure and dependency-free (like rangeParser.js) so the "don't hang the Stream
 * tab" behaviour is unit-testable under plain node, without pulling in the
 * 'electron' module that StreamManager depends on.
 *
 * Why this exists: parseTorrent() reuses the main client's torrent when it
 * already owns the infoHash, to avoid running two swarms for one torrent. But
 * the main client's torrent is often paused or peerless, in which case it never
 * emits 'metadata'. An unbounded wait there parks the UI on "Fetching Torrent
 * Metadata" forever while the streaming client sits unused.
 */

/**
 * How long to let a main-client torrent finish fetching metadata before giving
 * up on reusing it. A reuse optimisation, not the primary path - so it must be
 * short enough that a stuck torrent degrades to a fallback, not a hang.
 */
export const MAIN_CLIENT_METADATA_GRACE_MS = 4000

/**
 * Resolve once `torrent` has usable metadata, or null if that does not happen
 * within `timeoutMs`.
 *
 * Never rejects and never hangs: any failure mode resolves to null so the
 * caller can fall back to its own client.
 *
 * @param {object|null} torrent WebTorrent torrent-like object (EventEmitter)
 * @param {number} [timeoutMs] grace period in milliseconds
 * @returns {Promise<object|null>} the torrent once ready, otherwise null
 */
export function awaitTorrentMetadata(torrent, timeoutMs = MAIN_CLIENT_METADATA_GRACE_MS) {
  if (!torrent) return Promise.resolve(null)
  if (torrent.metadata && torrent.files?.length) return Promise.resolve(torrent)

  return new Promise((resolve) => {
    let settled = false
    let timer = null

    const hasFiles = () => Boolean(torrent.metadata && torrent.files?.length)

    const finish = (value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      // Detach either way: a torrent that stays pending for the full grace
      // period must not keep this listener alive on the long-lived client.
      try { torrent.removeListener?.('metadata', onMetadata) } catch { /* already gone */ }
      resolve(value)
    }

    const onMetadata = () => finish(hasFiles() ? torrent : null)

    // Hard bound, so an event that never fires cannot strand the caller.
    timer = setTimeout(() => finish(null), Math.max(0, Number(timeoutMs) || 0))

    try {
      torrent.once?.('metadata', onMetadata)
    } catch {
      finish(null)
      return
    }

    // Metadata may have landed between the check above and listener
    // registration. Only settle here if it is actually ready - calling
    // onMetadata() unconditionally would resolve null straight away and skip
    // the wait entirely.
    if (hasFiles()) onMetadata()
  })
}
