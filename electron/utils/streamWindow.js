/**
 * Pure helpers for the streaming read-ahead window and HTTP range cap.
 *
 * Kept dependency-free (like rangeParser.js) so the arithmetic that governs
 * swarm read-ahead can be unit-tested with plain `node --test`.
 *
 * Background: Chromium asks for HTTP byte ranges. Each request maps to a
 * WebTorrent FileIterator selection, and a second "seek window" selection is
 * kept slightly ahead of the playhead so the swarm always has forward demand.
 * If that window goes stale the stream dries up mid-playback and stalls.
 */

/**
 * Upper bound on a single HTTP 206 response.
 *
 * Chromium issues one request per response, and the main process builds a new
 * FileIterator (plus a fresh piece selection) for each one. A small cap means
 * hundreds of reconnects and re-selections for a feature-length film, each one
 * re-signalling every wire. 256MB keeps requests bounded while cutting the
 * per-request overhead to a handful per movie.
 */
export const MAX_STREAM_RANGE_BYTES = 256 * 1024 * 1024

/**
 * How far ahead of the playhead the swarm should keep fetching, in bytes.
 */
export const STREAM_WINDOW_BYTES = 64 * 1024 * 1024

/**
 * Floor for the window so a huge pieceLength cannot collapse it to a single
 * piece (which would leave the swarm with no lookahead at all).
 */
export const MIN_WINDOW_PIECES = 4

/**
 * Ceiling on the window, in pieces. Torrents with very small piece lengths
 * would otherwise select an enormous range and spread the swarm too thin.
 */
export const MAX_WINDOW_PIECES = 4096

/**
 * Convert a byte budget into a piece count, clamped to sane bounds.
 *
 * @param {number} pieceLength torrent piece length in bytes
 * @param {number} [windowBytes] read-ahead budget in bytes
 * @returns {number} number of pieces to select
 */
export function windowPieceCount(pieceLength, windowBytes = STREAM_WINDOW_BYTES) {
  if (!Number.isSafeInteger(pieceLength) || pieceLength <= 0) return 0
  if (!Number.isSafeInteger(windowBytes) || windowBytes <= 0) return 0
  const wanted = Math.ceil(windowBytes / pieceLength)
  return Math.max(MIN_WINDOW_PIECES, Math.min(MAX_WINDOW_PIECES, wanted))
}

/**
 * Decide the read-ahead window for a playback position.
 *
 * The window is anchored at the piece containing `requestStart` and extends
 * `windowBytes` forward, clamped to the file's piece range. It is always
 * computed fresh — the caller decides whether to re-issue the selection, which
 * keeps a previously-downloaded window from pinning the swarm behind the
 * playhead.
 *
 * @param {object} input
 * @param {number} input.pieceLength torrent piece length in bytes
 * @param {number} input.fileStartPiece first piece of the streamed file
 * @param {number} input.fileEndPiece last piece of the streamed file
 * @param {number} input.fileOffset byte offset of the file within the torrent
 * @param {number} input.requestStart byte offset the HTTP range asked for
 * @param {number} [input.windowBytes] read-ahead budget in bytes
 * @returns {{ start: number, end: number } | null} inclusive piece range, or
 *   null when the inputs cannot produce a usable window
 */
export function computeSeekWindow({
  pieceLength,
  fileStartPiece,
  fileEndPiece,
  fileOffset = 0,
  requestStart,
  windowBytes = STREAM_WINDOW_BYTES
}) {
  if (!Number.isSafeInteger(pieceLength) || pieceLength <= 0) return null
  if (!Number.isSafeInteger(fileStartPiece) || !Number.isSafeInteger(fileEndPiece)) return null
  if (fileEndPiece < fileStartPiece) return null
  if (!Number.isSafeInteger(requestStart) || requestStart < 0) return null

  const absoluteStart = (Number.isSafeInteger(fileOffset) && fileOffset > 0 ? fileOffset : 0) + requestStart
  const requestedPiece = Math.floor(absoluteStart / pieceLength)

  // Clamp into the file so we never select neighbouring files' pieces.
  const start = Math.min(fileEndPiece, Math.max(fileStartPiece, requestedPiece))
  const span = windowPieceCount(pieceLength, windowBytes)
  if (span <= 0) return null
  const end = Math.min(fileEndPiece, start + span - 1)
  if (end < start) return null

  return { start, end }
}

/**
 * Decide whether a newly computed window should replace the live selection.
 *
 * Re-issuing on every single range request would thrash the swarm, so the
 * window is only moved once the playhead has genuinely left the region it
 * covers: either past the covered tail (normal playback) or back before the
 * window head (a backward seek). Re-anchoring as the tail is approached is the
 * part that keeps forward demand alive and prevents mid-playback stalls.
 *
 * @param {{ start: number, end: number } | null | undefined} previous live window
 * @param {{ start: number, end: number }} next freshly computed window
 * @returns {boolean} true when the selection should be replaced
 */
export function shouldMoveWindow(previous, next) {
  if (!next) return false
  if (!previous) return true
  if (!Number.isSafeInteger(previous.start) || !Number.isSafeInteger(previous.end)) return true

  // Backward seek: the playhead left the covered region in front of the window.
  if (next.start < previous.start) return true

  // Forward playback: the playhead reached the covered tail, so the window is
  // about to provide no lookahead at all. Re-anchor before that happens.
  const span = Math.max(1, previous.end - previous.start)
  const margin = Math.max(1, Math.floor(span / 4))
  return next.start > previous.end - margin
}
