/**
 * Делает скриншот текущей активной вкладки.
 * Возвращает base64 PNG строку.
 */
export async function captureScreenshot(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(
      { format: 'png', quality: 85 },
      (dataUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!dataUrl) {
          reject(new Error('No screenshot data'));
          return;
        }
        resolve(dataUrl); // уже в формате data:image/png;base64,...
      }
    );
  });
}
