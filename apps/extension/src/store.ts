// CaptureStore over chrome.storage.local (data-model "Extension storage").
import type { CaptureStore } from '@readerlog/sync/capturePeer';

export type { CaptureStore };

export const chromeStore: CaptureStore = {
  async get<T>(k: string): Promise<T | undefined> {
    const got = await chrome.storage.local.get(k);
    return got[k] as T | undefined;
  },
  set: (patch) => chrome.storage.local.set(patch),
};
