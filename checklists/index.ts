import { Checklist, ChecklistGroup, Strategy } from './types.js';
import { BASE_URL } from '../config.js';

const CACHE_KEY = 'checklistCache';

let loadedGroups: ChecklistGroup[] = [];

export async function loadChecklist(): Promise<void> {
  try {
    const response = await fetch(`${BASE_URL}/api/checklist`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { groups: ChecklistGroup[] };
    loadedGroups = data.groups;
    chrome.storage.local.set({ [CACHE_KEY]: loadedGroups });
  } catch (err) {
    console.warn('Checklist fetch failed, using cache:', err);
    const stored = await chrome.storage.local.get(CACHE_KEY);
    if (stored[CACHE_KEY]) {
      loadedGroups = stored[CACHE_KEY] as ChecklistGroup[];
    }
  }
}

export function getChecklistForStrategy(strategy: Strategy): Checklist {
  const group = loadedGroups.find(g => g.name === strategy);
  if (!group) return { ПРЕДПОСЫЛКИ: [], МИНУСЫ: [], ОЖИДАЮ: [] };
  return {
    ПРЕДПОСЫЛКИ: group.plus,
    МИНУСЫ:      group.minus,
    ОЖИДАЮ:      group.wait,
  };
}
