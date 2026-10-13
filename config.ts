// build.sh подменяет на API_URL при сборке
export const BASE_URL = 'https://zy-trading-backend-production.up.railway.app';

export const API_KEY_STORAGE_KEY = 'apiKey';
// Токен привязывается к этому ID при первом запросе; при потере ID токен перестанет работать
export const DEVICE_ID_STORAGE_KEY = 'deviceId';

async function getDeviceId(): Promise<string> {
  const stored = await chrome.storage.local.get(DEVICE_ID_STORAGE_KEY);
  const existing = stored[DEVICE_ID_STORAGE_KEY] as string | undefined;
  if (existing) return existing;

  const deviceId = crypto.randomUUID();
  await chrome.storage.local.set({ [DEVICE_ID_STORAGE_KEY]: deviceId });
  return deviceId;
}

export async function getApiHeaders(): Promise<Record<string, string>> {
  const stored = await chrome.storage.local.get(API_KEY_STORAGE_KEY);
  const apiKey = stored[API_KEY_STORAGE_KEY] as string | undefined;
  return {
    'Content-Type': 'application/json',
    'x-device-id': await getDeviceId(),
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
  };
}
