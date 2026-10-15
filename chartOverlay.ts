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

type LevelKind = 'level' | 'entry' | 'actual' | 'sl' | 'tp' | 'close';

export interface ChartLevel {
  kind: LevelKind;
  price: number;
  label: string;
  /** Overrides the kind color, e.g. close colored by the result */
  color?: string;
}

/** What happened after the setup: drawn on entry and close screenshots */
export interface DealOutcome {
  /** Real fill; absent = filled at the planned entry */
  actualEntry?: number;
  closePrice?: number;
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
  actual: '#9C27B0',
  sl: '#F23645',
  tp: '#089981',
  close: '#FF9800',
};

function formatSigned(value: number, digits: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

// Claude downsizes anything bigger anyway; keeps uploads well under its 5 MB image limit
const MAX_IMAGE_SIDE = 2560;
// About half the size of PNG with candles and price labels still crisp
const IMAGE_TYPE = 'image/webp';
const IMAGE_QUALITY = 0.8;

export function buildLevels(
  entryRaw: number,
  calc: CalcLevels,
  direction: 'long' | 'short',
  outcome: DealOutcome = {},
): ChartLevel[] {
  const ownStop = calc.entryPriceByStop !== undefined && calc.stopLossByStop !== undefined;
  const entry = ownStop && calc.entryPriceByStop !== undefined ? calc.entryPriceByStop : calc.entryPrice;
  const stop = ownStop && calc.stopLossByStop !== undefined ? calc.stopLossByStop : calc.stopLossDefault;
  const takes = ownStop
    ? [calc.takeProfitByStop, calc.takeProfitByStop2, calc.takeProfitByStop3]
    : [calc.takeProfitDefault];
  const sign = direction === 'long' ? 1 : -1;
  // R of targets and result is measured from the real fill
  const filled = outcome.actualEntry ?? entry;
  const risk = Math.abs(filled - stop);

  const levels: ChartLevel[] = [];
  if (entryRaw !== entry) levels.push({ kind: 'level', price: entryRaw, label: 'Уровень' });
  levels.push({ kind: 'entry', price: entry, label: outcome.actualEntry !== undefined ? 'Entry план' : 'Entry' });
  if (outcome.actualEntry !== undefined && outcome.actualEntry !== entry) {
    // Positive = worse for the trader, same convention as the backend
    const slippage = sign * (outcome.actualEntry - entry) / entry * 100;
    levels.push({ kind: 'actual', price: outcome.actualEntry, label: `Вход факт · ${formatSigned(slippage, 2)}%` });
  }
  levels.push({ kind: 'sl', price: stop, label: 'SL' });
  takes.forEach((price, i) => {
    if (price === undefined) return;
    const r = risk > 0 ? ` · ${(Math.abs(price - filled) / risk).toFixed(1)}R` : '';
    levels.push({ kind: 'tp', price, label: `TP${takes.length > 1 ? i + 1 : ''}${r}` });
  });
  if (outcome.closePrice !== undefined) {
    const result = risk > 0 ? sign * (outcome.closePrice - filled) / risk : 0;
    levels.push({
      kind: 'close',
      price: outcome.closePrice,
      label: `Close${risk > 0 ? ` · ${formatSigned(result, 1)}R` : ''}`,
      color: result > 0 ? COLORS.tp : result < 0 ? COLORS.sl : COLORS.level,
    });
  }
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

/** Values of the ATR ZY Pine indicator, read from its ZY_* plots */
export interface ZyValues {
  atr: number;
  passRoad: number;
  dayOpen: number;
}

interface IndicatorReading {
  activeSymbol: string;
  charts: Array<{ symbol: string; zy: number[] | null }>;
}

/** Runs inside the TradingView page (MAIN world): self-contained, read-only */
function readIndicatorInPage(): IndicatorReading | null {
  interface TvStudy {
    data(): { last(): { value: number[] } | null };
    metaInfo(): { plots: Array<{ id: string }>; styles?: Record<string, { title?: string }> };
  }
  interface TvChart {
    symbol(): string;
    getAllStudies(): Array<{ id: string; name: string }>;
    getStudyById(id: string): { _study?: TvStudy };
    getPanes(): Array<{ _chartWidget?: { _elMainTable?: HTMLElement } }>;
  }
  interface TvApi {
    chartsCount(): number;
    chart(index: number): TvChart;
    activeChart(): TvChart;
  }

  const api = (window as unknown as { TradingViewApi?: TvApi }).TradingViewApi;
  if (!api || typeof api.chartsCount !== 'function') return null;

  const NAME = /^ATR ZY/i;
  const TITLES = ['ZY_ATR', 'ZY_PASSROAD', 'ZY_DAY_OPEN'];

  // Last bar of the computed series, matched by plot title
  const fromData = (chart: TvChart): number[] | null => {
    for (const s of chart.getAllStudies()) {
      if (!NAME.test(s.name)) continue;
      const study = chart.getStudyById(s.id)._study;
      const row = study?.data().last()?.value;
      const meta = study?.metaInfo();
      if (!row || !meta) continue;
      const values = TITLES.map((title) => {
        const i = meta.plots.findIndex((p) => meta.styles?.[p.id]?.title === title);
        return i >= 0 ? Number(row[i + 1]) : NaN;
      });
      if (values.every(Number.isFinite)) return values;
    }
    return null;
  };

  // Status line "ATR ZY 7 3  5.80 4.05 259.44"; shows the hovered bar while the mouse is over the chart
  const fromLegend = (chart: TvChart): number[] | null => {
    const table = chart.getPanes()[0]?._chartWidget?._elMainTable;
    if (!table) return null;
    for (const item of Array.from(table.querySelectorAll('[class*="study-"]'))) {
      const title = item.querySelector('[class*="title"]')?.textContent?.trim() ?? '';
      if (!NAME.test(title)) continue;
      const values = Array.from(item.querySelectorAll('[class*="valueValue"]'))
        .map((v) => Number((v.textContent ?? '').replace(/[\s,]/g, '').replace('\u2212', '-')))
        .slice(0, 3);
      if (values.length === 3 && values.every(Number.isFinite)) return values;
    }
    return null;
  };

  const charts: IndicatorReading['charts'] = [];
  for (let i = 0; i < api.chartsCount(); i++) {
    try {
      const chart = api.chart(i);
      charts.push({ symbol: chart.symbol(), zy: fromData(chart) ?? fromLegend(chart) });
    } catch {
      continue;
    }
  }
  return { activeSymbol: api.activeChart().symbol(), charts };
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

export interface ChartIndicator {
  /** Ticker of the chart the trader works with, in the form format */
  ticker: string;
  /** ATR ZY values for that ticker; null when the indicator is not on any of its charts */
  zy: ZyValues | null;
}

/** Ticker of the active TradingView chart and its ATR ZY values; null outside TradingView */
export async function readChartIndicator(ticker?: string): Promise<ChartIndicator | null> {
  try {
    const tabId = await getTradingViewTabId();
    if (tabId === null) return null;
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: readIndicatorInPage });
    const reading = result?.result as IndicatorReading | null | undefined;
    if (!reading) return null;

    const target = normalizeSymbol(ticker ?? reading.activeSymbol);
    const values = reading.charts.find((c) => c.zy && normalizeSymbol(c.symbol) === target)?.zy;
    const [atr, passRoad, dayOpen] = values ?? [];
    const plausible = atr !== undefined && passRoad !== undefined && dayOpen !== undefined
      && atr > 0 && dayOpen > 0 && passRoad >= 0 && atr < dayOpen;

    return { ticker: target, zy: plausible ? { atr, passRoad, dayOpen } : null };
  } catch (err) {
    console.warn('Indicator read failed:', err);
    return null;
  }
}

function sameLayout(a: ChartLayout, b: ChartLayout): boolean {
  return a.charts.length === b.charts.length && a.charts.every((c, i) => {
    const d = b.charts[i];
    return d !== undefined && c.from === d.from && c.to === d.to && c.pane.y === d.pane.y && c.pane.h === d.pane.h;
  });
}

/** "BINANCE:BTCUSDT.P" → "BTCUSDT", the ticker format of the form */
export function normalizeSymbol(symbol: string): string {
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

/** x is the label's right edge, or its center when centered */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  fontSize: number,
  centered = false,
): void {
  ctx.font = `600 ${fontSize}px -apple-system, "Segoe UI", sans-serif`;
  const padX = fontSize * 0.5;
  const height = fontSize * 1.5;
  const width = ctx.measureText(text).width + padX * 2;
  const left = centered ? x - width / 2 : x - width;
  ctx.fillStyle = color;
  ctx.fillRect(left, y - height / 2, width, height);
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + padX, y);
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
  const entry = levels.find((l) => l.kind === 'actual') ?? levels.find((l) => l.kind === 'entry');
  const stop = levels.find((l) => l.kind === 'sl');
  const close = levels.find((l) => l.kind === 'close');
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

    // Realized move from the fill to the close, as a narrow strip at the right edge
    const closeY = close ? yOf(close.price) : null;
    if (close && closeY !== null) {
      const stripLeft = left + (right - left) * 0.9;
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = close.color ?? COLORS.close;
      ctx.fillRect(stripLeft, clamp(Math.min(entryY, closeY)), right - stripLeft,
        clamp(Math.max(entryY, closeY)) - clamp(Math.min(entryY, closeY)));
      ctx.globalAlpha = 1;
    }
  }

  const fontSize = (isEntry ? 12 : 11) * k;
  const labelGap = fontSize * 1.6;
  const placed: number[] = [];
  const offscreen: { above: string[]; below: string[] } = { above: [], below: [] };

  const sorted = [...levels].sort((a, b) => b.price - a.price);
  for (const level of sorted) {
    const y = yOf(level.price);
    const color = level.color ?? COLORS[level.kind];
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

  // Levels outside the visible range: only worth a marker on the entry timeframe.
  // Centered, so the corners stay free for the legend and indicator tables
  if (isEntry) {
    const center = (left + right) / 2;
    if (offscreen.above.length > 0) {
      drawLabel(ctx, `↑ ${offscreen.above.join(' · ')}`, center, top + fontSize, COLORS.level, fontSize, true);
    }
    if (offscreen.below.length > 0) {
      drawLabel(ctx, `↓ ${offscreen.below.join(' · ')}`, center, bottom - fontSize, COLORS.level, fontSize, true);
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
  return out.toDataURL(IMAGE_TYPE, IMAGE_QUALITY);
}

async function compress(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  ctx.drawImage(img, 0, 0);
  return exportCanvas(canvas);
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
        if (!before || !after) {
          return { screenshot: await compress(screenshot), warning: 'График TradingView не распознан — линии не нарисованы' };
        }
        if (!sameLayout(before, after) && attempt < 2) continue;

        const result = await annotate(screenshot, after, ticker, levels);
        return result ?? { screenshot: await compress(screenshot), warning: `На графике нет ${ticker} — линии не нарисованы` };
      }
    }
  } catch (err) {
    console.warn('Chart overlay failed:', err);
  }
  return { screenshot: await compress(await captureScreenshot()) };
}
