import { useState } from 'react';

/**
 * Responsive <picture> component for raster images imported via the
 * `?responsive` Vite plugin (vite-plugins/responsive-images.ts).
 *
 * Emits AVIF + WebP <source> elements with a srcset spanning every generated
 * width, plus a JPEG/PNG fallback <img>, with explicit width/height to reserve
 * box space and prevent CLS (VAL-PERF-004/005).
 *
 * The `src` prop is the default export of a `?responsive` import:
 *   import profile from '../assets/profile1.jpeg?responsive';
 *   <ResponsiveImage src={profile} alt="..." sizes="(min-width: 1024px) 50vw, 100vw" />
 */
export interface ResponsiveImageSource {
  fallback: { src: string; width: number; height: number };
  avif: { src: string; width: number }[];
  webp: { src: string; width: number }[];
  width: number;
  height: number;
}

export interface ResponsiveImageProps {
  src: ResponsiveImageSource;
  alt: string;
  /** sizes attribute for the <source> srcset (e.g. "100vw" or "(min-width:768px) 50vw, 100vw"). */
  sizes: string;
  className?: string;
  /** Inline styles forwarded to the fallback <img> (e.g. color grading). */
  style?: React.CSSProperties;
  /** Render eagerly with fetchpriority=high (above-the-fold / LCP images). */
  priority?: boolean;
  /** Override the fallback img loading strategy; defaults to lazy unless priority. */
  loading?: 'lazy' | 'eager';
}

const buildSrcSet = (variants: { src: string; width: number }[]) =>
  variants.map((v) => `${v.src} ${v.width}w`).join(', ');

const ResponsiveImage = ({ src, alt, sizes, className, style, priority = false, loading }: ResponsiveImageProps) => {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const useFallback = failedSource === src.fallback.src;
  const isDecorative = !alt.trim();
  const imgLoading = loading ?? (priority ? 'eager' : 'lazy');
  const imgDecoding = priority ? 'sync' : 'async';

  return (
    <picture>
      {!useFallback && src.avif.length > 0 && <source type="image/avif" srcSet={buildSrcSet(src.avif)} sizes={sizes} />}
      {!useFallback && src.webp.length > 0 && <source type="image/webp" srcSet={buildSrcSet(src.webp)} sizes={sizes} />}
      <img
        src={src.fallback.src}
        onError={() => setFailedSource(src.fallback.src)}
        width={src.fallback.width}
        height={src.fallback.height}
        alt={alt}
        sizes={sizes}
        loading={imgLoading}
        decoding={imgDecoding}
        {...(priority ? { fetchPriority: 'high' } : {})}
        {...(isDecorative ? { role: 'presentation', 'aria-hidden': 'true' } : {})}
        className={className}
        style={style}
      />
    </picture>
  );
};

export default ResponsiveImage;
