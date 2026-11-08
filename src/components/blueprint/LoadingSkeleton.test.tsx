import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoadingSkeleton from './LoadingSkeleton';

describe('LoadingSkeleton', () => {
  it('should render a live status region for assistive tech', () => {
    render(<LoadingSkeleton />);
    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-label', 'Generating blueprint');
  });

  it('should render the default thinking message when no message prop is given', () => {
    render(<LoadingSkeleton />);
    expect(screen.getByText('Designing your architecture…')).toBeInTheDocument();
  });

  it('should render a custom message when the message prop is provided', () => {
    render(<LoadingSkeleton message="Provisioning your stack…" />);
    expect(screen.getByText('Provisioning your stack…')).toBeInTheDocument();
    expect(screen.queryByText('Designing your architecture…')).not.toBeInTheDocument();
  });

  it('should render every progress message in a list', () => {
    render(<LoadingSkeleton />);
    const expectedMessages = [
      'Sketching the data flow…',
      'Picking services that fit the budget…',
      'Drafting the IaC scaffold…',
      'Scoping IAM policies…',
      'Shaping Claude artifacts…',
      'Checking the diagram…',
    ];
    expectedMessages.forEach((msg) => {
      expect(screen.getByText(msg)).toBeInTheDocument();
    });
    expect(screen.getAllByRole('listitem')).toHaveLength(expectedMessages.length);
  });

  it('should render the animated placeholder blocks', () => {
    const { container } = render(<LoadingSkeleton />);
    const placeholders = container.querySelectorAll('.animate-pulse');
    // One tall block, two side-by-side blocks, one wide block.
    expect(placeholders).toHaveLength(4);
  });

  it('should render the spinning indicator as decorative', () => {
    const { container } = render(<LoadingSkeleton />);
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
    expect(spinner).toHaveAttribute('aria-hidden', 'true');
  });
});
