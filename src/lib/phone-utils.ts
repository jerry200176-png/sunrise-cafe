/**
 * Taiwan phone normalization for consistent guest verification.
 */
export function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("886") && digits.length >= 10) {
    digits = `0${digits.slice(3)}`;
  }
  return digits;
}

export function phonesMatch(storedPhone: string, inputPhone: string): boolean {
  return normalizePhone(storedPhone) === normalizePhone(inputPhone);
}
