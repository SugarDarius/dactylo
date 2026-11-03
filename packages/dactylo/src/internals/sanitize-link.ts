import { URL_SCHEME_PREFIX_PATTERN } from './constants'
import { DISALLOWED_CONTROL_PATTERN, NUL_PATTERN } from './sanitize-text'

/** Detect dangerous schemes before/alongside href. */
export function isHrefWithBlockedScheme(href: string): boolean {
  const collapsed = href
    // oxlint-disable-next-line no-control-regex
    .replaceAll(/[\s\u0000-\u001F\u007F]+/gu, '')
    .replaceAll('\\', '')
    .toLowerCase()

  return (
    // oxlint-disable-next-line no-script-url
    collapsed.startsWith('javascript:') ||
    collapsed.startsWith('data:') ||
    collapsed.startsWith('vbscript:') ||
    collapsed.startsWith('file:')
  )
}

/** Detect relative URLs. */
export function isRelativeUrl(href: string): boolean {
  return (
    href.startsWith('/') ||
    href.startsWith('#') ||
    href.startsWith('./') ||
    href.startsWith('../')
  )
}

/** Schemes allowed after sanitization (lowercase, no colon). */
export const ALLOWED_SCHEMES = new Set<string>([
  'http',
  'https',
  'mailto',
  'tel',
])

/**
 * Sanitizes a link `href` for storage on {@link LinkNode} by:
 * - Trimming whitespace and strips NUL / C0 controls.
 * - Blocking executable or file URLs (`javascript:`, `data:`, `vbscript:`, `file:`).
 *   → Returning an empty url instead.
 * - Not allowing relative URLs (`//`, `./`, `../`).
 *   → Returning an empty url instead.
 * - Parsing absolute URLs with `URL`, allowlists scheme, strips `username` / `password` on http(s).
 * - Prefixing scheme-less hosts (`google.com`, `www.google.com`) with `https://`.
 * - Normalizing protocol-relative `//host/…` to `https://host/…`.
 *
 * Returns the canonical href string, or an empty string if the href is not valid.
 */
export function sanitizeLinkHref(href: string): string {
  let watched = href.trim()
  if (watched.length <= 0) {
    return ''
  }

  watched = watched.replaceAll(NUL_PATTERN, '')
  watched = watched.replaceAll(DISALLOWED_CONTROL_PATTERN, '')

  watched = watched.trim()
  if (watched.length <= 0) {
    return ''
  }

  if (isHrefWithBlockedScheme(watched) || isRelativeUrl(watched)) {
    return ''
  }

  let url: URL
  try {
    url = new URL(watched)
  } catch {
    if (URL_SCHEME_PREFIX_PATTERN.test(watched)) {
      return ''
    }

    try {
      url = new URL(`https://${watched}`)
    } catch {
      return ''
    }
  }

  const scheme = url.protocol.replace(/:$/u, '').toLowerCase()
  if (!ALLOWED_SCHEMES.has(scheme)) {
    return ''
  }

  if (scheme === 'http' || scheme === 'https') {
    url.username = ''
    url.password = ''
  }

  return url.href
}
