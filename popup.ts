import { getChecklistForStrategy, loadChecklist } from './checklists/index.js';
import { Strategy, MarketType, Direction, ChecklistSnapshot, FormPayload } from './checklists/types.js';
import {
  BASE_URL,
  API_KEY_STORAGE_KEY,
  DEVICE_ID_STORAGE_KEY,
  checkApiKey,
  getApiHeaders,
  getStoredApiKey,
} from './config.js';
import { buildLevels, captureChart, readChartIndicator } from './chartOverlay.js';
import type { CalcLevels, ChartCapture, ChartLevel, DealOutcome } from './chartOverlay.js';

const ALL_STORAGE_KEYS = [
  'ticker', 'marketType', 'strategy', 'direction',
  'riskPercent', 'ratio', 'luftPercent', 'riskSum', 'inPlay',
  'entryRaw', 'customStop', 'atrOverride', 'passRoadOverride',
  'checklistPlus', 'checklistMinus', 'checklistWait',
  'lastDealId',
] as const;

const SUBMIT_CLEAR_KEYS: Array<typeof ALL_STORAGE_KEYS[number]> = [
  'entryRaw', 'customStop', 'atrOverride', 'passRoadOverride',
  'checklistPlus', 'checklistMinus', 'checklistWait',
];

let selectedPlus: Set<string> = new Set();
let selectedMinus: Set<string> = new Set();
let selectedWait: Set<string> = new Set();
let currentStrategy: Strategy = 'Пробой';
let currentDirection: Direction = 'long';
// Values last put into the form from the ATR ZY indicator; refreshed on submit unless edited by hand
let indicatorFill: { atr: string; passRoad: string } | null = null;
let chartDayOpen: number | undefined;

// ─── Checklist ────────────────────────────────────────────────────────────────

function saveChecklistToStorage(): void {
  chrome.storage.local.set({
    checklistPlus: Array.from(selectedPlus),
    checklistMinus: Array.from(selectedMinus),
    checklistWait: Array.from(selectedWait),
  });
}

function renderChecklist(
  strategy: Strategy,
  savedPlus: string[] = [],
  savedMinus: string[] = [],
  savedWait: string[] = [],
): void {
  const checklist = getChecklistForStrategy(strategy);

  selectedPlus.clear();
  selectedMinus.clear();
  selectedWait.clear();

  const plusContainer = document.getElementById('checklist-plus')!;
  const minusContainer = document.getElementById('checklist-minus')!;
  const waitContainer = document.getElementById('checklist-wait')!;

  plusContainer.innerHTML = '';
  minusContainer.innerHTML = '';
  waitContainer.innerHTML = '';

  checklist.ПРЕДПОСЫЛКИ.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'tag';
    btn.textContent = item.label;
    btn.dataset['key'] = item.key;
    if (savedPlus.includes(item.key)) {
      btn.classList.add('selected', 'plus');
      selectedPlus.add(item.key);
    }
    btn.addEventListener('click', () => {
      btn.classList.toggle('selected');
      if (btn.classList.contains('selected')) {
        btn.classList.add('plus');
        selectedPlus.add(item.key);
      } else {
        btn.classList.remove('plus');
        selectedPlus.delete(item.key);
      }
      updateChecklistCount();
      saveChecklistToStorage();
    });
    plusContainer.appendChild(btn);
  });

  checklist.МИНУСЫ.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'tag';
    btn.textContent = item.label;
    btn.dataset['key'] = item.key;
    if (savedMinus.includes(item.key)) {
      btn.classList.add('selected', 'minus');
      selectedMinus.add(item.key);
    }
    btn.addEventListener('click', () => {
      btn.classList.toggle('selected');
      if (btn.classList.contains('selected')) {
        btn.classList.add('minus');
        selectedMinus.add(item.key);
      } else {
        btn.classList.remove('minus');
        selectedMinus.delete(item.key);
      }
      updateChecklistCount();
      saveChecklistToStorage();
    });
    minusContainer.appendChild(btn);
  });

  checklist.ОЖИДАЮ.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'tag';
    btn.textContent = item.label;
    btn.dataset['key'] = item.key;
    if (savedWait.includes(item.key)) {
      btn.classList.add('selected', 'wait');
      selectedWait.add(item.key);
    }
    btn.addEventListener('click', () => {
      btn.classList.toggle('selected');
      if (btn.classList.contains('selected')) {
        btn.classList.add('wait');
        selectedWait.add(item.key);
      } else {
        btn.classList.remove('wait');
        selectedWait.delete(item.key);
      }
      updateChecklistCount();
      saveChecklistToStorage();
    });
    waitContainer.appendChild(btn);
  });

  updateChecklistCount();
}

function updateChecklistCount(): void {
  const total = selectedPlus.size + selectedMinus.size + selectedWait.size;
  document.getElementById('checklist-count')!.textContent = String(total);
}

// ─── Direction ────────────────────────────────────────────────────────────────

function setDirection(dir: Direction): void {
  currentDirection = dir;
  const btnLong = document.getElementById('btn-long') as HTMLButtonElement;
  const btnShort = document.getElementById('btn-short') as HTMLButtonElement;
  if (dir === 'long') {
    btnLong.classList.add('active', 'long-active');
    btnLong.classList.remove('short-active');
    btnShort.classList.remove('active', 'long-active', 'short-active');
  } else {
    btnShort.classList.add('active', 'short-active');
    btnShort.classList.remove('long-active');
    btnLong.classList.remove('active', 'long-active', 'short-active');
  }
}

// ─── Payload ──────────────────────────────────────────────────────────────────

function collectPayload(): FormPayload {
  const checklist: ChecklistSnapshot = {
    plus: Array.from(selectedPlus),
    minus: Array.from(selectedMinus),
    wait: Array.from(selectedWait),
  };

  const atrOverrideVal = parseFloat(
    (document.getElementById('atrOverride') as HTMLInputElement).value
  );
  const passRoadOverrideVal = parseFloat(
    (document.getElementById('passRoadOverride') as HTMLInputElement).value
  );

  return {
    ticker: (document.getElementById('ticker') as HTMLInputElement).value.trim().toUpperCase(),
    marketType: (document.getElementById('marketType') as HTMLSelectElement).value as MarketType,
    strategy: currentStrategy,
    direction: currentDirection,
    entryRaw: parseFloat((document.getElementById('entryRaw') as HTMLInputElement).value),
    customStop: parseFloat((document.getElementById('customStop') as HTMLInputElement).value) || undefined,
    atrOverride:      !isNaN(atrOverrideVal) && atrOverrideVal > 0 ? atrOverrideVal : undefined,
    passRoadOverride: !isNaN(passRoadOverrideVal) && passRoadOverrideVal > 0 ? passRoadOverrideVal : undefined,
    riskPercent: parseFloat((document.getElementById('riskPercent') as HTMLInputElement).value),
    ratio: parseFloat((document.getElementById('ratio') as HTMLInputElement).value),
    luftPercent: parseFloat((document.getElementById('luftPercent') as HTMLInputElement).value),
    riskSum: parseFloat((document.getElementById('riskSum') as HTMLInputElement).value),
    inPlay: (document.getElementById('inPlay') as HTMLInputElement).checked,
    dayOpen: chartDayOpen,
    checklist: checklist.plus.length + checklist.minus.length + checklist.wait.length > 0
      ? checklist
      : undefined,
  };
}

function validatePayload(payload: FormPayload): string | null {
  if (!payload.ticker) return 'Укажите тикер';
  if (!payload.entryRaw || payload.entryRaw <= 0) return 'Укажите уровень входа (> 0)';
  if (payload.customStop !== undefined && payload.customStop <= 0) return 'SL уровень должен быть > 0';
  if (payload.marketType === 'crypto' && !payload.atrOverride) {
    return '⚠️ Для крипты укажи ATR из TradingView лейбла';
  }
  return null;
}

// ─── ATR ZY indicator ─────────────────────────────────────────────────────────

/**
 * Fills ticker, ATR and passRoad from the TradingView chart.
 * withTicker: take the ticker of the active chart; otherwise read values for the ticker in the form.
 */
async function syncFromChart(withTicker: boolean): Promise<void> {
  const tickerInput = document.getElementById('ticker') as HTMLInputElement;
  const atrInput = document.getElementById('atrOverride') as HTMLInputElement;
  const passRoadInput = document.getElementById('passRoadOverride') as HTMLInputElement;

  const chart = await readChartIndicator(withTicker ? undefined : tickerInput.value);
  if (!chart) return;

  if (withTicker && chart.ticker && chart.ticker !== tickerInput.value) {
    tickerInput.value = chart.ticker;
    await chrome.storage.local.set({ ticker: chart.ticker });
  }

  chartDayOpen = chart.zy?.dayOpen;
  if (!chart.zy) {
    indicatorFill = null;
    return;
  }

  const atr = String(Number(chart.zy.atr.toPrecision(8)));
  const passRoad = chart.zy.passRoad.toFixed(2);
  atrInput.value = atr;
  passRoadInput.value = passRoad;
  indicatorFill = { atr, passRoad };
  await chrome.storage.local.set({ atrOverride: atr, passRoadOverride: passRoad });
}

/** True while ATR/passRoad still hold what the indicator put there */
function indicatorFillIntact(): boolean {
  return indicatorFill !== null
    && (document.getElementById('atrOverride') as HTMLInputElement).value === indicatorFill.atr
    && (document.getElementById('passRoadOverride') as HTMLInputElement).value === indicatorFill.passRoad;
}

// ─── Status ───────────────────────────────────────────────────────────────────

function showStatus(type: 'loading' | 'success' | 'error', message: string): void {
  const el = document.getElementById('status')!;
  el.className = `status ${type}`;
  el.textContent = message;
  if (type === 'success') {
    setTimeout(() => { el.className = 'status hidden'; }, 3000);
  }
}

function showDealStatus(type: 'loading' | 'success' | 'error', message: string): void {
  const el = document.getElementById('deal-status');
  if (!el) return;
  el.className = `status ${type}`;
  el.textContent = message;
  if (type === 'success') {
    setTimeout(() => { el.className = 'status hidden'; }, 3000);
  }
}

// ─── Clear ────────────────────────────────────────────────────────────────────

async function clearAll(): Promise<void> {
  const keep = await chrome.storage.local.get([API_KEY_STORAGE_KEY, DEVICE_ID_STORAGE_KEY]);
  await chrome.storage.local.clear();
  await chrome.storage.local.set(keep);

  (document.getElementById('ticker') as HTMLInputElement).value = '';
  (document.getElementById('marketType') as HTMLSelectElement).value = 'crypto';
  (document.getElementById('strategy') as HTMLSelectElement).value = 'Пробой';
  (document.getElementById('entryRaw') as HTMLInputElement).value = '';
  (document.getElementById('customStop') as HTMLInputElement).value = '';
  (document.getElementById('atrOverride') as HTMLInputElement).value = '';
  (document.getElementById('passRoadOverride') as HTMLInputElement).value = '';
  (document.getElementById('riskPercent') as HTMLInputElement).value = '15';
  (document.getElementById('ratio') as HTMLInputElement).value = '3';
  (document.getElementById('luftPercent') as HTMLInputElement).value = '20';
  (document.getElementById('riskSum') as HTMLInputElement).value = '15';
  (document.getElementById('inPlay') as HTMLInputElement).checked = false;
  (document.getElementById('deal-id') as HTMLInputElement).value = '';
  (document.getElementById('close-price') as HTMLInputElement).value = '';
  (document.getElementById('actual-entry') as HTMLInputElement).value = '';

  currentStrategy = 'Пробой';
  setDirection('long');
  renderChecklist(currentStrategy);

  document.getElementById('status')!.className = 'status hidden';
  const dealStatus = document.getElementById('deal-status');
  if (dealStatus) dealStatus.className = 'status hidden';
}

// ─── Submit ───────────────────────────────────────────────────────────────────

function responseError(data: { error?: unknown; message?: unknown }, status: number): string {
  if (typeof data.error === 'string') return data.error;
  if (typeof data.message === 'string') return data.message;
  return `Ошибка ${status}`;
}

async function submitPayload(payload: FormPayload): Promise<void> {
  const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;
  submitBtn.disabled = true;

  try {
    showStatus('loading', 'Расчёт уровней...');
    const preview = await fetch(`${BASE_URL}/api/previewSetup`, {
      method: 'POST',
      headers: await getApiHeaders(),
      body: JSON.stringify(payload),
    });
    if (await handleUnauthorized(preview)) return;
    const previewData = await preview.json() as { calcResult?: CalcLevels; error?: unknown; message?: unknown };
    if (!preview.ok || !previewData.calcResult) throw new Error(responseError(previewData, preview.status));

    showStatus('loading', 'Создаём скриншот...');
    let capture: ChartCapture | undefined;
    try {
      capture = await captureChart(
        payload.ticker,
        buildLevels(payload.entryRaw, previewData.calcResult, payload.direction),
      );
    } catch (err) {
      console.warn('Screenshot failed:', err);
    }

    showStatus('loading', 'Отправка...');
    const response = await fetch(`${BASE_URL}/api/createNote`, {
      method: 'POST',
      headers: await getApiHeaders(),
      body: JSON.stringify({
        ...payload,
        screenshot: capture?.screenshot,
        screenshotFocus: capture?.screenshotFocus,
        chart: capture?.chart,
      }),
    });

    if (await handleUnauthorized(response)) return;
    const data = await response.json();

    if (!response.ok) throw new Error(responseError(data, response.status));

    await chrome.storage.local.remove(SUBMIT_CLEAR_KEYS);
    await chrome.storage.local.set({ lastDealId: String(data.id) });

    showStatus('success', `✅ Отправлено! ID: #${data.id}${capture?.warning ? ` · ${capture.warning}` : ''}`);

    (document.getElementById('entryRaw') as HTMLInputElement).value = '';
    (document.getElementById('customStop') as HTMLInputElement).value = '';
    (document.getElementById('atrOverride') as HTMLInputElement).value = '';
    (document.getElementById('passRoadOverride') as HTMLInputElement).value = '';
    renderChecklist(currentStrategy);

    const dealIdInput = document.getElementById('deal-id') as HTMLInputElement;
    if (dealIdInput) dealIdInput.value = String(data.id);

  } catch (err) {
    showStatus('error', `❌ ${(err as Error).message}`);
  } finally {
    submitBtn.disabled = false;
  }
}

// ─── Deal management ──────────────────────────────────────────────────────────

interface SavedDeal {
  ticker: string;
  direction: Direction;
  entryRaw: number;
  calcResult: CalcLevels;
  actualEntryPrice?: number;
}

/** Saved deal, to draw its levels on entry/close screenshots; null if unavailable */
async function fetchDeal(dealId: number): Promise<SavedDeal | null> {
  try {
    const response = await fetch(`${BASE_URL}/api/deals/${dealId}`, { headers: await getApiHeaders() });
    if (!response.ok) return null;
    const data = await response.json() as { deal?: SavedDeal };
    return data.deal ?? null;
  } catch {
    return null;
  }
}

function dealLevels(deal: SavedDeal | null, outcome: DealOutcome): ChartLevel[] | null {
  if (!deal) return null;
  return buildLevels(deal.entryRaw, deal.calcResult, deal.direction, {
    actualEntry: outcome.actualEntry ?? deal.actualEntryPrice,
    closePrice: outcome.closePrice,
  });
}

/** Optional real fill price; empty = filled at the planned entry */
function readActualEntry(): number | undefined {
  const value = parseFloat((document.getElementById('actual-entry') as HTMLInputElement).value);
  return value > 0 ? value : undefined;
}

async function handleDealAction(
  status: 'entered' | 'missed' | 'closed',
  withScreenshot = true,
  extra: { dealResult?: string; closePrice?: number; actualEntryPrice?: number } = {},
): Promise<void> {
  const dealId = parseInt((document.getElementById('deal-id') as HTMLInputElement).value);
  if (!dealId || isNaN(dealId)) {
    showDealStatus('error', '❌ Укажи ID сделки');
    return;
  }

  let screenshot: string | undefined;
  if (withScreenshot) {
    showDealStatus('loading', 'Создаём скриншот...');
    try {
      const deal = await fetchDeal(dealId);
      const levels = dealLevels(deal, { actualEntry: extra.actualEntryPrice, closePrice: extra.closePrice });
      screenshot = (await captureChart(deal?.ticker ?? '', levels)).screenshot;
    } catch (err) {
      console.warn('Screenshot failed:', err);
    }
  }

  showDealStatus('loading', 'Отправка...');

  try {
    const body: Record<string, unknown> = { id: dealId, status, screenshot, ...extra };

    const response = await fetch(`${BASE_URL}/api/updateDeal`, {
      method: 'POST',
      headers: await getApiHeaders(),
      body: JSON.stringify(body),
    });

    if (await handleUnauthorized(response)) return;
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `Ошибка ${response.status}`);
    }

    const labels: Record<string, string> = {
      entered: '✅ Вход зафиксирован',
      missed: '⏭ Сделка пропущена',
      closed: '🏁 Сделка закрыта',
    };

    showDealStatus('success', labels[status] ?? '✅ Готово');

    if (status === 'closed' || status === 'missed') {
      (document.getElementById('deal-id') as HTMLInputElement).value = '';
      (document.getElementById('close-price') as HTMLInputElement).value = '';
      (document.getElementById('actual-entry') as HTMLInputElement).value = '';
      await chrome.storage.local.remove('lastDealId');
    }

  } catch (err) {
    showDealStatus('error', `❌ ${(err as Error).message}`);
  }
}

// ─── Collapsible ──────────────────────────────────────────────────────────────

function setupCollapsible(headerId: string, bodyId: string): void {
  const header = document.getElementById(headerId)!;
  const body = document.getElementById(bodyId)!;
  header.addEventListener('click', () => {
    body.classList.toggle('collapsed');
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function initForm(): Promise<void> {
  await loadChecklist();

  const stored = await chrome.storage.local.get([...ALL_STORAGE_KEYS]);

  const tickerInput      = document.getElementById('ticker') as HTMLInputElement;
  const marketTypeSelect = document.getElementById('marketType') as HTMLSelectElement;
  const strategySelect   = document.getElementById('strategy') as HTMLSelectElement;
  const riskPercentInput = document.getElementById('riskPercent') as HTMLInputElement;
  const ratioInput       = document.getElementById('ratio') as HTMLInputElement;
  const luftPercentInput = document.getElementById('luftPercent') as HTMLInputElement;
  const riskSumInput     = document.getElementById('riskSum') as HTMLInputElement;
  const entryRawInput    = document.getElementById('entryRaw') as HTMLInputElement;
  const customStopInput  = document.getElementById('customStop') as HTMLInputElement;
  const atrOverrideInput = document.getElementById('atrOverride') as HTMLInputElement;
  const passRoadOverrideInput = document.getElementById('passRoadOverride') as HTMLInputElement;
  const inPlayInput      = document.getElementById('inPlay') as HTMLInputElement;
  const dealIdInput      = document.getElementById('deal-id') as HTMLInputElement;

  if (stored['ticker'])      tickerInput.value      = stored['ticker'] as string;
  if (stored['marketType'])  marketTypeSelect.value = stored['marketType'] as string;
  if (stored['strategy']) {
    strategySelect.value = stored['strategy'] as string;
    currentStrategy = stored['strategy'] as Strategy;
  }
  if (stored['riskPercent']) riskPercentInput.value = String(stored['riskPercent']);
  if (stored['ratio'])       ratioInput.value       = String(stored['ratio']);
  if (stored['luftPercent']) luftPercentInput.value = String(stored['luftPercent']);
  if (stored['riskSum'])     riskSumInput.value     = String(stored['riskSum']);
  if (stored['entryRaw'])    entryRawInput.value    = String(stored['entryRaw']);
  if (stored['customStop'])  customStopInput.value  = String(stored['customStop']);
  if (stored['atrOverride'])      atrOverrideInput.value      = String(stored['atrOverride']);
  if (stored['passRoadOverride']) passRoadOverrideInput.value = String(stored['passRoadOverride']);
  if (stored['inPlay'])      inPlayInput.checked    = stored['inPlay'] as boolean;
  if (stored['lastDealId'])  dealIdInput.value      = stored['lastDealId'] as string;

  if (stored['direction']) setDirection(stored['direction'] as Direction);

  const savedPlus  = (stored['checklistPlus']  as string[] | undefined) ?? [];
  const savedMinus = (stored['checklistMinus'] as string[] | undefined) ?? [];
  const savedWait  = (stored['checklistWait']  as string[] | undefined) ?? [];
  renderChecklist(currentStrategy, savedPlus, savedMinus, savedWait);

  // — Save on change listeners —

  tickerInput.addEventListener('input', () => {
    // Indicator values belong to the previous ticker
    indicatorFill = null;
    chartDayOpen = undefined;
    tickerInput.value = tickerInput.value.toUpperCase();
    chrome.storage.local.set({ ticker: tickerInput.value });
  });

  const updateAtrRequired = (): void => {
    atrOverrideInput.required = marketTypeSelect.value === 'crypto';
  };

  marketTypeSelect.addEventListener('change', () => {
    chrome.storage.local.set({ marketType: marketTypeSelect.value });
    updateAtrRequired();
  });

  updateAtrRequired();

  strategySelect.addEventListener('change', () => {
    currentStrategy = strategySelect.value as Strategy;
    chrome.storage.local.set({ strategy: currentStrategy });
    renderChecklist(currentStrategy);
  });

  entryRawInput.addEventListener('input', () => {
    chrome.storage.local.set({ entryRaw: entryRawInput.value });
  });

  customStopInput.addEventListener('input', () => {
    chrome.storage.local.set({ customStop: customStopInput.value });
  });

  atrOverrideInput.addEventListener('input', () => {
    chrome.storage.local.set({ atrOverride: atrOverrideInput.value });
  });

  passRoadOverrideInput.addEventListener('input', () => {
    chrome.storage.local.set({ passRoadOverride: passRoadOverrideInput.value });
  });

  riskPercentInput.addEventListener('input', () => {
    chrome.storage.local.set({ riskPercent: riskPercentInput.value });
  });

  ratioInput.addEventListener('input', () => {
    chrome.storage.local.set({ ratio: ratioInput.value });
  });

  luftPercentInput.addEventListener('input', () => {
    chrome.storage.local.set({ luftPercent: luftPercentInput.value });
  });

  riskSumInput.addEventListener('input', () => {
    chrome.storage.local.set({ riskSum: riskSumInput.value });
  });

  inPlayInput.addEventListener('change', () => {
    chrome.storage.local.set({ inPlay: inPlayInput.checked });
  });

  // — Direction —

  document.getElementById('btn-long')!.addEventListener('click', () => {
    setDirection('long');
    chrome.storage.local.set({ direction: 'long' });
  });

  document.getElementById('btn-short')!.addEventListener('click', () => {
    setDirection('short');
    chrome.storage.local.set({ direction: 'short' });
  });

  // — Collapsible —

  setupCollapsible('toggle-risk', 'risk-body');
  setupCollapsible('toggle-checklist', 'checklist-body');
  setupCollapsible('toggle-deal', 'deal-body');

  // — Clear —

  document.getElementById('clear-btn')!.addEventListener('click', () => {
    clearAll();
  });

  // — Submit —

  document.getElementById('submit-btn')!.addEventListener('click', async () => {
    // passRoad moves with the price — take the current value unless the trader typed their own
    if (indicatorFillIntact()) await syncFromChart(false);
    const payload = collectPayload();
    const error = validatePayload(payload);
    if (error) {
      showStatus('error', `❌ ${error}`);
      return;
    }
    submitPayload(payload);
  });

  // — Deal actions —

  document.getElementById('btn-entered')?.addEventListener('click', () => {
    handleDealAction('entered', true, { actualEntryPrice: readActualEntry() });
  });

  document.getElementById('btn-missed')?.addEventListener('click', () => {
    handleDealAction('missed', false);
  });

  document.getElementById('btn-close-deal')?.addEventListener('click', () => {
    const dealResult = (document.getElementById('deal-result') as HTMLSelectElement).value as 'win' | 'loss' | 'breakeven';
    const closePrice = parseFloat((document.getElementById('close-price') as HTMLInputElement).value);

    if (!closePrice || closePrice <= 0) {
      showDealStatus('error', '❌ Укажи цену закрытия');
      return;
    }

    handleDealAction('closed', true, { dealResult, closePrice, actualEntryPrice: readActualEntry() });
  });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

let formReady = false;

function setView(authorized: boolean): void {
  document.getElementById('auth-view')!.hidden = authorized;
  document.getElementById('app-view')!.hidden = !authorized;
  document.getElementById('clear-btn')!.hidden = !authorized;
  document.getElementById('logout-btn')!.hidden = !authorized;
}

function showAuthStatus(message: string | null): void {
  const el = document.getElementById('auth-status')!;
  el.className = message ? 'status error' : 'status hidden';
  el.textContent = message ? `❌ ${message}` : '';
}

async function showApp(): Promise<void> {
  setView(true);
  if (!formReady) {
    formReady = true;
    await initForm();
  } else {
    await loadChecklist();
    renderChecklist(currentStrategy);
  }
  await syncFromChart(true);
  if (indicatorFill) showStatus('success', '📏 ATR и passRoad взяты из индикатора ATR ZY');
}

async function showAuth(message: string | null = null): Promise<void> {
  await chrome.storage.local.remove(API_KEY_STORAGE_KEY);
  (document.getElementById('apiKey') as HTMLInputElement).value = '';
  showAuthStatus(message);
  setView(false);
  document.getElementById('apiKey')!.focus();
}

/** Токен отозвали во время работы — возвращаем на экран входа */
async function handleUnauthorized(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  await showAuth('Токен недействителен или отозван, войдите заново');
  return true;
}

function setupAuth(): void {
  const form = document.getElementById('auth-form') as HTMLFormElement;
  const input = document.getElementById('apiKey') as HTMLInputElement;
  const button = document.getElementById('auth-btn') as HTMLButtonElement;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const apiKey = input.value.trim();
    if (!apiKey) return;

    button.disabled = true;
    showAuthStatus(null);
    const result = await checkApiKey(apiKey);
    button.disabled = false;

    if (result.status === 'ok') {
      await chrome.storage.local.set({ [API_KEY_STORAGE_KEY]: apiKey });
      await showApp();
    } else if (result.status === 'rejected') {
      showAuthStatus(result.message);
    } else {
      showAuthStatus('Сервер недоступен, попробуйте позже');
    }
  });

  document.getElementById('logout-btn')!.addEventListener('click', () => {
    showAuth();
  });
}

async function start(): Promise<void> {
  setupAuth();
  const apiKey = await getStoredApiKey();
  if (!apiKey) {
    await showAuth();
    return;
  }

  const result = await checkApiKey(apiKey);
  // Без сети пускаем с сохранённым токеном: форма работает на кэше чек-листа
  if (result.status === 'rejected') {
    await showAuth(result.message);
  } else {
    await showApp();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  start();
});
