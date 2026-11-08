import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import ScrollToTop from './ScrollToTop';

describe('ScrollToTop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock window.scrollTo
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });

  it('should call window.scrollTo on initial render', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <ScrollToTop />
      </MemoryRouter>,
    );

    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 0,
      left: 0,
      behavior: 'instant',
    });
  });

  it('should call window.scrollTo when pathname changes', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/page1']}>
        <ScrollToTop />
      </MemoryRouter>,
    );

    expect(window.scrollTo).toHaveBeenCalledTimes(1);

    unmount();

    // Re-render with a different path
    render(
      <MemoryRouter initialEntries={['/page2']}>
        <ScrollToTop />
      </MemoryRouter>,
    );

    expect(window.scrollTo).toHaveBeenCalledTimes(2);
  });

  it('should render nothing (return null)', () => {
    const { container } = render(
      <MemoryRouter>
        <ScrollToTop />
      </MemoryRouter>,
    );

    expect(container.innerHTML).toBe('');
  });

  it('should scroll to top with instant behavior', () => {
    render(
      <MemoryRouter initialEntries={['/about']}>
        <ScrollToTop />
      </MemoryRouter>,
    );

    expect(window.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'instant' }));
  });
});

function HistoryControls() {
  const navigate = useNavigate();
  return (
    <>
      <ScrollToTop />
      <button onClick={() => navigate('/about')}>Next</button>
      <button onClick={() => navigate(-1)}>Back</button>
    </>
  );
}

it('restores a previous page position when navigating back', () => {
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  render(
    <MemoryRouter initialEntries={['/blog']}>
      <HistoryControls />
    </MemoryRouter>,
  );
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 700 });
  fireEvent.scroll(window);
  fireEvent.click(screen.getByText('Next'));
  fireEvent.click(screen.getByText('Back'));
  expect(scroll).toHaveBeenLastCalledWith({ top: 700, left: 0, behavior: 'instant' });
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
});
