// CaptureStore over chrome.storage.local (placeholder).
export interface CaptureStore {
  get<T>(k: string): Promise<T | undefined>;
  set(patch: Record<string, unknown>): Promise<void>;
}
