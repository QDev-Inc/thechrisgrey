import { describe, it, expect } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import ResponsiveImage, { type ResponsiveImageSource } from './ResponsiveImage';

const source: ResponsiveImageSource = {
  fallback: { src: '/img.jpeg', width: 1200, height: 800 },
  avif: [
    { src: '/img-480.avif', width: 480 },
    { src: '/img-1200.avif', width: 1200 },
  ],
  webp: [
    { src: '/img-480.webp', width: 480 },
    { src: '/img-1200.webp', width: 1200 },
  ],
  width: 1200,
  height: 800,
};

describe('ResponsiveImage', () => {
  it('removes failing modern sources so the browser can load the original fallback', () => {
    const { container } = render(<ResponsiveImage src={source} alt="A photo" sizes="100vw" />);
    const image = container.querySelector('img')!;
    fireEvent.error(image);
    expect(container.querySelector('source')).toBeNull();
    expect(image).toHaveAttribute('src', '/img.jpeg');
  });

  it('renders a <picture> with AVIF and WebP sources and a JPEG fallback <img>', () => {
    const { container } = render(<ResponsiveImage src={source} alt="A photo" sizes="100vw" />);
    const picture = container.querySelector('picture');
    expect(picture).not.toBeNull();
    const avif = picture?.querySelector('source[type="image/avif"]');
    const webp = picture?.querySelector('source[type="image/webp"]');
    expect(avif).not.toBeNull();
    expect(webp).not.toBeNull();
    // srcset spans every generated width.
    expect(avif?.getAttribute('srcset')).toContain('480w');
    expect(avif?.getAttribute('srcset')).toContain('1200w');
    expect(avif?.getAttribute('sizes')).toBe('100vw');
    const img = picture?.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('/img.jpeg');
  });

  it('sets explicit width/height on the fallback <img> to prevent CLS', () => {
    const { container } = render(<ResponsiveImage src={source} alt="A photo" sizes="100vw" />);
    const img = container.querySelector('picture img');
    expect(img?.getAttribute('width')).toBe('1200');
    expect(img?.getAttribute('height')).toBe('800');
  });

  it('marks decorative images (empty alt) with role=presentation and aria-hidden (VAL-SEO-011)', () => {
    const { container } = render(<ResponsiveImage src={source} alt="" sizes="100vw" />);
    const img = container.querySelector('picture img');
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('role')).toBe('presentation');
    expect(img?.getAttribute('aria-hidden')).toBe('true');
  });

  it('loads eagerly with fetchpriority=high when priority is set', () => {
    const { container } = render(<ResponsiveImage src={source} alt="hero" sizes="100vw" priority />);
    const img = container.querySelector('picture img');
    expect(img?.getAttribute('loading')).toBe('eager');
    expect(img?.getAttribute('fetchpriority')).toBe('high');
  });

  it('defaults to lazy loading without priority', () => {
    const { container } = render(<ResponsiveImage src={source} alt="hero" sizes="100vw" />);
    const img = container.querySelector('picture img');
    expect(img?.getAttribute('loading')).toBe('lazy');
    expect(img?.getAttribute('fetchpriority')).toBeNull();
  });
});
