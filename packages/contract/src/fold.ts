/** Diacritics-insensitive, lowercase normal form shared by index build + search. */
export const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
