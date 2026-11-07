import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';

// Mock GSAP — the Home page uses FadeReveal/SplitReveal which register ScrollTrigger
// at module-eval time. Without this mock, ScrollTrigger's internal _sync setTimeout
// fires after jsdom teardown and throws "requestAnimationFrame is not defined",
// surfacing as an Unhandled Error that fails CI even though every test passed.
// Matches the pattern in FadeReveal.test.tsx and AWS.integration.test.tsx.
vi.mock('gsap', () => ({
  default: {
    registerPlugin: vi.fn(),
    context: (callback: () => void) => {
      callback();
      return { revert: vi.fn() };
    },
    timeline: vi.fn(() => ({
      fromTo: vi.fn(),
      to: vi.fn(),
      scrollTrigger: { kill: vi.fn() },
      kill: vi.fn(),
    })),
    utils: { toArray: () => [] },
  },
  gsap: {
    registerPlugin: vi.fn(),
    context: (callback: () => void) => {
      callback();
      return { revert: vi.fn() };
    },
    timeline: vi.fn(() => ({
      fromTo: vi.fn(),
      to: vi.fn(),
      scrollTrigger: { kill: vi.fn() },
      kill: vi.fn(),
    })),
    utils: { toArray: () => [] },
  },
}));
vi.mock('gsap/ScrollTrigger', () => ({ ScrollTrigger: {} }));

// Mock responsive image imports (`?responsive` Vite plugin runs at build/dev,
// not under Vitest). Each mock returns the ResponsiveImageSource shape.
vi.mock('../../assets/profile1.jpeg?responsive', () => ({
  default: {
    fallback: { src: '/mock-profile1.jpeg', width: 1200, height: 1500 },
    avif: [{ src: '/mock-profile1.avif', width: 1200 }],
    webp: [{ src: '/mock-profile1.webp', width: 1200 }],
    width: 1200,
    height: 1500,
  },
}));
vi.mock('../../assets/aws-hero.png?responsive', () => ({
  default: {
    fallback: { src: '/mock-aws-hero.png', width: 1366, height: 768 },
    avif: [{ src: '/mock-aws-hero.avif', width: 1366 }],
    webp: [{ src: '/mock-aws-hero.webp', width: 1366 }],
    width: 1366,
    height: 768,
  },
}));
vi.mock('../../assets/aws-community-builder.webp?responsive', () => ({
  default: {
    fallback: { src: '/mock-aws-cb.webp', width: 1920, height: 1005 },
    avif: [{ src: '/mock-aws-cb.avif', width: 1920 }],
    webp: [{ src: '/mock-aws-cb.webp', width: 1920 }],
    width: 1920,
    height: 1005,
  },
}));

// Mock Sanity client for Blog page
vi.mock('../../sanity', async () => {
  // Keep the real pure helpers (shape guards + error classification); stub I/O.
  const actual = await vi.importActual<typeof import('../../sanity')>('../../sanity');
  return {
    client: { fetch: vi.fn().mockResolvedValue({ posts: [], tags: [], series: [] }) },
    urlFor: () => ({
      width: () => ({ height: () => ({ auto: () => ({ quality: () => ({ url: () => 'https://mock.jpg' }) }) }) }),
    }),
    BLOG_LISTING_QUERY: 'mock-query',
    POST_BY_SLUG_QUERY: 'mock-query',
    getBlogListingCache: vi.fn().mockReturnValue(null),
    setBlogListingCache: vi.fn(),
    getPostCache: vi.fn().mockReturnValue(null),
    setPostCache: vi.fn(),
    classifySanityError: actual.classifySanityError,
    isBlogListingResult: actual.isBlogListingResult,
    // Blog.tsx reads all four guards. Only the empty-posts fixture below keeps
    // the last two from ever being touched, so omitting them leaves the mock one
    // fixture change away from throwing "No export is defined on the mock".
    isRenderableImageSource: actual.isRenderableImageSource,
    isSanityPost: actual.isSanityPost,
    isSanityPostPreview: actual.isSanityPostPreview,
  };
});

vi.mock('../../utils/routeManifest', () => ({
  prefetchBlogPostChunk: vi.fn(),
  prefetchRoute: vi.fn(),
}));

import Home from '../../pages/Home';
import Blog from '../../pages/Blog';
import Contact from '../../pages/Contact';
import AWS from '../../pages/AWS';

const renderPage = (PageComponent: React.ComponentType, route: string) => {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[route]}>
        <PageComponent />
      </MemoryRouter>
    </HelmetProvider>,
  );
};

describe('SEO Integration Across Pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // React 19 + react-helmet-async + jsdom: Helmet manipulates document.head
    // outside React's tree. During unmount, React 19's stricter reconciliation
    // may throw when trying to remove already-detached nodes.
    // This only affects jsdom — browsers handle it fine.
    try {
      cleanup();
    } catch {
      // Ignore removeChild errors from Helmet + React 19 unmount race
    }
    document.title = '';
    document.head
      .querySelectorAll('meta, link[rel="canonical"], link[rel="preconnect"], script[type="application/ld+json"]')
      .forEach((el) => el.remove());
  });

  describe('Per-route preconnect injection (VAL-PERF-008)', () => {
    it('Home does not preconnect to a retired hero video origin', async () => {
      renderPage(Home, '/');
      await waitFor(() => {
        expect(document.title).toContain('Christian Perez');
      });
      expect(
        document.head.querySelector('link[rel="preconnect"][href="https://d1x8296f4gso9u.cloudfront.net"]'),
      ).toBeNull();
    });

    it('Blog preconnects to the Sanity CDN', async () => {
      renderPage(Blog, '/blog');
      await waitFor(() => {
        const preconnect = document.head.querySelector('link[rel="preconnect"][href="https://cdn.sanity.io"]');
        expect(preconnect, '/blog should preconnect to cdn.sanity.io').not.toBeNull();
      });
    });

    it('AWS (no route-specific preconnects) does NOT emit cdn.sanity.io or CloudFront preconnects', async () => {
      renderPage(AWS, '/aws');
      await waitFor(() => {
        expect(document.title).toContain('Amazon Web Services');
      });
      expect(
        document.head.querySelector('link[rel="preconnect"][href="https://cdn.sanity.io"]'),
        '/aws must not preconnect to cdn.sanity.io',
      ).toBeNull();
      expect(
        document.head.querySelector('link[rel="preconnect"][href="https://d1x8296f4gso9u.cloudfront.net"]'),
        '/aws must not preconnect to the CloudFront video origin',
      ).toBeNull();
      expect(
        document.head.querySelector('link[rel="preconnect"][href="https://i.ytimg.com"]'),
        '/aws must not preconnect to i.ytimg.com (no YouTube facade)',
      ).toBeNull();
    });
  });

  describe('Home page SEO', () => {
    it('sets correct title', async () => {
      renderPage(Home, '/');
      await waitFor(() => {
        expect(document.title).toContain('Christian Perez');
      });
    });

    it('sets correct meta description', async () => {
      renderPage(Home, '/');
      await waitFor(() => {
        const meta = document.querySelector('meta[name="description"]');
        expect(meta).toBeTruthy();
        expect(meta?.getAttribute('content')).toContain('Christian Perez');
      });
    });

    it('includes JSON-LD with Person and Organization schemas', async () => {
      renderPage(Home, '/');
      await waitFor(() => {
        const script = document.querySelector('script[type="application/ld+json"]');
        expect(script).toBeTruthy();
        const content = script?.textContent || '';
        const data = JSON.parse(content);
        const types = data['@graph']?.map((item: { '@type': string }) => item['@type']);
        expect(types).toContain('Person');
        expect(types).toContain('Corporation');
        expect(types).toContain('WebSite');
      });
    });

    it('includes FAQ schema', async () => {
      renderPage(Home, '/');
      await waitFor(() => {
        const script = document.querySelector('script[type="application/ld+json"]');
        const content = script?.textContent || '';
        expect(content).toContain('FAQPage');
      });
    });

    it('includes WebPage structured data', async () => {
      renderPage(Home, '/');
      await waitFor(() => {
        const script = document.querySelector('script[type="application/ld+json"]');
        const content = script?.textContent || '';
        expect(content).toContain('WebPage');
      });
    });

    it('sets canonical URL', async () => {
      renderPage(Home, '/');
      await waitFor(() => {
        const canonical = document.querySelector('link[rel="canonical"]');
        expect(canonical).toHaveAttribute('href', 'https://thechrisgrey.com');
      });
    });

    it('sets OG and Twitter meta tags', async () => {
      renderPage(Home, '/');
      await waitFor(() => {
        const ogTitle = document.querySelector('meta[property="og:title"]');
        expect(ogTitle).toBeTruthy();

        const twitterCard = document.querySelector('meta[name="twitter:card"]');
        expect(twitterCard).toHaveAttribute('content', 'summary_large_image');

        const twitterCreator = document.querySelector('meta[name="twitter:creator"]');
        expect(twitterCreator).toHaveAttribute('content', '@thechrisgrey');
      });
    });
  });

  describe('Blog page SEO', () => {
    it('sets title to "Blog | Christian Perez"', async () => {
      renderPage(Blog, '/blog');
      await waitFor(() => {
        expect(document.title).toBe('Blog | Christian Perez');
      });
    });

    it('includes Blog structured data', async () => {
      renderPage(Blog, '/blog');
      await waitFor(() => {
        const script = document.querySelector('script[type="application/ld+json"]');
        const content = script?.textContent || '';
        // VAL-SD-004: the /blog listing emits a CollectionPage describing the
        // post collection (replaced the prior bare `Blog` node).
        expect(content).toContain('"@type":"CollectionPage"');
        expect(content).toContain('"@id":"https://thechrisgrey.com/blog/#collectionpage"');
      });
    });

    it('includes breadcrumb schema', async () => {
      renderPage(Blog, '/blog');
      await waitFor(() => {
        const script = document.querySelector('script[type="application/ld+json"]');
        const content = script?.textContent || '';
        expect(content).toContain('BreadcrumbList');
      });
    });

    it('sets OG type to website (blog listing is non-article — VAL-SEO-007)', async () => {
      renderPage(Blog, '/blog');
      await waitFor(() => {
        const ogType = document.querySelector('meta[property="og:type"]');
        expect(ogType).toHaveAttribute('content', 'website');
      });
    });
  });

  describe('Contact page SEO', () => {
    it('sets title to "Contact & Speaking | Christian Perez"', async () => {
      renderPage(Contact, '/contact');
      await waitFor(() => {
        expect(document.title).toBe('Contact & Speaking | Christian Perez');
      });
    });

    it('includes Contact page structured data', async () => {
      renderPage(Contact, '/contact');
      await waitFor(() => {
        const script = document.querySelector('script[type="application/ld+json"]');
        const content = script?.textContent || '';
        expect(content).toContain('ContactPage');
      });
    });

    it('sets canonical URL to the contact page', async () => {
      renderPage(Contact, '/contact');
      await waitFor(() => {
        const canonical = document.querySelector('link[rel="canonical"]');
        expect(canonical).toHaveAttribute('href', 'https://thechrisgrey.com/contact');
      });
    });

    it('includes keywords meta tag', async () => {
      renderPage(Contact, '/contact');
      await waitFor(() => {
        const meta = document.querySelector('meta[name="keywords"]');
        expect(meta).toBeTruthy();
        expect(meta?.getAttribute('content')).toContain('speaking engagements');
      });
    });
  });

  describe('AWS page SEO', () => {
    it('sets title to "Amazon Web Services | Christian Perez"', async () => {
      renderPage(AWS, '/aws');
      await waitFor(() => {
        expect(document.title).toBe('Amazon Web Services | Christian Perez');
      });
    });

    it('includes WebPage structured data', async () => {
      renderPage(AWS, '/aws');
      await waitFor(() => {
        const script = document.querySelector('script[type="application/ld+json"]');
        const content = script?.textContent || '';
        expect(content).toContain('WebPage');
      });
    });

    it('includes breadcrumb schema', async () => {
      renderPage(AWS, '/aws');
      await waitFor(() => {
        const script = document.querySelector('script[type="application/ld+json"]');
        const content = script?.textContent || '';
        expect(content).toContain('BreadcrumbList');
      });
    });

    it('includes keywords about AWS and AI', async () => {
      renderPage(AWS, '/aws');
      await waitFor(() => {
        const meta = document.querySelector('meta[name="keywords"]');
        expect(meta).toBeTruthy();
        expect(meta?.getAttribute('content')).toContain('AWS Community Builder');
        expect(meta?.getAttribute('content')).toContain('AI Engineering');
      });
    });
  });

  describe('Cross-page SEO consistency', () => {
    it('all pages include the default Person schema', async () => {
      const pages: [React.ComponentType, string][] = [
        [Home, '/'],
        [Blog, '/blog'],
        [Contact, '/contact'],
        [AWS, '/aws'],
      ];

      for (const [Page, route] of pages) {
        // Clean up between pages
        document.title = '';
        document.head
          .querySelectorAll('meta, link[rel="canonical"], link[rel="preconnect"], script[type="application/ld+json"]')
          .forEach((el) => el.remove());

        const { unmount } = renderPage(Page, route);

        await waitFor(() => {
          const script = document.querySelector('script[type="application/ld+json"]');
          expect(script).toBeTruthy();
          const content = script?.textContent || '';
          expect(content).toContain('Person');
        });

        unmount();
      }
    });

    it('every page sets its per-route generated OG card (not the generic fallback)', async () => {
      // og:image now derives from the per-route build-time card (/og/<slug>.png)
      // rather than the shared /og.png. Exact slug mapping is covered by
      // ogCards.test.ts; here we assert each real page points at a generated card.
      const pages: [React.ComponentType, string][] = [
        [Home, '/'],
        [Blog, '/blog'],
        [Contact, '/contact'],
        [AWS, '/aws'],
      ];
      const cardUrl = /^https:\/\/thechrisgrey\.com\/og\/[a-z-]+\.png$/;

      for (const [Page, route] of pages) {
        document.head
          .querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]')
          .forEach((el) => el.remove());

        const { unmount } = renderPage(Page, route);

        await waitFor(() => {
          const ogImage = document.querySelector('meta[property="og:image"]');
          const twImage = document.querySelector('meta[name="twitter:image"]');
          expect(ogImage?.getAttribute('content')).toMatch(cardUrl);
          expect(twImage?.getAttribute('content')).toMatch(cardUrl);
        });

        unmount();
      }
    });
  });
});
