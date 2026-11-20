/** Normalises a UI label: strips icon-font glyphs (private-use chars) and collapses whitespace. */
export function normalizeUiLabel(value: string): string {
  return value
    .replace(/[\uE000-\uF8FF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Public controls that open the complete review list, optionally with a count. */
export function isFullReviewsLabel(value: string): boolean {
  const label = normalizeUiLabel(value);
  const count = "[\\d٠-٩][\\d٠-٩,.\\s]*";
  return new RegExp(
    `^(?:` +
      `(?:more|see more|view more|show more)(?:\\s+${count})?\\s+reviews?|` +
      `(?:see|view|show) all(?:\\s+${count})?\\s+reviews?|` +
      `all(?:\\s+${count})?\\s+reviews?|` +
      `plus d['’]avis|voir (?:tous les avis|les ${count} avis)|` +
      `afficher (?:plus d['’]avis|les ${count} avis)|tous les avis|` +
      `(?:weitere|alle)(?:\\s+${count})?\\s+(?:bewertungen|rezensionen)|` +
      `(?:más|ver más) reseñas|ver todas las reseñas|todas las reseñas|` +
      `altre recensioni|tutte le recensioni|meer reviews|alle reviews|` +
      `المزيد من (?:${count}\\s*)?(?:المراجعات|التقييمات|مراجعة|مراجعات|تقييمات)|` +
      `عرض (?:جميع|كل|المزيد من) (?:المراجعات|التقييمات|مراجعة|مراجعات|تقييمات)|` +
      `كل (?:المراجعات|التقييمات)` +
      `)(?:\\s*[(\\d٠-٩].*)?$`,
    "i",
  ).test(label);
}

/** Visible translation toggles that restore the review author's original text. */
export function isShowOriginalLabel(value: string): boolean {
  const label = normalizeUiLabel(value);
  return /^(?:see|view|show) original(?: review| text)?(?:\b|\s|\(|$)|voir l['’]original(?:\b|\s|\(|$)|afficher l['’]original(?:\b|\s|\(|$)|original(?:en)? (?:anzeigen|ansehen|zeigen)|(?:ver|mostrar) (?:el )?original(?:\b|\s|\(|$)|(?:vedi|mostra) l['’]originale(?:\b|\s|\(|$)|origineel bekijken|عرض (?:النص )?(?:الأصلي|الأصل)(?:\b|\s|\(|$)|إظهار (?:النص )?(?:الأصلي|الأصل)(?:\b|\s|\(|$)/i.test(
    label,
  );
}

/** Loose match used only to report which review-related controls exist (diagnostics). */
export function looksReviewRelated(value: string): boolean {
  return /review|avis|مراجع|تقييم/i.test(value);
}
