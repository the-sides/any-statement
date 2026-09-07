/** Chart paint goes through the theme tokens so the graphs follow light/dark. */
export function inputColor(index: number) {
  const colors = [
    "var(--teal)",
    "var(--positive)",
    "var(--cobalt)",
    "var(--gold)"
  ];

  return colors[index % colors.length];
}

export function allocationColor(source: string, index: number) {
  if (source === "saved") {
    return "var(--positive)";
  }

  if (source === "manual-output") {
    return "var(--gold)";
  }

  if (source === "overspent") {
    return "var(--coral)";
  }

  const colors = [
    "var(--magenta)",
    "var(--teal)",
    "var(--cobalt)",
    "var(--coral)",
    "var(--violet)"
  ];

  return colors[index % colors.length];
}

/** Category ids carry the raw label, so they can hold spaces and punctuation that a url(#...) reference cannot. */
export function svgId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

export function truncateSvgText(value: string, maxLength: number) {
  const trimmed = value.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 3)}...`;
}

export function formatPercent(value: number) {
  if (value === 0) {
    return "0%";
  }

  if (Math.abs(value) < 10) {
    return `${value.toFixed(1)}%`;
  }

  return `${Math.round(value)}%`;
}
