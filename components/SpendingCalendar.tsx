"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatCurrency } from "@/lib/currency";
import { formatMonthLabel } from "@/lib/months";
import { calendarCategoryColor, summarizeCalendar, type CalendarExpense, type CalendarIncome } from "@/lib/spendingCalendar";

const EMPTY_INCOMES: readonly CalendarIncome[] = [];
const INITIAL_VIEW = { yaw: -Math.PI / 4, tilt: Math.atan(1 / Math.sqrt(2)), zoom: 1, panX: 0, panY: 0 };
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
type Point = [number, number, number];

export default function SpendingCalendar({ month, expenses, currency, incomes = EMPTY_INCOMES }: {
  month: string; expenses: readonly CalendarExpense[]; currency: string; incomes?: readonly CalendarIncome[];
}) {
  const [hideRent, setHideRent] = useState(true);
  const [volumeScale, setVolumeScale] = useState(1);
  const calendar = useMemo(() => summarizeCalendar(month, expenses, hideRent, incomes), [month, expenses, hideRent, incomes]);
  const [view, setView] = useState(INITIAL_VIEW);
  const [selected, setSelected] = useState("");
  const [category, setCategory] = useState("");
  const svgRef = useRef<SVGSVGElement>(null);
  const hovering = useRef(false);
  const spaceHeld = useRef(false);
  const [panReady, setPanReady] = useState(false);
  const drag = useRef<{ pan: boolean; panX: number; panY: number; unitsPerPixel: number; x: number; y: number; yaw: number; tilt: number; moved: boolean; id: number } | null>(null);
  const suppressClick = useRef(false);
  useEffect(() => {
    function releaseSpace() {
      spaceHeld.current = false;
      setPanReady(false);
    }
    function keyDown(event: KeyboardEvent) {
      if (event.code !== "Space" || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, button, [contenteditable]:not([contenteditable='false'])")) return;
      spaceHeld.current = true;
      setPanReady(true);
      if (hovering.current || (target instanceof Node && svgRef.current?.contains(target))) event.preventDefault();
    }
    function keyUp(event: KeyboardEvent) {
      if (event.code === "Space") releaseSpace();
    }
    function blur() {
      releaseSpace();
      drag.current = null;
    }
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", blur);
    };
  }, []);
  if (!calendar) return null;
  const money = (amount: number) => formatCurrency(amount, currency);
  const selectedDay = calendar.days.find(day => day.date === selected);
  const activeCategory = calendar.categories.some(([name]) => name === category) ? category : "";
  const peak = Math.max(calendar.peak, calendar.incomePeak);
  const scale = peak > 0 ? (125 * volumeScale) / peak : 0;
  const cos = Math.cos(view.yaw), sin = Math.sin(view.yaw);
  const depth = (x: number, y: number) => x * sin + y * cos;
  function project([x, y, z]: Point): [number, number] {
    return [470 + view.panX + (x * cos - y * sin) * view.zoom,
      320 + view.panY + (depth(x, y) * Math.sin(view.tilt) - z * Math.cos(view.tilt)) * view.zoom];
  }
  const points = (vertices: Point[]) => vertices.map(p => project(p).map(n => n.toFixed(2)).join(",")).join(" ");
  const rectangle = (x: number, y: number, size: number, z: number): Point[] =>
    [[x, y, z], [x + size, y, z], [x + size, y + size, z], [x, y + size, z]];
  const cells = calendar.days.map(day => {
    const position = calendar.offset + day.day - 1;
    return { ...day, x: (position % 7 - 3.5) * 66, y: (Math.floor(position / 7) - calendar.weeks / 2) * 66 };
  }).sort((a, b) => depth(a.x, a.y) - depth(b.x, b.y));
  // Labels are screen-aligned and painted after the geometry so another tower
  // cannot hide an amount. Small caps use a leader; crowded labels move outward.
  const amountLabels: { key: string; text: string; x: number; y: number; anchorX: number; anchorY: number; width: number; income: boolean; detached: boolean }[] = [];
  for (const day of cells) {
    for (const income of [false, true]) {
      const amount = income ? day.incomeTotal : day.total;
      if (amount <= 0) continue;
      const z = income ? -6 - amount * scale : amount * scale;
      const [anchorX, anchorY] = project([day.x + 30, day.y + 24, z]);
      const text = money(amount);
      const width = text.length * 6.2 + 10;
      const cap = rectangle(day.x + 12, day.y + 6, 36, z).map(project);
      const capWidth = Math.max(...cap.map(p => p[0])) - Math.min(...cap.map(p => p[0]));
      const detached = income || amount * scale * view.zoom < 22 || capWidth < width + 8;
      const direction = income ? 1 : -1;
      let y = anchorY + (detached ? direction * 26 : 0);
      // Keep labels readable during orbit, zoom, and volume changes.
      while (amountLabels.some(label => Math.abs(label.x - anchorX) < (label.width + width) / 2 + 3 && Math.abs(label.y - y) < 18)) {
        y += direction * 18;
      }
      amountLabels.push({ key: `${day.date}-${income ? "income" : "spend"}`, text, x: anchorX, y, anchorX, anchorY, width, income, detached: detached || y !== anchorY });
    }
  }
  function zoom(delta: number) {
    setView(v => ({ ...v, zoom: Math.max(0.6, Math.min(1.8, v.zoom + delta)) }));
  }
  return <section className="spending-calendar" aria-label={`3D spending calendar for ${formatMonthLabel(month)}`}>
    <div className="calendar-heading">
      <div><p className="eyebrow">Spending in three dimensions</p><h3>{formatMonthLabel(month)}</h3></div>
      <div className="calendar-total"><span className="calendar-income-total">{money(calendar.incomeTotal)} incoming</span><strong>{money(calendar.total)}</strong><span>gross spending · {hideRent ? "excluding Rent" : "including Rent"}</span></div>
    </div>
    <div className="calendar-controls" aria-label="Calendar camera controls">
      <span>Drag to orbit · hold Space + drag to pan</span>
      <div>
        <button type="button" aria-pressed={hideRent} onClick={() => setHideRent(hidden => !hidden)}>Hide Rent</button>
        <button type="button" aria-label="Rotate calendar left" onClick={() => setView(v => ({ ...v, yaw: v.yaw - Math.PI / 8 }))}>↶</button>
        <button type="button" aria-label="Rotate calendar right" onClick={() => setView(v => ({ ...v, yaw: v.yaw + Math.PI / 8 }))}>↷</button>
        <button type="button" aria-label="Zoom out calendar" disabled={view.zoom <= 0.6} onClick={() => zoom(-0.2)}>−</button>
        <span>{Math.round(view.zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in calendar" disabled={view.zoom >= 1.8} onClick={() => zoom(0.2)}>+</button>
        <button type="button" onClick={() => setView(INITIAL_VIEW)}>Reset view</button>
      </div>
    </div>
    <label className="calendar-volume-control">
      <span>Volume scale</span>
      <input type="range" min="0.25" max="3" step="0.05" value={volumeScale}
        aria-label="Calendar volume scale" aria-valuetext={`${Math.round(volumeScale * 100)} percent`}
        onChange={event => setVolumeScale(Number(event.target.value))} />
      <output>{Math.round(volumeScale * 100)}%</output>
      <button type="button" onClick={() => setVolumeScale(1)} disabled={volumeScale === 1}>Reset scale</button>
    </label>
    <div className="calendar-stage" data-has-income={calendar.incomeTotal > 0}>
      <svg ref={svgRef} data-pan-ready={panReady} viewBox="0 0 940 590" role="group" aria-label="Interactive 3D calendar. Drag to orbit; hold Space and drag to pan. Arrow keys rotate and tilt; plus and minus zoom; Home resets."
        tabIndex={0}
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return;
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "Home"].includes(event.key)) return;
          event.preventDefault();
          if (event.key === "Home") setView(INITIAL_VIEW);
          else if (event.key === "+" || event.key === "=") zoom(0.2);
          else if (event.key === "-") zoom(-0.2);
          else setView(v => ({ ...v, yaw: v.yaw + (event.key === "ArrowLeft" ? -0.15 : event.key === "ArrowRight" ? 0.15 : 0), tilt: Math.max(0.3, Math.min(1.35, v.tilt + (event.key === "ArrowUp" ? 0.1 : event.key === "ArrowDown" ? -0.1 : 0))) }));
        }}
        onPointerDown={event => {
          if (!event.isPrimary || event.button !== 0) return;
          suppressClick.current = false;
          drag.current = { pan: spaceHeld.current, panX: view.panX, panY: view.panY, unitsPerPixel: 1 / (event.currentTarget.getScreenCTM()?.a || 1), x: event.clientX, y: event.clientY, yaw: view.yaw, tilt: view.tilt, moved: false, id: event.pointerId };
        }}
        onPointerMove={event => {
          const start = drag.current;
          if (!start || start.id !== event.pointerId) return;
          const dx = event.clientX - start.x, dy = event.clientY - start.y;
          if (Math.hypot(dx, dy) > 4) start.moved = true;
          if (!start.moved) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          suppressClick.current = true;
          if (start.pan) {
            setView(v => ({ ...v, panX: start.panX + dx * start.unitsPerPixel, panY: start.panY + dy * start.unitsPerPixel }));
            return;
          }
          setView(v => ({ ...v, yaw: start.yaw + dx * 0.008, tilt: Math.max(0.3, Math.min(1.35, start.tilt - dy * 0.006)) }));
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onLostPointerCapture={() => { drag.current = null; }}
        onPointerEnter={() => { hovering.current = true; }}
        onPointerLeave={() => { hovering.current = false; if (drag.current && !drag.current.moved) drag.current = null; }}>
        <title>{formatMonthLabel(month)} daily spending, stacked by category</title>
        <polygon className="calendar-foundation" points={points([[-245, -calendar.weeks * 33 - 16, -6], [235, -calendar.weeks * 33 - 16, -6], [235, calendar.weeks * 33 + 10, -6], [-245, calendar.weeks * 33 + 10, -6]])} />
        {cells.filter(day => day.incomeTotal > 0).map(day => {
          const top = rectangle(day.x + 12, day.y + 6, 36, -6);
          const bottom = rectangle(day.x + 12, day.y + 6, 36, -6 - day.incomeTotal * scale);
          return <g key={`income-${day.date}`} className="calendar-income-block" pointerEvents="none">
            {[0, 1, 2, 3].filter(i => [-cos, sin, cos, -sin][i] > 0).map(i => {
              const next = (i + 1) % 4;
              return <polygon key={i} points={points([bottom[i], bottom[next], top[next], top[i]])}
                fill={`color-mix(in srgb, var(--positive) ${i % 2 === 0 ? 80 : 60}%, var(--surface-sunken))`}
                stroke="var(--positive)" strokeWidth="0.6" />;
            })}
          </g>;
        })}
        {WEEKDAYS.map((name, index) => {
          const [x, y] = project([(index - 3) * 66 - 3, -calendar.weeks * 33 - 28, 0]);
          return <text key={name} x={x} y={y} className="calendar-weekday" textAnchor="middle">{name}</text>;
        })}
        {cells.map(day => {
          let height = 0;
          const segments = [...day.categories].sort(([a], [b]) => a.localeCompare(b)).map(([name, amount]) => {
            const bottom = height;
            height += amount * scale;
            return { name, amount, bottom, top: height };
          });
          const label = project([day.x + 8, day.y + 56, 0]);
          return <g key={day.date} role="button" tabIndex={0} className="calendar-day" aria-pressed={selected === day.date}
            aria-label={`${day.date}: ${money(day.total)} spent, ${money(day.incomeTotal)} incoming, ${day.count} expenses, ${day.incomeCount} deposits`}
            onClick={() => { if (!suppressClick.current) setSelected(day.date); }}
            onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); setSelected(day.date); } }}>
            <title>{`${day.date} · ${money(day.total)} spent · ${money(day.incomeTotal)} incoming${segments.map(s => `\n${s.name}: ${money(s.amount)}`).join("")}`}</title>
            <polygon className={`calendar-tile ${selected === day.date ? "selected" : ""}`} points={points(rectangle(day.x, day.y, 60, 0))} />
            {segments.map(segment => {
              const bottom = rectangle(day.x + 12, day.y + 6, 36, segment.bottom);
              const top = rectangle(day.x + 12, day.y + 6, 36, segment.top);
              const color = calendarCategoryColor(segment.name);
              return <g key={segment.name} opacity={activeCategory && activeCategory !== segment.name ? 0.15 : 1}>
                {[0, 1, 2, 3].filter(i => [ -cos, sin, cos, -sin ][i] > 0).map(i => {
                  const next = (i + 1) % 4;
                  return <polygon key={i} points={points([bottom[i], bottom[next], top[next], top[i]])} fill={`color-mix(in srgb, ${color} ${i % 2 === 0 ? 78 : 58}%, var(--ink))`} />;
                })}
                <polygon points={points(top)} fill={color} stroke="var(--panel)" strokeWidth="0.35" />
              </g>;
            })}
            <text x={label[0]} y={label[1]} className="calendar-day-number">{day.day}{day.incomeTotal > 0 ? " ↓" : ""}</text>
          </g>;
        })}
        <g className="calendar-amount-labels" pointerEvents="none" aria-hidden="true">
          {amountLabels.map(label => <g key={label.key} className={label.income ? "calendar-amount income" : "calendar-amount"}>
            {label.detached ? <line x1={label.anchorX} y1={label.anchorY} x2={label.x} y2={label.y} /> : null}
            <rect x={label.x - label.width / 2} y={label.y - 8} width={label.width} height={16} rx={4} />
            <text x={label.x} y={label.y} textAnchor="middle" dominantBaseline="central">{label.text}</text>
          </g>)}
        </g>
      </svg>
      <div className="calendar-scale">Above: spending · Below: income<br />Equal volume per dollar · largest daily total: {money(peak)}</div>
    </div>
    <div className="calendar-bottom">
      <div className="calendar-legend" aria-label="Spending categories">
        {calendar.incomeTotal > 0 ? <span className="calendar-income-key"><i style={{ background: "var(--positive)" }} />Income below · {money(calendar.incomeTotal)}</span> : null}
        {calendar.categories.map(([name, amount]) => <button type="button" key={name} aria-pressed={activeCategory === name}
          className={activeCategory && activeCategory !== name ? "dimmed" : ""}
          onClick={() => setCategory(current => current === name ? "" : name)}>
          <i style={{ background: calendarCategoryColor(name) }} /><span>{name}</span><strong>{money(amount)}</strong>
        </button>)}
        {calendar.total === 0 ? <p>No positive spending recorded on this month’s dates.</p> : null}
      </div>
      <div className="calendar-detail" aria-live="polite">
        <label>Explore a day<select aria-label="Calendar day" value={selectedDay?.date ?? ""} onChange={e => setSelected(e.target.value)}>
          <option value="">Select a day</option>
          {calendar.days.map(day => <option key={day.date} value={day.date}>{day.date} · spent {money(day.total)} · in {money(day.incomeTotal)}</option>)}
        </select></label>
        {selectedDay ? <><strong>{money(selectedDay.total)}</strong><p>{selectedDay.count} transactions · {selectedDay.date}</p>
          <p className="calendar-income-total">{money(selectedDay.incomeTotal)} incoming · {selectedDay.incomeCount} deposits</p>
          {[...selectedDay.incomeSources].map(([source, amount]) => <div className="calendar-detail-row" key={`income-${source}`}><span>↓ {source}</span><b>{money(amount)}</b></div>)}
          {[...selectedDay.categories].map(([name, amount]) => <div className="calendar-detail-row" key={name}><span>{name}</span><b>{money(amount)}</b></div>)}
        </> : <p>Pick a tile or tower to see the day’s category breakdown. Tap a category to highlight its blocks.</p>}
      </div>
    </div>
    {calendar.excludedIncomes > 0 ? <p className="calendar-excluded">{calendar.excludedIncomes} income rows outside this month, without valid dates, or with non-positive amounts are not plotted.</p> : null}
    {calendar.excluded > 0 ? <p className="calendar-excluded">{calendar.excluded} rows outside this calendar month, without a valid date, or with non-positive amounts are not plotted. {hideRent ? "Rent is excluded. " : ""}Amounts are before reimbursements.</p> : <p className="calendar-excluded">{hideRent ? "Rent is excluded. " : ""}Amounts are before reimbursements. Each month scales to its own busiest day.</p>}
  </section>;
}
