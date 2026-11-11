/** UI → worker: a transferred center-crop frame. */
export type ScanIn = { kind: 'frame'; bitmap: ImageBitmap; formats?: ScanFormat[] };
export type ScanFormat = 'EAN13' | 'QRCode';
/** worker → UI. */
export type ScanOut =
  | { kind: 'ready' }
  | { kind: 'isbn'; isbn: string }
  | { kind: 'text'; text: string }
  | { kind: 'none' }
  | { kind: 'error'; message: string };
