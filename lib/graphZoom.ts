/**
 * One set of zoom stops for every cash flow graph: the single-month Sankey
 * scales its own width with them, the all-months row scales the width of each
 * month card. Sharing the stops keeps "100%" meaning the same thing in both.
 */
export const GRAPH_ZOOM_LEVELS = [0.35, 0.5, 0.65, 0.75, 1, 1.25, 1.5, 1.75];
export const MIN_GRAPH_ZOOM = GRAPH_ZOOM_LEVELS[0];
export const MAX_GRAPH_ZOOM = GRAPH_ZOOM_LEVELS[GRAPH_ZOOM_LEVELS.length - 1];
export const DEFAULT_GRAPH_ZOOM = 1;

/** Steps to the neighbouring stop, snapping from whatever level is closest. */
export function nextGraphZoomLevel(current: number, direction: "in" | "out") {
  const currentIndex = GRAPH_ZOOM_LEVELS.reduce(
    (closestIndex, level, index) =>
      Math.abs(level - current) <
      Math.abs(GRAPH_ZOOM_LEVELS[closestIndex] - current)
        ? index
        : closestIndex,
    0
  );
  const nextIndex = Math.min(
    GRAPH_ZOOM_LEVELS.length - 1,
    Math.max(0, currentIndex + (direction === "in" ? 1 : -1))
  );

  return GRAPH_ZOOM_LEVELS[nextIndex];
}
