// Players see credits, not dollars (3.4): 100 credits are one dollar of
// Claude calls, so a $5 allowance reads as 500 credits. The Worker counts in
// dollars; only what is shown is converted.
export const CREDITS_PER_USD = 100;

export function credits(usd: number): number {
  return Math.floor(usd * CREDITS_PER_USD + 1e-6);
}
