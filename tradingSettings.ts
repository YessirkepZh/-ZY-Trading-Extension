import { BASE_URL, getApiHeaders } from './config.js';

const CACHE_KEY = 'tradingSettingsCache';

export interface RiskPreset {
  id: number;
  name: string;
  riskPercent: number;
  ratio: number;
  luftPercent: number;
  riskSum: number;
  isSystem: boolean;
  isDefault: boolean;
}

export interface TradingStrategy {
  id: number;
  name: string;
  isSystem: boolean;
  defaultRiskPresetId: number | null;
  defaultRiskPreset?: RiskPreset | null;
}

interface CacheShape {
  strategies: TradingStrategy[];
  presets: RiskPreset[];
}

let strategies: TradingStrategy[] = [];
let presets: RiskPreset[] = [];

async function readCache(): Promise<CacheShape | null> {
  const stored = await chrome.storage.local.get(CACHE_KEY);
  const raw = stored[CACHE_KEY] as CacheShape | undefined;
  if (!raw?.strategies?.length) return null;
  return raw;
}

function applyCache(data: CacheShape): void {
  strategies = data.strategies;
  presets = data.presets ?? [];
}

async function writeCache(data: CacheShape): Promise<void> {
  applyCache(data);
  await chrome.storage.local.set({ [CACHE_KEY]: data });
}

/** Load from cache immediately, then refresh from API silently. */
export async function loadTradingSettings(): Promise<void> {
  const cached = await readCache();
  if (cached) applyCache(cached);

  try {
    const headers = await getApiHeaders();
    const [sRes, pRes] = await Promise.all([
      fetch(`${BASE_URL}/api/strategies`, { headers }),
      fetch(`${BASE_URL}/api/risk-presets`, { headers }),
    ]);
    if (!sRes.ok || !pRes.ok) throw new Error(`HTTP ${sRes.status}/${pRes.status}`);
    const sData = await sRes.json() as { strategies: TradingStrategy[] };
    const pData = await pRes.json() as { presets: RiskPreset[] };
    await writeCache({ strategies: sData.strategies ?? [], presets: pData.presets ?? [] });
  } catch (err) {
    console.warn('Trading settings fetch failed, using cache:', err);
    if (!cached) {
      // Hardcoded bootstrap until first successful fetch
      strategies = [
        { id: 0, name: 'Пробой', isSystem: true, defaultRiskPresetId: null },
        { id: 0, name: 'Ложный Пробой', isSystem: true, defaultRiskPresetId: null },
        { id: 0, name: 'Отбой', isSystem: true, defaultRiskPresetId: null },
      ];
      presets = [];
    }
  }
}

export function getStrategies(): TradingStrategy[] {
  return strategies;
}

export function getPresets(): RiskPreset[] {
  return presets;
}

export function resolveRiskForStrategy(strategyName: string): RiskPreset | null {
  const strategy = strategies.find((s) => s.name === strategyName);
  if (strategy?.defaultRiskPreset) return strategy.defaultRiskPreset;
  if (strategy?.defaultRiskPresetId != null) {
    const linked = presets.find((p) => p.id === strategy.defaultRiskPresetId);
    if (linked) return linked;
  }
  return presets.find((p) => p.isDefault) ?? presets[0] ?? null;
}
