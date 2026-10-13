// build.sh подменяет на API_URL при сборке
export const BASE_URL = 'https://zy-trading-backend-production.up.railway.app';

export const API_KEY_STORAGE_KEY = 'apiKey';

export async function getApiHeaders(): Promise<Record<string, string>> {
  const stored = await chrome.storage.local.get(API_KEY_STORAGE_KEY);
  const apiKey = stored[API_KEY_STORAGE_KEY] as string | undefined;
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
  };
}
