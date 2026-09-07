import {
  allocationColor,
  formatPercent,
  inputColor,
  svgId,
  truncateSvgText
} from "@/lib/chartFormat";
import { formatCurrency } from "@/lib/currency";
import type { CashFlowSummary } from "@/lib/cashFlowPlan";

// The flow chart is wide on purpose: the long horizontal runs are what let a
// ribbon flatten out before it reaches its label.
const SANKEY_WIDTH = 1360;
const SANKEY_MIN_RENDER_WIDTH = 880;
const SANKEY_TRUNK_HEIGHT = 660;
const SANKEY_NODE_WIDTH = 14;
const SANKEY_LABEL_GAP = 16;
const SANKEY_NODE_GAP = 6;
const SANKEY_LABEL_SPACING = 50;
const SANKEY_MIN_NODE_HEIGHT = 3;
/** Strip above the page the riser climbs through before it fades out. */
const RISER_HEADROOM = 230;
/** How far the riser leans away from the trunk before it turns vertical. */
const RISER_RUN = 90;

export type SankeySegment<T> = T & {
  color: string;
  height: number;
  y0: number;
  y1: number;
  yc: number;
};

function CashFlowSankey({
  summary,
  currency,
  fit,
  idPrefix = "sankey",
  zoom = 1
}: {
  summary: CashFlowSummary;
  currency: string;
  /** `fit` drops the zoom sizing so the chart can fill its own column. */
  fit?: boolean;
  /** Unique per rendered chart, so two on one page never share gradient ids. */
  idPrefix?: string;
  zoom?: number;
}) {
  const width = SANKEY_WIDTH;
  const top = 84;
  const bottom = 48;
  const inputX = 40;
  const incomeX = 500;
  const outputX = 1288;
  const positiveInputs = summary.inputs.filter((entry) => entry.amount > 0);
  // The remainder (saved, or overspent) is drawn separately, as the shape that
  // leaves or arrives through the top of the frame.
  const outflowAllocations = summary.allocations.filter(
    (allocation) =>
      allocation.amount > 0 && allocation.source !== "saved" && allocation.source !== "overspent"
  );
  const remainder = summary.allocations.find(
    (allocation) =>
      allocation.source === "saved" || allocation.source === "overspent"
  );
  const overspent = remainder?.source === "overspent" ? remainder : null;
  const saved = remainder?.source === "saved" ? remainder : null;
  const inputTotal =
    positiveInputs.reduce((sum, input) => sum + input.amount, 0) || 1;
  const outflowTotal =
    outflowAllocations.reduce((sum, allocation) => sum + allocation.amount, 0) || 1;
  // The trunk carries whichever side is larger: inputs plus an overspend
  // arriving from the top, or outputs plus the savings leaving through it.
  // Both node columns are scaled to their share of that total, so the packed
  // ends plus the remainder slot fill the bar exactly and volume is conserved.
  const trunkTotal =
    inputTotal > outflowTotal ? inputTotal : outflowTotal || inputTotal;
  const inputShare = SANKEY_TRUNK_HEIGHT * (inputTotal / trunkTotal);
  const outputShare = SANKEY_TRUNK_HEIGHT * (outflowTotal / trunkTotal);
  const inputNodes = layoutSankeyColumn(
    positiveInputs.map((entry, index) => ({
      ...entry,
      color: inputColor(index)
    })),
    inputTotal,
    top,
    inputShare
  );
  const allocationNodes = layoutSankeyColumn(
    outflowAllocations.map((allocation, index) => ({
      ...allocation,
      color: allocationColor(allocation.source, index)
    })),
    outflowTotal,
    top,
    outputShare
  );
  // Both ends of the trunk are packed solid: the income bar is exactly as tall
  // as the flows entering it and as the flows leaving it, so the volume of one
  // shape is visibly conserved as it breaks out into categories. The remainder
  // takes the leftover share at the *top* of the end its side does not fill,
  // so its riser peels straight off the top edge of the trunk instead of
  // climbing across every other ribbon on the way out.
  const remainderHeight = (amount: number) =>
    SANKEY_TRUNK_HEIGHT * (amount / trunkTotal);
  const overspentHeight = overspent ? remainderHeight(overspent.amount) : 0;
  const savedHeight = saved ? remainderHeight(saved.amount) : 0;
  const trunkInflow = stackTrunkEnds(inputNodes, top + overspentHeight);
  const trunkOutflow = stackTrunkEnds(allocationNodes, top + savedHeight);
  const height = Math.round(
    Math.max(
      top + SANKEY_TRUNK_HEIGHT,
      inputNodes[inputNodes.length - 1]?.y1 ?? 0,
      allocationNodes[allocationNodes.length - 1]?.y1 ?? 0
    ) + bottom
  );
  // Headroom is the strip the riser climbs through before it fades out of the
  // frame. Only a month with a remainder pays for it.
  const headroom = remainder ? RISER_HEADROOM : 0;
  const trunkCenterY = top + SANKEY_TRUNK_HEIGHT / 2;
  const hasTrunk = positiveInputs.length > 0 || allocationNodes.length > 0;

  return (
    <svg
      className="sankey-chart"
      style={
        fit
          ? { width: "100%" }
          : {
              width: `${Math.round(zoom * 100)}%`,
              minWidth: `${Math.round(SANKEY_MIN_RENDER_WIDTH * zoom)}px`
            }
      }
      viewBox={`0 ${-headroom} ${width} ${height + headroom}`}
      role="img"
      aria-label="Income flowing to savings, manual outputs, and statement categories"
    >
      <defs>
        {inputNodes.map((node) => (
          <linearGradient
            key={`input-gradient-${node.id}`}
            id={`${idPrefix}-input-${svgId(node.id)}`}
            gradientUnits="userSpaceOnUse"
            x1={inputX + SANKEY_NODE_WIDTH}
            x2={incomeX}
          >
            <stop offset="0%" stopColor={node.color} />
            <stop offset="100%" stopColor="var(--positive)" />
          </linearGradient>
        ))}
        {allocationNodes.map((node) => (
          <linearGradient
            key={`allocation-gradient-${node.id}`}
            id={`${idPrefix}-allocation-${svgId(node.id)}`}
            gradientUnits="userSpaceOnUse"
            x1={incomeX + SANKEY_NODE_WIDTH}
            x2={outputX}
          >
            <stop offset="0%" stopColor="var(--positive)" />
            <stop offset="100%" stopColor={node.color} />
          </linearGradient>
        ))}
      </defs>

      <rect
        className="sankey-stage"
        y={-headroom}
        width={width}
        height={height + headroom}
        rx="8"
      />
      <text className="sankey-title" x={inputX} y="34">
        Inputs
      </text>
      <text className="sankey-title" x={incomeX} y="34">
        Income
      </text>
      <text
        className="sankey-title"
        x={outputX + SANKEY_NODE_WIDTH}
        y="34"
        textAnchor="end"
      >
        Outputs & categories
      </text>

      {positiveInputs.length === 0 ? (
        <text className="sankey-empty" x={inputX} y={top + 30}>
          Add income
        </text>
      ) : null}
      {allocationNodes.length === 0 ? (
        <text className="sankey-empty" x={outputX} y={top + 30} textAnchor="end">
          Add outputs or statement rows
        </text>
      ) : null}

      <g className="sankey-ribbons">
        {inputNodes.map((node, index) => (
          <path
            className="sankey-ribbon"
            key={`input-ribbon-${node.id}`}
            d={sankeyRibbonPath(
              inputX + SANKEY_NODE_WIDTH,
              incomeX,
              node.y0,
              node.y1,
              trunkInflow[index].y0,
              trunkInflow[index].y1
            )}
            fill={`url(#${idPrefix}-input-${svgId(node.id)})`}
          />
        ))}
        {allocationNodes.map((node, index) => (
          <path
            className="sankey-ribbon"
            key={`allocation-ribbon-${node.id}`}
            d={sankeyRibbonPath(
              incomeX + SANKEY_NODE_WIDTH,
              outputX,
              trunkOutflow[index].y0,
              trunkOutflow[index].y1,
              node.y0,
              node.y1
            )}
            fill={`url(#${idPrefix}-allocation-${svgId(node.id)})`}
          />
        ))}

        {/* Saved climbs out of the top of the frame from the output end of the
            trunk; overspent pours in from the top to the input end. Both peel
            off the top edge of the trunk, so neither crosses a category
            ribbon on its way through the headroom. */}
        {saved ? (
          <RiserRibbon
            allocation={saved}
            currency={currency}
            direction="up"
            headroom={headroom}
            idPrefix={idPrefix}
            thickness={savedHeight}
            topY={top}
            x={incomeX + SANKEY_NODE_WIDTH}
          />
        ) : null}
        {overspent ? (
          <RiserRibbon
            allocation={overspent}
            currency={currency}
            direction="down"
            headroom={headroom}
            idPrefix={idPrefix}
            thickness={overspentHeight}
            topY={top}
            x={incomeX}
          />
        ) : null}
      </g>

      <g className="sankey-nodes">
        {inputNodes.map((node) => (
          <SankeyNodeMark
            key={`input-${node.id}`}
            x={inputX}
            node={node}
            label={truncateSvgText(node.label, 30)}
            value={`${formatCurrency(node.amount, currency)} (${formatPercent(
              (node.amount / inputTotal) * 100
            )})`}
            side="right"
          />
        ))}

        {hasTrunk ? (
          <>
            <rect
              className="sankey-income-node"
              x={incomeX}
              y={top}
              width={SANKEY_NODE_WIDTH}
              height={SANKEY_TRUNK_HEIGHT}
              rx="2"
            />
            <text
              className="sankey-node-name"
              x={incomeX + SANKEY_NODE_WIDTH + SANKEY_LABEL_GAP}
              y={trunkCenterY - 4}
            >
              Income
            </text>
            <text
              className="sankey-node-value"
              x={incomeX + SANKEY_NODE_WIDTH + SANKEY_LABEL_GAP}
              y={trunkCenterY + 19}
            >
              {formatCurrency(summary.incomeTotal, currency)} (100%)
            </text>
          </>
        ) : null}

        {allocationNodes.map((node) => (
          <SankeyNodeMark
            key={`allocation-${node.id}`}
            x={outputX}
            node={node}
            label={truncateSvgText(node.label, 30)}
            value={`${formatCurrency(node.amount, currency)} (${formatPercent(
              node.percent
            )})`}
            side="left"
          />
        ))}
      </g>
    </svg>
  );
}

export default CashFlowSankey;

function SankeyNodeMark({
  x,
  node,
  label,
  value,
  side
}: {
  x: number;
  node: { color: string; height: number; y0: number; yc: number };
  label: string;
  value: string;
  side: "left" | "right";
}) {
  // Hairline categories still need a bar you can see and a label you can read,
  // so the mark keeps a floor height and stays centred on its own flow.
  const barHeight = Math.max(node.height, SANKEY_MIN_NODE_HEIGHT);
  const textX =
    side === "right"
      ? x + SANKEY_NODE_WIDTH + SANKEY_LABEL_GAP
      : x - SANKEY_LABEL_GAP;

  return (
    <g>
      <rect
        x={x}
        y={node.yc - barHeight / 2}
        width={SANKEY_NODE_WIDTH}
        height={barHeight}
        rx="2"
        fill={node.color}
      />
      <text
        className="sankey-node-name"
        x={textX}
        y={node.yc - 4}
        textAnchor={side === "right" ? "start" : "end"}
      >
        {label}
      </text>
      <text
        className="sankey-node-value"
        x={textX}
        y={node.yc + 19}
        textAnchor={side === "right" ? "start" : "end"}
      >
        {value}
      </text>
    </g>
  );
}

/**
 * The remainder ribbon. It peels off the top edge of the trunk, turns
 * vertical, and fades out through the top of the frame, so saved money
 * visibly leaves the page and overspent money visibly arrives from outside
 * it. `down` pours into the input end of the trunk; `up` climbs out of the
 * output end.
 */
function RiserRibbon({
  allocation,
  currency,
  direction,
  headroom,
  idPrefix,
  thickness,
  topY,
  x
}: {
  allocation: { amount: number; percent: number };
  currency: string;
  direction: "up" | "down";
  headroom: number;
  idPrefix: string;
  /** Trunk share of the remainder: the band keeps this width all the way up. */
  thickness: number;
  /** Top edge of the trunk, which is the edge the band leaves from. */
  topY: number;
  x: number;
}) {
  const exitY = -headroom;
  // Rising bands lean right of the trunk, falling ones left, so the climb
  // never runs back through the column it came from.
  const bandLeft =
    direction === "up" ? x + RISER_RUN : x - RISER_RUN - thickness;
  const bandRight = bandLeft + thickness;
  const climb = topY - exitY;
  // The inner edge of the bend turns tighter than the outer one; equal
  // control lengths would pinch the band shut at the corner.
  const inner = climb * 0.45;
  const outer = inner + thickness * 0.5;
  const innerX = direction === "up" ? bandLeft : bandRight;
  const outerX = direction === "up" ? bandRight : bandLeft;
  const innerRun = direction === "up" ? RISER_RUN : -RISER_RUN;
  const gradientId = `${idPrefix}-riser-${direction}`;
  const path = [
    `M ${x} ${topY}`,
    `C ${x + innerRun} ${topY}, ${innerX} ${exitY + inner}, ${innerX} ${exitY}`,
    `L ${outerX} ${exitY}`,
    `C ${outerX} ${exitY + outer}, ${x + innerRun} ${topY + thickness}, ${x} ${
      topY + thickness
    }`,
    "Z"
  ].join(" ");
  const labelX = Math.min(
    Math.max((bandLeft + bandRight) / 2, 150),
    SANKEY_WIDTH - 150
  );

  return (
    <g className="sankey-ribbon-group">
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={0}
          y1={exitY}
          x2={0}
          y2={topY}
        >
          <stop
            offset="0%"
            stopColor={direction === "down" ? "var(--coral)" : "var(--positive)"}
            stopOpacity="0"
          />
          <stop
            offset="70%"
            stopColor={direction === "down" ? "var(--coral)" : "var(--positive)"}
            stopOpacity="1"
          />
        </linearGradient>
      </defs>
      <path
        className="sankey-ribbon sankey-riser"
        d={path}
        fill={`url(#${gradientId})`}
      />
      <text
        className={`sankey-riser-label ${direction === "down" ? "incoming" : ""}`}
        x={labelX}
        y={exitY + 54}
        textAnchor="middle"
      >
        {direction === "down" ? "Overspent " : "Saved "}
        {formatCurrency(allocation.amount, currency)} (
        {formatPercent(allocation.percent)})
      </text>
    </g>
  );
}

// A column stacks its nodes in value order, but a run of tiny categories would
// otherwise pile their labels on top of each other. Spreading them costs
// vertical room the chart does not have to fit on screen, so the branch simply
// reaches further down the canvas instead of squeezing.
function layoutSankeyColumn<T extends { amount: number; color: string }>(
  items: readonly T[],
  total: number,
  top: number,
  trunkHeight: number
): Array<SankeySegment<T>> {
  if (items.length === 0) {
    return [];
  }

  const heights = items.map((item) =>
    total > 0 ? (item.amount / total) * trunkHeight : trunkHeight / items.length
  );
  let cursor = top;

  return items.map((item, index) => {
    const height = heights[index];
    const y0 = cursor;
    const y1 = y0 + height;
    const next = heights[index + 1];

    cursor =
      next === undefined
        ? y1
        : y1 +
          Math.max(
            SANKEY_NODE_GAP,
            SANKEY_LABEL_SPACING - (height + next) / 2
          );

    return {
      ...item,
      height,
      y0,
      y1,
      yc: y0 + height / 2
    };
  });
}

// The trunk end of every ribbon is packed edge to edge so the bar it meets is
// exactly the sum of its flows.
function stackTrunkEnds(
  nodes: ReadonlyArray<{ height: number }>,
  top: number
) {
  let cursor = top;

  return nodes.map((node) => {
    const y0 = cursor;
    cursor = y0 + node.height;

    return { y0, y1: cursor };
  });
}

// A ribbon is a closed shape, not a thick line: its top and bottom edges are
// separate curves, so the band keeps its own width at each end and the volume
// entering equals the volume leaving.
function sankeyRibbonPath(
  x0: number,
  x1: number,
  a0: number,
  a1: number,
  b0: number,
  b1: number
) {
  const curve = (x1 - x0) * 0.5;

  return [
    `M ${x0} ${a0}`,
    `C ${x0 + curve} ${a0}, ${x1 - curve} ${b0}, ${x1} ${b0}`,
    `L ${x1} ${b1}`,
    `C ${x1 - curve} ${b1}, ${x0 + curve} ${a1}, ${x0} ${a1}`,
    "Z"
  ].join(" ");
}
