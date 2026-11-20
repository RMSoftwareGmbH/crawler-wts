export const reviewSources = [
  'google',
  'tripadvisor',
  'booking',
  'holidaycheck',
  'expedia',
  'hotels-com'
] as const;

export type ReviewSource = (typeof reviewSources)[number];