export function normalizeLanguage(value: string | null | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }

  const language = value.trim().replace(/_/g, '-');
  try {
    return Intl.getCanonicalLocales(language)[0];
  } catch {
    return undefined;
  }
}