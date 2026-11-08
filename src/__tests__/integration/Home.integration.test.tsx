import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';

// Mock the responsive profile image import (the `?responsive` Vite plugin only
// runs during build/dev, not under Vitest).
vi.mock('../../assets/profile1.jpeg?responsive', () => ({
  default: {
    fallback: { src: '/mock-profile1.jpeg', width: 1200, height: 1500 },
    avif: [{ src: '/mock-profile1.avif', width: 1200 }],
    webp: [{ src: '/mock-profile1.webp', width: 1200 }],
    width: 1200,
    height: 1500,
  },
}));

import Home from '../../pages/Home';

const renderHome = () => {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/']}>
        <Home />
      </MemoryRouter>
    </HelmetProvider>,
  );
};

describe('Home Page Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Hero section', () => {
    it('renders the bento hero without the retired video dependency', () => {
      const { container } = renderHome();
      expect(container.querySelector('section video')).toBeNull();
      expect(screen.getByText(/founder.*operator.*builder/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /the story/i })).toHaveAttribute('href', '/about');
      expect(screen.getByRole('link', { name: /start a conversation/i })).toHaveAttribute('href', '/contact');
    });

    it('renders an accessible h1 heading for screen readers', () => {
      renderHome();
      const heading = screen.getByRole('heading', {
        level: 1,
        name: /christian perez/i,
      });
      expect(heading).toBeInTheDocument();
    });
  });

  describe('Summary section with key points', () => {
    it('renders all 5 key points with correct titles', () => {
      renderHome();
      // Work cards follow the section heading in the document outline.
      const headings = screen.getAllByRole('heading', { level: 3 });
      const titles = headings.map((h) => h.textContent?.replace(/\s+/g, ' ').trim());
      expect(titles).toContain('Personal Biography');
      expect(titles).toContain('Altivum Inc');
      expect(titles).toContain('The Vector Podcast');
      expect(titles).toContain('Beyond the Assessment');
      expect(titles).toContain('Amazon Web Services');
    });

    it('renders all 5 key points with correct subtitles', () => {
      renderHome();
      expect(screen.getAllByText('Christian Perez')).toHaveLength(2);
      expect(screen.getByText('Founder & CEO')).toBeInTheDocument();
      expect(screen.getByText('Host')).toBeInTheDocument();
      expect(screen.getByText('Author')).toBeInTheDocument();
      expect(screen.getByText('AWS Community Builder (AI Engineering)')).toBeInTheDocument();
    });

    it('renders key points as links to their respective pages', () => {
      renderHome();

      const links = screen.getAllByRole('link');
      const findLink = (href: string) => links.find((l) => l.getAttribute('href') === href);

      expect(findLink('/about')).toBeDefined();
      expect(findLink('/altivum')).toBeDefined();
      expect(findLink('/podcast')).toBeDefined();
      expect(findLink('/beyond-the-assessment')).toBeDefined();
      expect(findLink('/aws')).toBeDefined();
    });

    it('provides responsive JPEGs without downloading a second portrait', () => {
      renderHome();
      const portraits = screen.getAllByAltText('Christian Perez');
      expect(portraits).toHaveLength(1);
      expect(portraits[0]).toHaveAttribute('srcset', expect.stringContaining('hero-portrait-480.jpg'));
      expect(portraits[0]).toHaveAttribute('fetchpriority', 'high');
    });
  });

  describe('CTA section', () => {
    it('renders the "Let\'s Connect" heading', () => {
      renderHome();
      const heading = screen.getByRole('heading', { name: /let's connect/i });
      expect(heading).toBeInTheDocument();
    });

    it('renders a LinkedIn social link with correct href', () => {
      renderHome();
      const linkedinLinks = screen.getAllByRole('link', { name: /linkedin/i });
      const ctaLinkedIn = linkedinLinks.find(
        (link) => link.getAttribute('href') === 'https://www.linkedin.com/in/thechrisgrey/',
      );
      expect(ctaLinkedIn).toBeInTheDocument();
      expect(ctaLinkedIn).toHaveAttribute('target', '_blank');
      expect(ctaLinkedIn).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('renders an Instagram social link with correct href', () => {
      renderHome();
      const instagramLinks = screen.getAllByRole('link', { name: /instagram/i });
      const ctaInstagram = instagramLinks.find(
        (link) => link.getAttribute('href') === 'https://www.instagram.com/thechrisgrey/',
      );
      expect(ctaInstagram).toBeInTheDocument();
      expect(ctaInstagram).toHaveAttribute('target', '_blank');
    });

    it('renders a link to the Links page (demoted to "All links")', () => {
      renderHome();
      const allLinks = screen.getByRole('link', { name: /^all links$/i });
      expect(allLinks).toHaveAttribute('href', '/links');
    });

    it('leads the CTA with a newsletter capture (owned-audience conversion)', () => {
      renderHome();
      expect(screen.getByPlaceholderText('Enter your email address')).toBeInTheDocument();
    });

    it('offers podcast and book CTAs that route to the right pages', () => {
      renderHome();
      expect(screen.getByRole('link', { name: /listen to the podcast/i })).toHaveAttribute('href', '/podcast');
      expect(screen.getByRole('link', { name: /get the book/i })).toHaveAttribute('href', '/beyond-the-assessment');
    });
  });

  describe('Testimonials section', () => {
    it('renders at least one testimonial card with quote and attribution from the shared data source', () => {
      renderHome();
      // The Testimonials component renders from the default TESTIMONIALS array.
      expect(screen.getByRole('heading', { name: /in their words/i })).toBeInTheDocument();
      const firstQuote = screen.getByText(/Christian brings the same clarity/);
      expect(firstQuote).toBeInTheDocument();
      // Attribution is rendered as a figcaption author name.
      expect(screen.getByText(/Placeholder — replace with a real client quote/)).toBeInTheDocument();
    });
  });

  describe('SEO metadata', () => {
    it('sets the page title correctly', async () => {
      renderHome();
      // react-helmet-async sets document.title asynchronously in jsdom
      await vi.waitFor(() => {
        expect(document.title).toBe('Christian Perez | Christian Perez');
      });
    });

    it('includes JSON-LD structured data', async () => {
      renderHome();
      await vi.waitFor(() => {
        const script = document.querySelector('script[type="application/ld+json"]');
        expect(script).toBeTruthy();
        const content = script?.textContent || '';
        expect(content).toContain('@context');
        expect(content).toContain('schema.org');
      });
    });

    it('includes FAQ schema from homeFAQs', async () => {
      renderHome();
      await vi.waitFor(() => {
        const script = document.querySelector('script[type="application/ld+json"]');
        const content = script?.textContent || '';
        expect(content).toContain('FAQPage');
      });
    });
  });
});
