/*
 * Bangladesh mobile numbers → E.164 (+8801XXXXXXXXX).
 * Accepts: 01712345678, 8801712345678, +8801712345678, with spaces/dashes.
 * Returns null when the number is not a valid BD mobile number.
 */
export const BD_PHONE_REGEX = /^\+8801[3-9]\d{8}$/;

export const normalizePhone = (value: string): string | null => {
  const digits = value.replace(/[\s-]/g, "");

  let normalized = digits;

  if (/^01\d{9}$/.test(digits)) {
    normalized = `+88${digits}`;
  } else if (/^8801\d{9}$/.test(digits)) {
    normalized = `+${digits}`;
  }

  return BD_PHONE_REGEX.test(normalized) ? normalized : null;
};
