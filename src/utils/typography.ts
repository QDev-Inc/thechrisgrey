const baseFontFamily = '"Montserrat Variable", Montserrat, "Segoe UI", system-ui, sans-serif';
const baseFontWeight = 500;
const bodyFontWeight = 400;
const baseLetterSpacing = '-0.025em';

export const typography = {
  heroHeader: {
    fontFamily: baseFontFamily,
    fontWeight: baseFontWeight,
    letterSpacing: baseLetterSpacing,
    fontSize: 'clamp(2.25rem, 5vw, 4rem)',
    lineHeight: 1.2,
  },
  sectionHeader: {
    fontFamily: baseFontFamily,
    fontWeight: baseFontWeight,
    letterSpacing: baseLetterSpacing,
    fontSize: 'clamp(1.75rem, 3.5vw, 2.75rem)',
    lineHeight: 1.2,
  },
  cardTitleLarge: {
    fontFamily: baseFontFamily,
    fontWeight: baseFontWeight,
    letterSpacing: baseLetterSpacing,
    fontSize: 'clamp(1.375rem, 2vw, 1.75rem)',
    lineHeight: 1.3,
  },
  cardTitleSmall: {
    fontFamily: baseFontFamily,
    fontWeight: baseFontWeight,
    letterSpacing: baseLetterSpacing,
    fontSize: 'clamp(1.25rem, 2vw, 1.5rem)',
    lineHeight: 1.3,
  },
  subtitle: {
    fontFamily: baseFontFamily,
    fontWeight: baseFontWeight,
    letterSpacing: baseLetterSpacing,
    fontSize: 'clamp(1rem, 2vw, 1.5rem)',
    lineHeight: 1.65,
  },
  bodyText: {
    fontFamily: baseFontFamily,
    fontWeight: bodyFontWeight,
    letterSpacing: '0',
    fontSize: 'clamp(1rem, 1.2vw, 1.125rem)',
    lineHeight: 1.65,
  },
  smallText: {
    fontFamily: baseFontFamily,
    fontWeight: bodyFontWeight,
    letterSpacing: '0',
    fontSize: '0.875rem',
    lineHeight: 1.65,
  },
} as const;
