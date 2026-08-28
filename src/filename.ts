/**
 * Turning the name of a document into the name of a file.
 *
 * The name is whatever the user typed, and for a draft opened from another
 * device it arrives inside a file -- so it is cleaned here rather than trusted.
 * `<a download>` is expected to sanitise what it is handed as well, but "the
 * browser probably handles it" is not where a name that came out of someone
 * else's file should be left.
 *
 * Kept apart from the DOM so the rules are exercised by the tests directly.
 */

/** Room for a descriptive name, well short of what a filesystem refuses. */
export const NAME_MAX = 80

/**
 * The usable part of `value`, or `null` if nothing is left of it.
 *
 * Path separators and the characters Windows refuses are dropped rather than
 * the whole name rejected: someone pasting `shots/bug.png` in means the name,
 * not a directory.
 */
export function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = [
    ...value
      .normalize('NFC')
      // Control and formatting characters, which a name has no use for and a
      // shell or a file listing would render as anything at all.
      .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
      .replace(/[/\\:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      // Leading dots and spaces together: a name is not a way to write a hidden
      // file, and `..` is not a way out of the downloads folder.
      .replace(/^[\s.]+/, ''),
    // Split by code point, so a cap never lands in the middle of an emoji.
  ]
    .slice(0, NAME_MAX)
    .join('')
    // A trailing dot or space is legal to write and confusing to have: Windows
    // drops both silently, leaving a file no one can name back.
    .replace(/[\s.]+$/, '')
  return cleaned === '' ? null : cleaned
}

/** The name of a file without its extension: `bug-repro.png` -> `bug-repro`. */
export function baseName(file: string): string | null {
  const dot = file.lastIndexOf('.')
  return cleanName(dot > 0 ? file.slice(0, dot) : file)
}

/**
 * What to write the document out as.
 *
 * An unnamed document falls back to `<prefix>-<timestamp>`, which is what every
 * export was called before a document could be named, and is still what a
 * screenshot pasted in and saved straight back out gets.
 */
export function fileName(name: string | null, prefix: string, ext: string, now = new Date()): string {
  return `${cleanName(name) ?? `${prefix}-${stamp(now)}`}.${ext}`
}

function stamp(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  return `${date}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}
