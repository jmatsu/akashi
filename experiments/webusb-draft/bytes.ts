/** Named as `src/png.ts` names it: a view that owns an `ArrayBuffer`, not a shared one. */
export type Bytes = Uint8Array<ArrayBuffer>

export function concat(parts: readonly Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}
