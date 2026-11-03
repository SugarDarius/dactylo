import { warn } from '../../internals/console'
import { LINK_NODE_ATTR_NAME } from '../../internals/constants'

/** Finds the nearest {@link LinkNode} marked `[dactylo-link-node]` from an event target. */
export function findLinkAnchorFromEventTarget(
  target: EventTarget | null,
): HTMLAnchorElement | null {
  if (!(target instanceof Element)) {
    return null
  }

  const el = target.closest(`[${LINK_NODE_ATTR_NAME}]`)
  return el instanceof HTMLAnchorElement ? el : null
}

/** Opens a link from an `[contenteditable=true]` element.. */
export function openLink(anchor: HTMLAnchorElement): void {
  const { href } = anchor
  if (!href) {
    warn('Cannot open link with no href', anchor)
    return
  }

  const { target, rel } = anchor
  window.open(href, target, rel)
}
