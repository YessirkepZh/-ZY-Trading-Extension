import { getChecklistForStrategy } from './checklists/index.js';
import { BASE_URL } from './config.js';
let selectedPlus = new Set();
let selectedMinus = new Set();
let selectedWait = new Set();
let currentStrategy = 'Пробой';
let currentDirection = 'long';
function renderChecklist(strategy) {
    const checklist = getChecklistForStrategy(strategy);
    selectedPlus.clear();
    selectedMinus.clear();
    selectedWait.clear();
    const plusContainer = document.getElementById('checklist-plus');
    const minusContainer = document.getElementById('checklist-minus');
    const waitContainer = document.getElementById('checklist-wait');
    plusContainer.innerHTML = '';
    minusContainer.innerHTML = '';
    waitContainer.innerHTML = '';
    checklist.ПРЕДПОСЫЛКИ.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'tag';
        btn.textContent = item.label;
        btn.dataset['key'] = item.key;
        btn.addEventListener('click', () => {
            btn.classList.toggle('selected');
            if (btn.classList.contains('selected')) {
                btn.classList.add('plus');
                selectedPlus.add(item.key);
            }
            else {
                btn.classList.remove('plus');
                selectedPlus.delete(item.key);
            }
            updateChecklistCount();
        });
        plusContainer.appendChild(btn);
    });
    checklist.МИНУСЫ.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'tag';
        btn.textContent = item.label;
        btn.dataset['key'] = item.key;
        btn.addEventListener('click', () => {
            btn.classList.toggle('selected');
            if (btn.classList.contains('selected')) {
                btn.classList.add('minus');
                selectedMinus.add(item.key);
            }
            else {
                btn.classList.remove('minus');
                selectedMinus.delete(item.key);
            }
            updateChecklistCount();
        });
        minusContainer.appendChild(btn);
    });
    checklist.ОЖИДАЮ.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'tag';
        btn.textContent = item.label;
        btn.dataset['key'] = item.key;
        btn.addEventListener('click', () => {
            btn.classList.toggle('selected');
            if (btn.classList.contains('selected')) {
                btn.classList.add('wait');
                selectedWait.add(item.key);
            }
            else {
                btn.classList.remove('wait');
                selectedWait.delete(item.key);
            }
            updateChecklistCount();
        });
        waitContainer.appendChild(btn);
    });
    updateChecklistCount();
}
function updateChecklistCount() {
    const total = selectedPlus.size + selectedMinus.size + selectedWait.size;
    document.getElementById('checklist-count').textContent = String(total);
}
function collectPayload() {
    const checklist = {
        plus: Array.from(selectedPlus),
        minus: Array.from(selectedMinus),
        wait: Array.from(selectedWait),
    };
    return {
        ticker: document.getElementById('ticker').value.trim().toUpperCase(),
        marketType: document.getElementById('marketType').value,
        strategy: currentStrategy,
        direction: currentDirection,
        entryRaw: parseFloat(document.getElementById('entryRaw').value),
        customStop: parseFloat(document.getElementById('customStop').value) || undefined,
        riskPercent: parseFloat(document.getElementById('riskPercent').value),
        ratio: parseFloat(document.getElementById('ratio').value),
        luftPercent: parseFloat(document.getElementById('luftPercent').value),
        riskSum: parseFloat(document.getElementById('riskSum').value),
        inPlay: document.getElementById('inPlay').checked,
        checklist: checklist.plus.length + checklist.minus.length + checklist.wait.length > 0
            ? checklist
            : undefined,
    };
}
function validatePayload(payload) {
    if (!payload.ticker) {
        return 'Укажите тикер';
    }
    if (!payload.entryRaw || payload.entryRaw <= 0) {
        return 'Укажите уровень входа (> 0)';
    }
    if (payload.customStop !== undefined && payload.customStop <= 0) {
        return 'SL уровень должен быть > 0';
    }
    return null;
}
function showStatus(type, message) {
    const el = document.getElementById('status');
    el.className = `status ${type}`;
    el.textContent = message;
    if (type === 'success') {
        setTimeout(() => {
            el.className = 'status hidden';
        }, 3000);
    }
}
async function submitPayload(payload) {
    const submitBtn = document.getElementById('submit-btn');
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
        await chrome.storage.local.set({
            ticker: payload.ticker,
            marketType: payload.marketType,
            strategy: payload.strategy,
            riskPercent: payload.riskPercent,
            ratio: payload.ratio,
            luftPercent: payload.luftPercent,
            riskSum: payload.riskSum,
        });
        showStatus('success', `✅ Отправлено! ID: ${data.id}`);
        document.getElementById('entryRaw').value = '';
        document.getElementById('customStop').value = '';
        selectedPlus.clear();
        selectedMinus.clear();
        selectedWait.clear();
        renderChecklist(currentStrategy);
    }
    catch (err) {
        showStatus('error', `❌ ${err.message}`);
    }
    finally {
        submitBtn.disabled = false;
    }
}
function setupCollapsible(headerId, bodyId) {
    const header = document.getElementById(headerId);
    const body = document.getElementById(bodyId);
    header.addEventListener('click', () => {
        body.classList.toggle('collapsed');
    });
}
async function initForm() {
    const stored = await chrome.storage.local.get([
        'ticker', 'marketType', 'strategy',
        'riskPercent', 'ratio', 'luftPercent', 'riskSum',
    ]);
    const tickerInput = document.getElementById('ticker');
    const marketTypeSelect = document.getElementById('marketType');
    const strategySelect = document.getElementById('strategy');
    const riskPercentInput = document.getElementById('riskPercent');
    const ratioInput = document.getElementById('ratio');
    const luftPercentInput = document.getElementById('luftPercent');
    const riskSumInput = document.getElementById('riskSum');
    if (stored['ticker'])
        tickerInput.value = stored['ticker'];
    if (stored['marketType'])
        marketTypeSelect.value = stored['marketType'];
    if (stored['strategy']) {
        strategySelect.value = stored['strategy'];
        currentStrategy = stored['strategy'];
    }
    if (stored['riskPercent'])
        riskPercentInput.value = String(stored['riskPercent']);
    if (stored['ratio'])
        ratioInput.value = String(stored['ratio']);
    if (stored['luftPercent'])
        luftPercentInput.value = String(stored['luftPercent']);
    if (stored['riskSum'])
        riskSumInput.value = String(stored['riskSum']);
    renderChecklist(currentStrategy);
    // Ticker uppercase
    tickerInput.addEventListener('input', () => {
        tickerInput.value = tickerInput.value.toUpperCase();
    });
    // Strategy change
    strategySelect.addEventListener('change', () => {
        currentStrategy = strategySelect.value;
        renderChecklist(currentStrategy);
    });
    // Direction toggle
    const btnLong = document.getElementById('btn-long');
    const btnShort = document.getElementById('btn-short');
    btnLong.addEventListener('click', () => {
        currentDirection = 'long';
        btnLong.classList.add('active', 'long-active');
        btnLong.classList.remove('short-active');
        btnShort.classList.remove('active', 'long-active', 'short-active');
    });
    btnShort.addEventListener('click', () => {
        currentDirection = 'short';
        btnShort.classList.add('active', 'short-active');
        btnShort.classList.remove('long-active');
        btnLong.classList.remove('active', 'long-active', 'short-active');
    });
    // Collapsible sections
    setupCollapsible('toggle-risk', 'risk-body');
    setupCollapsible('toggle-checklist', 'checklist-body');
    // Submit
    document.getElementById('submit-btn').addEventListener('click', () => {
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
