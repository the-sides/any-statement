"use client";

import { useMemo, useRef, useState } from "react";
import { formatCurrency } from "@/lib/currency";
import { formatMonthLabel } from "@/lib/months";
import { calendarCategoryColor, summarizeCalendar, type CalendarExpense } from "@/lib/spendingCalendar";

const INITIAL_VIEW = { yaw: -Math.PI / 4, tilt: Math.atan(1 / Math.sqrt(2)), zoom: 1 };
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
type Point = [number, number, number];

export default function SpendingCalendar({ month, expenses, currency }: {
  month: string; expenses: readonly CalendarExpense[]; currency: string;
}) {
  const calendar = useMemo(() => summarizeCalendar(month, expenses), [month, expenses]);
  const [view, setView] = useState(INITIAL_VIEW);
  const [selected, setSelected] = useState("");
  const [category, setCategory] = useState("");
  const drag = useRef<{ x: number; y: number; yaw: number; tilt: number; moved: boolean; id: number } | null>(null);
  const suppressClick = useRef(false);
  if (!calendar) return null;
  const money = (amount: number) => formatCurrency(amount, currency);
  const selectedDay = calendar.days.find(day => day.date === selected);
  const activeCategory = calendar.categories.some(([name]) => name === category) ? category : "";
  const scale = calendar.peak > 0 ? 125 / calendar.peak : 0;
  const cos = Math.cos(view.yaw), sin = Math.sin(view.yaw);
  const depth = (x: number, y: number) => x * sin + y * cos;
  function project([x, y, z]: Point): [number, number] {
    return [470 + (x * cos - y * sin) * view.zoom,
      320 + (depth(x, y) * Math.sin(view.tilt) - z * Math.cos(view.tilt)) * view.zoom];
  }
  const points = (vertices: Point[]) => vertices.map(p => project(p).map(n => n.toFixed(2)).join(",")).join(" ");
  const rectangle = (x: number, y: number, size: number, z: number): Point[] =>
    [[x, y, z], [x + size, y, z], [x + size, y + size, z], [x, y + size, z]];
  const cells = calendar.days.map(day => {
    const position = calendar.offset + day.day - 1;
    return { ...day, x: (position % 7 - 3.5) * 66, y: (Math.floor(position / 7) - calendar.weeks / 2) * 66 };
  }).sort((a, b) => depth(a.x, a.y) - depth(b.x, b.y));
  function zoom(delta: number) {
    setView(v => ({ ...v, zoom: Math.max(0.6, Math.min(1.8, v.zoom + delta)) }));
  }
  return <section className="spending-calendar" aria-label={`3D spending calendar for ${formatMonthLabel(month)}`}>
    <div className="calendar-heading">
      <div><p className="eyebrow">Spending in three dimensions</p><h3>{formatMonthLabel(month)}</h3></div>
      <div className="calendar-total"><strong>{money(calendar.total)}</strong><span>gross spending · by transaction date</span></div>
    </div>
    <div className="calendar-controls" aria-label="Calendar camera controls">
      <span>Drag to orbit · select a day to explore</span>
      <div>
        <button type="button" aria-label="Rotate calendar left" onClick={() => setView(v => ({ ...v, yaw: v.yaw - Math.PI / 8 }))}>↶</button>
        <button type="button" aria-label="Rotate calendar right" onClick={() => setView(v => ({ ...v, yaw: v.yaw + Math.PI / 8 }))}>↷</button>
        <button type="button" aria-label="Zoom out calendar" disabled={view.zoom <= 0.6} onClick={() => zoom(-0.2)}>−</button>
        <span>{Math.round(view.zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in calendar" disabled={view.zoom >= 1.8} onClick={() => zoom(0.2)}>+</button>
        <button type="button" onClick={() => setView(INITIAL_VIEW)}>Reset view</button>
      </div>
    </div>
    <div className="calendar-stage">
      <svg viewBox="0 0 940 590" role="group" aria-label="Interactive 3D calendar. Drag to orbit. Arrow keys rotate and tilt; plus and minus zoom; Home resets."
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
          drag.current = { x: event.clientX, y: event.clientY, yaw: view.yaw, tilt: view.tilt, moved: false, id: event.pointerId };
        }}
        onPointerMove={event => {
          const start = drag.current;
          if (!start || start.id !== event.pointerId) return;
          const dx = event.clientX - start.x, dy = event.clientY - start.y;
          if (Math.hypot(dx, dy) > 4) start.moved = true;
          if (!start.moved) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          suppressClick.current = true;
          setView(v => ({ ...v, yaw: start.yaw + dx * 0.008, tilt: Math.max(0.3, Math.min(1.35, start.tilt - dy * 0.006)) }));
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onLostPointerCapture={() => { drag.current = null; }}
        onPointerLeave={() => { if (drag.current && !drag.current.moved) drag.current = null; }}>
        <title>{formatMonthLabel(month)} daily spending, stacked by category</title>
        <polygon className="calendar-foundation" points={points([[-245, -calendar.weeks * 33 - 16, -6], [235, -calendar.weeks * 33 - 16, -6], [235, calendar.weeks * 33 + 10, -6], [-245, calendar.weeks * 33 + 10, -6]])} />
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
            aria-label={`${day.date}: ${money(day.total)}, ${day.count} transactions`}
            onClick={() => { if (!suppressClick.current) setSelected(day.date); }}
            onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(day.date); } }}>
            <title>{`${day.date} · ${money(day.total)}${segments.map(s => `\n${s.name}: ${money(s.amount)}`).join("")}`}</title>
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
            <text x={label[0]} y={label[1]} className="calendar-day-number">{day.day}</text>
          </g>;
        })}
      </svg>
      <div className="calendar-scale">Equal footprints. Height ∝ spend.<br />Tallest day: {money(calendar.peak)}</div>
    </div>
    <div className="calendar-bottom">
      <div className="calendar-legend" aria-label="Spending categories">
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
          {calendar.days.map(day => <option key={day.date} value={day.date}>{day.date} · {money(day.total)}</option>)}
        </select></label>
        {selectedDay ? <><strong>{money(selectedDay.total)}</strong><p>{selectedDay.count} transactions · {selectedDay.date}</p>
          {[...selectedDay.categories].map(([name, amount]) => <div className="calendar-detail-row" key={name}><span>{name}</span><b>{money(amount)}</b></div>)}
        </> : <p>Pick a tile or tower to see the day’s category breakdown. Tap a category to highlight its blocks.</p>}
      </div>
    </div>
    {calendar.excluded > 0 ? <p className="calendar-excluded">{calendar.excluded} rows outside this calendar month, without a valid date, or with non-positive amounts are not plotted. Amounts are before reimbursements.</p> : <p className="calendar-excluded">Amounts are before reimbursements. Each month scales to its own busiest day.</p>}
  </section>;
}
