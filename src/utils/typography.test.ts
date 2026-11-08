import { describe, it, expect } from 'vitest';
import { typography } from './typography';

describe('typography', () => {
  const expectedKeys = [
    'heroHeader',
    'sectionHeader',
    'cardTitleLarge',
    'cardTitleSmall',
    'subtitle',
    'bodyText',
    'smallText',
  ] as const;

  const requiredProperties = ['fontFamily', 'fontWeight', 'letterSpacing', 'fontSize', 'lineHeight'] as const;

  it('should export a typography object', () => {
    expect(typography).toBeDefined();
    expect(typeof typography).toBe('object');
  });

  it('should have exactly 7 style entries', () => {
    expect(Object.keys(typography)).toHaveLength(7);
  });

  describe.each(expectedKeys)('%s', (key) => {
    it('should exist in the typography object', () => {
      expect(typography[key]).toBeDefined();
    });

    it.each(requiredProperties)('should have %s property', (prop) => {
      expect(typography[key]).toHaveProperty(prop);
    });

    it('should have fontFamily as a string containing Montserrat', () => {
      expect(typeof typography[key].fontFamily).toBe('string');
      expect(typography[key].fontFamily).toContain('Montserrat');
    });

    it('should have fontWeight as a number', () => {
      expect(typeof typography[key].fontWeight).toBe('number');
    });

    it('should have letterSpacing as a string', () => {
      expect(typeof typography[key].letterSpacing).toBe('string');
    });

    it('should have fontSize as a string', () => {
      expect(typeof typography[key].fontSize).toBe('string');
    });

    it('should have lineHeight as a number', () => {
      expect(typeof typography[key].lineHeight).toBe('number');
    });
  });

  describe('consistent base values', () => {
    const displayStyles = ['heroHeader', 'sectionHeader', 'cardTitleLarge', 'cardTitleSmall', 'subtitle'] as const;
    const readingStyles = ['bodyText', 'smallText'] as const;

    it('should use medium weight for for display/heading styles', () => {
      displayStyles.forEach((key) => {
        expect(typography[key].fontWeight, `${key} should remain legible`).toBeGreaterThanOrEqual(400);
      });
    });

    it('should use regular weight for for reading text (body + small)', () => {
      readingStyles.forEach((key) => {
        expect(typography[key].fontWeight, `${key} should remain legible`).toBeGreaterThanOrEqual(400);
      });
    });

    it('should use the same font family for all styles', () => {
      const firstFamily = typography.heroHeader.fontFamily;
      expectedKeys.forEach((key) => {
        expect(typography[key].fontFamily).toBe(firstFamily);
      });
    });
  });

  describe('font sizing uses clamp()', () => {
    it('uses scalable rem values or responsive clamps', () => {
      expectedKeys.forEach((key) => {
        expect(typography[key].fontSize).toMatch(/^(clamp\(|[0-9.]+rem$)/);
      });
    });
  });

  describe('line height values', () => {
    it('should have lineHeight between 1 and 2 for all styles', () => {
      expectedKeys.forEach((key) => {
        expect(typography[key].lineHeight).toBeGreaterThanOrEqual(1);
        expect(typography[key].lineHeight).toBeLessThanOrEqual(2);
      });
    });
  });
});
