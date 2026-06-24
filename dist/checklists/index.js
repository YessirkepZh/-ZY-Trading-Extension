import { BASE_URL } from '../config.js';
const CACHE_KEY = 'checklistCache';
let loadedGroups = [];
export async function loadChecklist() {
    try {
        const response = await fetch(`${BASE_URL}/api/checklist`);
        if (!response.ok)
            throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        loadedGroups = data.groups;
        chrome.storage.local.set({ [CACHE_KEY]: loadedGroups });
    }
    catch (err) {
        console.warn('Checklist fetch failed, using cache:', err);
        const stored = await chrome.storage.local.get(CACHE_KEY);
        if (stored[CACHE_KEY]) {
            loadedGroups = stored[CACHE_KEY];
        }
    }
}
export function getChecklistForStrategy(strategy) {
    const group = loadedGroups.find(g => g.name === strategy);
    if (!group)
        return { ПРЕДПОСЫЛКИ: [], МИНУСЫ: [], ОЖИДАЮ: [] };
    return {
        ПРЕДПОСЫЛКИ: group.plus,
        МИНУСЫ: group.minus,
        ОЖИДАЮ: group.wait,
    };
}
