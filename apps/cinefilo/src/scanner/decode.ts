/** The reader options the worker uses; shared so the unit test exercises the same set. */
export const QR_READ_OPTIONS = { formats: ['QRCode' as const], tryHarder: true, maxNumberOfSymbols: 1 };
