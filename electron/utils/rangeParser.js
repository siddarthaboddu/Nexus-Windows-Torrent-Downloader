/**
 * Strict HTTP Range header parsing (RFC 7233, single-range only).
 * Pure module with no dependencies so it can be unit-tested with plain node.
 */

/**
 * Parse a Range header against a known file size.
 * @param {string} header e.g. "bytes=0-1023", "bytes=100-", "bytes=-500"
 * @param {number} fileSize total resource length in bytes
 * @returns {{ start: number, end: number } | null} inclusive byte range, or
 *   null when the header is malformed or unsatisfiable (serve 416).
 */
export function parseRangeHeader(header, fileSize) {
  if (!header || typeof header !== 'string') return null
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) return null

  // Single-range only; multipart ("bytes=0-1,3-4") is rejected.
  const m = header.match(/^bytes=(\d*)-(\d*)$/)
  if (!m) return null
  if (m[1] === '' && m[2] === '') return null

  let start
  let end

  if (m[1] === '') {
    // Suffix range: the last N bytes.
    const suffix = Number(m[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null
    start = Math.max(0, fileSize - suffix)
    end = fileSize - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? fileSize - 1 : Number(m[2])
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return null
    if (start >= fileSize) return null // unsatisfiable
    if (end >= fileSize) end = fileSize - 1 // clamp overlong ranges
    if (start > end) return null
  }

  return { start, end }
}
