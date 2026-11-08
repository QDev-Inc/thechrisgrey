import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HeroBento from './HeroBento';

vi.mock('gsap', () => ({
  default: {
    registerPlugin: vi.fn(),
    context: (callback: () => void) => {
      callback();
      return { revert: vi.fn() };
    },
    timeline: () => ({ to: vi.fn() }),
    utils: { toArray: () => [] },
  },
}));

vi.mock('gsap/ScrollTrigger', () => ({ ScrollTrigger: {} }));

const renderHero = () =>
  render(
    <MemoryRouter>
      <HeroBento />
    </MemoryRouter>,
  );

describe('HeroBento', () => {
  it('restores the original PNG if a responsive portrait cannot load', () => {
    renderHero();
    const portrait = screen.getByRole('img', { name: 'Christian Perez' });
    fireEvent.error(portrait);
    expect(portrait).not.toHaveAttribute('srcset');
    expect(portrait).toHaveAttribute('src', '/press-kit/headshots/Professional%20Headshot.png');
    fireEvent.error(portrait);
    expect(portrait).toHaveAttribute('src', '/press-kit/headshots/Professional%20Headshot.png');
  });

  it('presents a complete accessible introduction without relying on a video or canvas', () => {
    const { container } = renderHero();

    expect(screen.getByRole('heading', { level: 1, name: /christian perez/i })).toBeInTheDocument();
    expect(screen.getByText(/founder.*operator.*builder/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /the story/i })).toHaveAttribute('href', '/about');
    expect(screen.getByRole('link', { name: /start a conversation/i })).toHaveAttribute('href', '/contact');
    expect(screen.getByRole('img', { name: 'Christian Perez' })).toHaveAttribute(
      'src',
      expect.stringContaining('hero-portrait-960.jpg'),
    );
    expect(container.querySelector('video, canvas')).toBeNull();
  });

  it('provides direct paths into the work that follows the hero', () => {
    renderHero();

    const quantumDevLink = screen.getByRole('link', { name: /q dev inc/i });
    expect(quantumDevLink).toHaveAttribute('href', 'https://quantumdev.io');
    expect(quantumDevLink).toHaveAttribute('target', '_blank');
    expect(quantumDevLink).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: /ai.*cloud/i })).toHaveAttribute('href', '/aws');
    expect(screen.getByRole('link', { name: /the vector podcast/i })).toHaveAttribute('href', '/podcast');
  });
});
