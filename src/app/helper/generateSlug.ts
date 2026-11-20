/*
 * "Royal Enfield Classic 350" → "royal-enfield-classic-350"
 */
export const generateSlug = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";

/*
 * Appends -2, -3, ... until `isTaken` returns false.
 */
export const generateUniqueSlug = async (
  value: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> => {
  const base = generateSlug(value);

  let slug = base;
  let suffix = 2;

  while (await isTaken(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }

  return slug;
};
