/** UI → worker: a transferred center-crop frame. */
export type ScanIn = { kind: 'frame'; bitmap: ImageBitmap };
/** worker → UI. */
export type ScanOut =
  | { kind: 'ready' }
  | { kind: 'isbn'; isbn: string }
  | { kind: 'none' }
  | { kind: 'error'; message: string };
