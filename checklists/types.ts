export type Strategy = 'Пробой' | 'Ложный Пробой' | 'Отбой';
export type MarketType = 'crypto' | 'stocks' | 'forex';
export type Direction = 'long' | 'short';

export interface ChecklistItem {
  key: string;
  label: string;
}

export interface Checklist {
  ПРЕДПОСЫЛКИ: ChecklistItem[];
  МИНУСЫ: ChecklistItem[];
  ОЖИДАЮ: ChecklistItem[];
}

export interface ChecklistSnapshot {
  plus: string[];   // выбранные ключи из ПРЕДПОСЫЛКИ
  minus: string[];  // выбранные ключи из МИНУСЫ
  wait: string[];   // выбранные ключи из ОЖИДАЮ
}

export interface ChecklistGroup {
  id: number;
  name: Strategy;
  plus:  ChecklistItem[];
  minus: ChecklistItem[];
  wait:  ChecklistItem[];
}

export interface FormPayload {
  ticker: string;
  marketType: MarketType;
  strategy: Strategy;
  direction: Direction;
  entryRaw: number;
  customStop?: number;
  atrOverride?: number;
  passRoadOverride?: number;
  riskPercent: number;
  ratio: number;
  luftPercent: number;
  riskSum: number;
  inPlay: boolean;
  checklist?: ChecklistSnapshot;
}
