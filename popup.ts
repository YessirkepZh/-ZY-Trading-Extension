import { getChecklistForStrategy } from './checklists/index.js';
import { Strategy, MarketType, Direction, ChecklistSnapshot, FormPayload } from './checklists/types.js';
import { BASE_URL } from './config.js';

const ALL_STORAGE_KEYS = [
  'ticker', 'marketType', 'strategy', 'direction',
  'riskPercent', 'ratio', 'luftPercent', 'riskSum', 'inPlay',
  'entryRaw', 'customStop',
  'checklistPlus', 'checklistMinus', 'checklistWait',
] as const;

const SUBMIT_CLEAR_KEYS: Array<typeof ALL_STORAGE_KEYS[number]> = [
  'entryRaw', 'customStop',
  'checklistPlus', 'checklistMinus', 'checklistWait',
];

let selectedPlus: Set<string> = new Set();
let selectedMinus: Set<string> = new Set();
let selectedWait: Set<string> = new Set();
let currentStrategy: Strategy = 'Пробой';
let currentDirection: Direction = 'long';

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

function collectPayload(): FormPayload {
  const checklist: ChecklistSnapshot = {
    plus: Array.from(selectedPlus),
    minus: Array.from(selectedMinus),
    wait: Array.from(selectedWait),
  };

  return {
    ticker: (document.getElementById('ticker') as HTMLInputElement).value.trim().toUpperCase(),
    marketType: (document.getElementById('marketType') as HTMLSelectElement).value as MarketType,
    strategy: currentStrategy,
    direction: currentDirection,
    entryRaw: parseFloat((document.getElementById('entryRaw') as HTMLInputElement).value),
    customStop: parseFloat((document.getElementById('customStop') as HTMLInputElement).value) || undefined,
    riskPercent: parseFloat((document.getElementById('riskPercent') as HTMLInputElement).value),
    ratio: parseFloat((document.getElementById('ratio') as HTMLInputElement).value),
    luftPercent: parseFloat((document.getElementById('luftPercent') as HTMLInputElement).value),
    riskSum: parseFloat((document.getElementById('riskSum') as HTMLInputElement).value),
    inPlay: (document.getElementById('inPlay') as HTMLInputElement).checked,
    checklist: checklist.plus.length + checklist.minus.length + checklist.wait.length > 0
      ? checklist
      : undefined,
  };
}

function validatePayload(payload: FormPayload): string | null {
  if (!payload.ticker) return 'Укажите тикер';
  if (!payload.entryRaw || payload.entryRaw <= 0) return 'Укажите уровень входа (> 0)';
  if (payload.customStop !== undefined && payload.customStop <= 0) return 'SL уровень должен быть > 0';
  return null;
}

function showStatus(type: 'loading' | 'success' | 'error', message: string): void {
  const el = document.getElementById('status')!;
  el.className = `status ${type}`;
  el.textContent = message;
  if (type === 'success') {
    setTimeout(() => { el.className = 'status hidden'; }, 3000);
  }
}

async function clearAll(): Promise<void> {
  await chrome.storage.local.clear();

  (document.getElementById('ticker') as HTMLInputElement).value = '';
  (document.getElementById('marketType') as HTMLSelectElement).value = 'crypto';
  (document.getElementById('strategy') as HTMLSelectElement).value = 'Пробой';
  (document.getElementById('entryRaw') as HTMLInputElement).value = '';
  (document.getElementById('customStop') as HTMLInputElement).value = '';
  (document.getElementById('riskPercent') as HTMLInputElement).value = '15';
  (document.getElementById('ratio') as HTMLInputElement).value = '3';
  (document.getElementById('luftPercent') as HTMLInputElement).value = '20';
  (document.getElementById('riskSum') as HTMLInputElement).value = '15';
  (document.getElementById('inPlay') as HTMLInputElement).checked = false;

  currentStrategy = 'Пробой';
  setDirection('long');
  renderChecklist(currentStrategy);

  document.getElementById('status')!.className = 'status hidden';
}

async function submitPayload(payload: FormPayload): Promise<void> {
  const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement;
  submitBtn.disabled = true;
  showStatus('loading', 'Отправка...');

  try {
    const response = await fetch(`${BASE_URL}/api/createNote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || `Ошибка ${response.status}`);
    }

    await chrome.storage.local.remove(SUBMIT_CLEAR_KEYS);

    showStatus('success', `✅ Отправлено! ID: ${data.id}`);

    (document.getElementById('entryRaw') as HTMLInputElement).value = '';
    (document.getElementById('customStop') as HTMLInputElement).value = '';
    renderChecklist(currentStrategy);

  } catch (err) {
    showStatus('error', `❌ ${(err as Error).message}`);
  } finally {
    submitBtn.disabled = false;
  }
}

function setupCollapsible(headerId: string, bodyId: string): void {
  const header = document.getElementById(headerId)!;
  const body = document.getElementById(bodyId)!;
  header.addEventListener('click', () => {
    body.classList.toggle('collapsed');
  });
}

async function initForm(): Promise<void> {
  const stored = await chrome.storage.local.get([...ALL_STORAGE_KEYS]);

  const tickerInput        = document.getElementById('ticker') as HTMLInputElement;
  const marketTypeSelect   = document.getElementById('marketType') as HTMLSelectElement;
  const strategySelect     = document.getElementById('strategy') as HTMLSelectElement;
  const riskPercentInput   = document.getElementById('riskPercent') as HTMLInputElement;
  const ratioInput         = document.getElementById('ratio') as HTMLInputElement;
  const luftPercentInput   = document.getElementById('luftPercent') as HTMLInputElement;
  const riskSumInput       = document.getElementById('riskSum') as HTMLInputElement;
  const entryRawInput      = document.getElementById('entryRaw') as HTMLInputElement;
  const customStopInput    = document.getElementById('customStop') as HTMLInputElement;
  const inPlayInput        = document.getElementById('inPlay') as HTMLInputElement;

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
  if (stored['inPlay'])      inPlayInput.checked    = stored['inPlay'] as boolean;

  if (stored['direction']) {
    setDirection(stored['direction'] as Direction);
  }

  const savedPlus  = (stored['checklistPlus']  as string[] | undefined) ?? [];
  const savedMinus = (stored['checklistMinus'] as string[] | undefined) ?? [];
  const savedWait  = (stored['checklistWait']  as string[] | undefined) ?? [];
  renderChecklist(currentStrategy, savedPlus, savedMinus, savedWait);

  // — Event listeners —

  tickerInput.addEventListener('input', () => {
    tickerInput.value = tickerInput.value.toUpperCase();
    chrome.storage.local.set({ ticker: tickerInput.value });
  });

  marketTypeSelect.addEventListener('change', () => {
    chrome.storage.local.set({ marketType: marketTypeSelect.value });
  });

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

  const btnLong  = document.getElementById('btn-long')  as HTMLButtonElement;
  const btnShort = document.getElementById('btn-short') as HTMLButtonElement;

  btnLong.addEventListener('click', () => {
    setDirection('long');
    chrome.storage.local.set({ direction: 'long' });
  });

  btnShort.addEventListener('click', () => {
    setDirection('short');
    chrome.storage.local.set({ direction: 'short' });
  });

  setupCollapsible('toggle-risk', 'risk-body');
  setupCollapsible('toggle-checklist', 'checklist-body');

  document.getElementById('clear-btn')!.addEventListener('click', () => {
    clearAll();
  });

  document.getElementById('submit-btn')!.addEventListener('click', () => {
    const payload = collectPayload();
    const error = validatePayload(payload);
    if (error) {
      showStatus('error', `❌ ${error}`);
      return;
    }
    submitPayload(payload);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initForm();
});
