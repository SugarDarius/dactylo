/** A browser selection selection point. */
export interface DOMPoint {
  /** Node the collapsed selection is at. */
  node: Node

  /** Character index, or child index when `node` is an element. */
  offset: number
}
