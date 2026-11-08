import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RateLimitedCard } from './RateLimitedCard';

describe('RateLimitedCard', () => {
  it('should render the rate-limit heading', () => {
    render(<RateLimitedCard message="Try again later." />);
    expect(screen.getByText(/You've used your free blueprint for this 30-day window\./i)).toBeInTheDocument();
  });

  it('should render the provided message', () => {
    render(<RateLimitedCard message="Your next blueprint unlocks on June 15." />);
    expect(screen.getByText('Your next blueprint unlocks on June 15.')).toBeInTheDocument();
  });

  it('should expose a polite live-region status role', () => {
    render(<RateLimitedCard message="Try again later." />);
    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('should explain the free-tier generation allowance', () => {
    render(<RateLimitedCard message="Try again later." />);
    expect(
      screen.getByText(/The free tier includes a limited number of architecture generations/i),
    ).toBeInTheDocument();
  });

  it('should render the embedded Pro waitlist with custom heading and subheading', () => {
    render(<RateLimitedCard message="Try again later." />);
    expect(screen.getByText('Want more blueprints?')).toBeInTheDocument();
    expect(screen.getByText(/Join the Pro waitlist for higher limits/i)).toBeInTheDocument();
  });

  it('should render the waitlist email input and join button', () => {
    render(<RateLimitedCard message="Try again later." />);
    expect(screen.getByRole('textbox', { name: /email address/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join waitlist/i })).toBeInTheDocument();
  });
});
