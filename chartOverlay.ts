import { captureScreenshot } from './screenshot.js';

/** Subset of the backend CalculationResult needed to draw the trade */
export interface CalcLevels {
  entryPrice: number;
  stopLossDefault: number;
  takeProfitDefault: number;
  entryPriceByStop?: number;
  stopLossByStop?: number;
  takeProfitByStop?: number;
  takeProfitByStop2?: number;
  takeProfitByStop3?: number;
}

type LevelKind = 'level' | 'entry' | 'sl' | 'tp';

export interface ChartLevel {
  kind: LevelKind;
  price: number;
  label: string;
}

/** Sent to the backend so Claude knows what each pane of the screenshot shows */
export interface ChartPaneInfo {
  symbol: string;
  interval: string;
  annotated: boolean;
  entry: boolean;
}

export interface ChartCapture {
  screenshot: string;
  screenshotFocus?: string;
  chart?: { panes: ChartPaneInfo[] };
  /** Why the levels were not drawn, to show in the popup */
  warning?: string;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Main price pane of one TradingView chart in the layout */
interface ChartGeometry {
  symbol: string;
  interval: string;
  /** 0 normal, 1 log, 2 percent, 3 indexed to 100 */
  mode: number;
  from: number;
  to: number;
  pane: Rect;
  /** Whole chart widget including price/time axes and indicator panes */
  widget: Rect;
}

interface ChartLayout {
  viewportWidth: number;
  charts: ChartGeometry[];
}

const COLORS: Record<LevelKind, string> = {
  level: '#787B86',
  entry: '#2962FF',
  sl: '#F23645',
  tp: '#089981',
};

// Claude downsizes anything bigger anyway; keeps uploads well under its 5 MB image limit
const MAX_IMAGE_SIDE = 2560;

export function buildLevels(entryRaw: number, calc: CalcLevels): ChartLevel[] {
  const ownStop = calc.entryPriceByStop !== undefined && calc.stopLossByStop !== undefined;
  const entry = ownStop && calc.entryPriceByStop !== undefined ? calc.entryPriceByStop : calc.entryPrice;
  const stop = ownStop && calc.stopLossByStop !== undefined ? calc.stopLossByStop : calc.stopLossDefault;
  const takes = ownStop
    ? [calc.takeProfitByStop, calc.takeProfitByStop2, calc.takeProfitByStop3]
    : [calc.takeProfitDefault];
  const risk = Math.abs(entry - stop);

  const levels: ChartLevel[] = [];
  if (entryRaw !== entry) levels.push({ kind: 'level', price: entryRaw, label: 'Уровень' });
  levels.push({ kind: 'entry', price: entry, label: 'Entry' });
  levels.push({ kind: 'sl', price: stop, label: 'SL' });
  takes.forEach((price, i) => {
    if (price === undefined) return;
    const r = risk > 0 ? ` · ${(Math.abs(price - entry) / risk).toFixed(1)}R` : '';
    levels.push({ kind: 'tp', price, label: `TP${takes.length > 1 ? i + 1 : ''}${r}` });
  });
  return levels;
}

/**
 * Runs inside the TradingView page (MAIN world): must stay self-contained, nothing from module scope.
 * Uses TradingView's internal API — only reads, never changes the chart.
 */
function readLayoutInPage(): ChartLayout | null {
  interface TvPriceScale {
    getVisiblePriceRange(): { from: number; to: number } | null;
    getMode(): number;
  }
  interface TvPane {
    hasMainSeries(): boolean;
    getMainSourcePriceScale(): TvPriceScale | null;
    getHeight(): number;
    paneIndex(): number;
    _chartWidget?: { _elMainTable?: HTMLElement };
  }
  interface TvChart {
    symbol(): string;
    resolution(): string;
    getPanes(): TvPane[];
  }
  interface TvApi {
    chartsCount(): number;
    chart(index: number): TvChart;
  }

  const api = (window as unknown as { TradingViewApi?: TvApi }).TradingViewApi;
  if (!api || typeof api.chartsCount !== 'function') return null;

  const toRect = (r: DOMRect) => ({ x: r.x, y: r.y, w: r.width, h: r.height });
  const containers = Array.from(document.querySelectorAll('.chart-container'));
  const charts: ChartGeometry[] = [];

  for (let i = 0; i < api.chartsCount(); i++) {
    try {
      const chart = api.chart(i);
      const panes = chart.getPanes();
      const pane = panes.find((p) => p.hasMainSeries()) ?? panes[0];
      const scale = pane?.getMainSourcePriceScale();
      const range = scale?.getVisiblePriceRange();
      if (!pane || !scale || !range) continue;

      // Internal link to the chart's DOM; layout order is the fallback
      const table = pane._chartWidget?._elMainTable ?? containers[i]?.querySelector('.chart-markup-table');
      const wrapper = table?.querySelectorAll('.chart-gui-wrapper')[pane.paneIndex()];
      if (!table || !wrapper) continue;

      const paneRect = wrapper.getBoundingClientRect();
      // Hidden chart, or the DOM pane is not the one the API describes
      if (paneRect.width === 0 || Math.abs(paneRect.height - pane.getHeight()) > 2) continue;

      charts.push({
        symbol: chart.symbol(),
        interval: chart.resolution(),
        mode: scale.getMode(),
        from: range.from,
        to: range.to,
        pane: toRect(paneRect),
        widget: toRect(table.getBoundingClientRect()),
      });
    } catch {
      continue;
    }
  }

  return { viewportWidth: window.innerWidth, charts };
}

async function getTradingViewTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !tab.url || !/^https:\/\/([a-z]+\.)?tradingview\.com\//.test(tab.url)) {
    return null;
  }
  return tab.id;
}

async function readLayout(tabId: number): Promise<ChartLayout | null> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: readLayoutInPage,
  });
  return (result?.result as ChartLayout | null | undefined) ?? null;
}

function sameLayout(a: ChartLayout, b: ChartLayout): boolean {
  return a.charts.length === b.charts.length && a.charts.every((c, i) => {
    const d = b.charts[i];
    return d !== undefined && c.from === d.from && c.to === d.to && c.pane.y === d.pane.y && c.pane.h === d.pane.h;
  });
}

function normalizeSymbol(symbol: string): string {
  const base = symbol.split(':').pop() ?? symbol;
  return base.toUpperCase().replace(/\.P$/, '').replace(/[^A-Z0-9]/g, '');
}

/** TradingView resolution in minutes: "5" → 5, "1D" → 1440, "30S" → 0.5 */
function intervalMinutes(interval: string): number {
  const match = /^(\d*)([SDWMT]?)$/.exec(interval.toUpperCase());
  if (!match) return Number.MAX_SAFE_INTEGER;
  const n = match[1] ? Number(match[1]) : 1;
  const unit: Record<string, number> = { '': 1, S: 1 / 60, T: 1 / 1000, D: 1440, W: 10080, M: 43200 };
  return n * (unit[match[2] ?? ''] ?? 1);
}

function priceToY(chart: ChartGeometry, price: number): number | null {
  const { from, to, pane } = chart;
  if (chart.mode === 1) {
    if (from <= 0 || price <= 0) return null;
    return pane.y + (Math.log(to) - Math.log(price)) / (Math.log(to) - Math.log(from)) * pane.h;
  }
  return pane.y + (to - price) / (to - from) * pane.h;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = dataUrl;
  return img.decode().then(() => img);
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  right: number,
  y: number,
  color: string,
  fontSize: number,
): void {
  ctx.font = `600 ${fontSize}px -apple-system, "Segoe UI", sans-serif`;
  const padX = fontSize * 0.5;
  const height = fontSize * 1.5;
  const width = ctx.measureText(text).width + padX * 2;
  ctx.fillStyle = color;
  ctx.fillRect(right - width, y - height / 2, width, height);
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, right - width + padX, y);
}

function drawChartLevels(
  ctx: CanvasRenderingContext2D,
  chart: ChartGeometry,
  levels: ChartLevel[],
  k: number,
  isEntry: boolean,
): void {
  const left = chart.pane.x * k;
  const right = (chart.pane.x + chart.pane.w) * k;
  const top = chart.pane.y * k;
  const bottom = (chart.pane.y + chart.pane.h) * k;
  const clamp = (y: number) => Math.min(bottom, Math.max(top, y));
  const yOf = (price: number) => {
    const y = priceToY(chart, price);
    return y === null ? null : y * k;
  };

  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, right - left, bottom - top);
  ctx.clip();

  // Risk/reward zones on the right side, like TradingView's position tool
  const entry = levels.find((l) => l.kind === 'entry');
  const stop = levels.find((l) => l.kind === 'sl');
  const takes = levels.filter((l) => l.kind === 'tp');
  const farTake = takes[takes.length - 1];
  const entryY = entry ? yOf(entry.price) : null;
  if (isEntry && entryY !== null) {
    const zoneLeft = left + (right - left) * 0.7;
    const zones: Array<[ChartLevel | undefined, string]> = [
      [stop, 'rgba(242, 54, 69, 0.14)'],
      [farTake, 'rgba(8, 153, 129, 0.14)'],
    ];
    for (const [level, fill] of zones) {
      const y = level ? yOf(level.price) : null;
      if (y === null) continue;
      const y1 = clamp(Math.min(entryY, y));
      const y2 = clamp(Math.max(entryY, y));
      ctx.fillStyle = fill;
      ctx.fillRect(zoneLeft, y1, right - zoneLeft, y2 - y1);
    }
  }

  const fontSize = (isEntry ? 12 : 11) * k;
  const labelGap = fontSize * 1.6;
  const placed: number[] = [];
  const offscreen: { above: string[]; below: string[] } = { above: [], below: [] };

  const sorted = [...levels].sort((a, b) => b.price - a.price);
  for (const level of sorted) {
    const y = yOf(level.price);
    const color = COLORS[level.kind];
    const text = `${level.label} ${level.price}`;
    if (y === null || y < top || y > bottom) {
      if (y !== null) (y < top ? offscreen.above : offscreen.below).push(text);
      continue;
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = (isEntry ? 2 : 1.25) * k;
    ctx.setLineDash(level.kind === 'level' ? [6 * k, 4 * k] : []);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();

    // Keep labels of close levels from overlapping
    let labelY = y;
    const prev = placed[placed.length - 1];
    if (prev !== undefined && labelY - prev < labelGap) labelY = prev + labelGap;
    placed.push(labelY);
    drawLabel(ctx, text, right - 4 * k, labelY, color, fontSize);
  }
  ctx.setLineDash([]);

  // Levels outside the visible range: only worth a marker on the entry timeframe
  if (isEntry) {
    if (offscreen.above.length > 0) {
      drawLabel(ctx, `↑ ${offscreen.above.join(' · ')}`, right - 4 * k, top + fontSize, COLORS.level, fontSize);
    }
    if (offscreen.below.length > 0) {
      drawLabel(ctx, `↓ ${offscreen.below.join(' · ')}`, right - 4 * k, bottom - fontSize, COLORS.level, fontSize);
    }
  }

  ctx.restore();
}

function exportCanvas(source: HTMLCanvasElement, crop?: Rect): string {
  const area = crop ?? { x: 0, y: 0, w: source.width, h: source.height };
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(area.w, area.h));
  const out = document.createElement('canvas');
  out.width = Math.round(area.w * scale);
  out.height = Math.round(area.h * scale);
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  ctx.drawImage(source, area.x, area.y, area.w, area.h, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

async function annotate(
  dataUrl: string,
  layout: ChartLayout,
  ticker: string,
  levels: ChartLevel[],
): Promise<ChartCapture | null> {
  const target = normalizeSymbol(ticker);
  // Percent/indexed scales are not in price units
  const annotated = layout.charts.filter((c) => normalizeSymbol(c.symbol) === target && c.mode <= 1);
  if (annotated.length === 0) return null;

  const entryChart = annotated.reduce((min, c) =>
    intervalMinutes(c.interval) < intervalMinutes(min.interval) ? c : min);

  const img = await loadImage(dataUrl);
  const k = img.width / layout.viewportWidth;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  ctx.drawImage(img, 0, 0);

  for (const chart of annotated) {
    drawChartLevels(ctx, chart, levels, k, chart === entryChart);
  }

  const w = entryChart.widget;

  return {
    screenshot: exportCanvas(canvas),
    screenshotFocus: exportCanvas(canvas, { x: w.x * k, y: w.y * k, w: w.w * k, h: w.h * k }),
    chart: {
      panes: layout.charts.map((c) => ({
        symbol: c.symbol,
        interval: c.interval,
        annotated: annotated.includes(c),
        entry: c === entryChart,
      })),
    },
  };
}

/**
 * Screenshot of the active tab with entry/SL/TP drawn over every TradingView chart of the ticker.
 * Falls back to the plain screenshot whenever the chart can't be read.
 */
export async function captureChart(ticker: string, levels: ChartLevel[] | null): Promise<ChartCapture> {
  try {
    const tabId = levels ? await getTradingViewTabId() : null;
    if (levels && tabId !== null) {
      // A live chart can rescale between reading and capturing — retry until both reads agree
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = await readLayout(tabId);
        const screenshot = await captureScreenshot();
        const after = await readLayout(tabId);
        if (!before || !after) return { screenshot, warning: 'График TradingView не распознан — линии не нарисованы' };
        if (!sameLayout(before, after) && attempt < 2) continue;

        const result = await annotate(screenshot, after, ticker, levels);
        return result ?? { screenshot, warning: `На графике нет ${ticker} — линии не нарисованы` };
      }
    }
  } catch (err) {
    console.warn('Chart overlay failed:', err);
  }
  return { screenshot: await captureScreenshot() };
}
