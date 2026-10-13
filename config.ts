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

export async function getStoredApiKey(): Promise<string | undefined> {
  const stored = await chrome.storage.local.get(API_KEY_STORAGE_KEY);
  return stored[API_KEY_STORAGE_KEY] as string | undefined;
}

export async function getApiHeaders(apiKey?: string): Promise<Record<string, string>> {
  const key = apiKey ?? await getStoredApiKey();
  return {
    'Content-Type': 'application/json',
    'x-device-id': await getDeviceId(),
    ...(key ? { 'x-api-key': key } : {}),
  };
}

export type ApiKeyCheck =
  | { status: 'ok' }
  | { status: 'rejected'; message: string }
  | { status: 'offline' };

/** Проверяет токен на бэкенде; при первом запросе токен привязывается к этому устройству */
export async function checkApiKey(apiKey: string): Promise<ApiKeyCheck> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/api/auth/me`, { headers: await getApiHeaders(apiKey) });
  } catch {
    return { status: 'offline' };
  }
  if (response.ok) return { status: 'ok' };
  if (response.status !== 401 && response.status !== 403) return { status: 'offline' };

  const data = await response.json().catch(() => ({})) as { error?: unknown };
  const message = response.status === 403 && typeof data.error === 'string'
    ? data.error
    : 'Неверный или отозванный токен';
  return { status: 'rejected', message };
}
