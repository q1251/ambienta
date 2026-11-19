export function calculatePackagePrice(pricePerPill: number, pillsPerPackage: number): number | null {
  if (
    !Number.isFinite(pricePerPill)
    || pricePerPill < 0
    || !Number.isInteger(pillsPerPackage)
    || pillsPerPackage <= 0
  ) {
    return null;
  }

  const pricePerPillCents = Math.round((pricePerPill + Number.EPSILON) * 100);
  const cents = pricePerPillCents * pillsPerPackage;
  if (!Number.isSafeInteger(cents) || cents > 9_999_999_999) return null;
  return cents / 100;
}
