/**
 * Uppercases a DXF name/marker without allocating when the string is already
 * uppercase — real files store structure markers, entity type names and table
 * names overwhelmingly in uppercase, so the common case returns the same
 * string reference instead of a `toUpperCase()` copy.
 *
 * Exactness: any string that would change under
 * `String.prototype.toUpperCase` (any ASCII lowercase, or any non-ASCII
 * character at all) is passed through `toUpperCase()`, so results are
 * identical to the plain call.
 */
export function acdbDxfKeywordUpper(value: string): string {
  let hasNonAscii = false
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    if (c >= 97 && c <= 122) {
      return value.toUpperCase()
    }
    if (c > 127) {
      hasNonAscii = true
    }
  }
  return hasNonAscii ? value.toUpperCase() : value
}
