import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
const endpoint = import.meta.env.VITE_MCP_ENDPOINT || 'https://mcp.thechrisgrey.com';
import { McpInstallBadge } from './McpInstallBadge';
vi.mock('../utils/sessionToken', () => ({ getSessionToken: vi.fn(async () => 'scoped-mcp-token') }));

describe('McpInstallBadge', () => {
  const writeTextMock = vi.fn();

  beforeEach(() => {
    writeTextMock.mockReset();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the MCP server URL', () => {
    render(<McpInstallBadge />);
    expect(screen.getByText(endpoint)).toBeInTheDocument();
  });

  it('renders the Claude Desktop config snippet', () => {
    render(<McpInstallBadge />);
    const snippet = screen.getByLabelText('Claude Desktop configuration snippet');
    expect(snippet.textContent).toContain('"mcpServers"');
    expect(snippet.textContent).toContain('mcp-remote');
    expect(snippet.textContent).toContain(endpoint);
  });

  it('lists the three exposed tools', () => {
    render(<McpInstallBadge />);
    expect(screen.getByText('search_blog')).toBeInTheDocument();
    expect(screen.getByText('get_blog_post')).toBeInTheDocument();
    expect(screen.getByText('ask_alti')).toBeInTheDocument();
  });

  it('mentions the rate limit in the footer', () => {
    render(<McpInstallBadge />);
    expect(screen.getByText(/rate-limited to 60 requests per hour per IP/i)).toBeInTheDocument();
  });

  it('copies the server URL to the clipboard when the URL copy button is clicked', async () => {
    writeTextMock.mockResolvedValueOnce(undefined);

    render(<McpInstallBadge />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy URL' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    });
    expect(writeTextMock).toHaveBeenCalledWith(endpoint);
  });

  it('copies the Claude Desktop config snippet when the config copy button is clicked', async () => {
    writeTextMock.mockResolvedValueOnce(undefined);

    render(<McpInstallBadge />);
    fireEvent.click(screen.getByRole('button', { name: 'Generate session config' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy config' }));

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledTimes(1);
    });
    const copiedValue = writeTextMock.mock.calls[0][0] as string;
    expect(copiedValue).toContain('"mcpServers"');
    expect(copiedValue).toContain('"mcp-remote"');
    expect(copiedValue).toContain('Authorization:Bearer scoped-mcp-token');
    expect(copiedValue).toContain(endpoint);
  });

  it('returns to the idle label after the copied state expires', async () => {
    writeTextMock.mockResolvedValueOnce(undefined);
    vi.useFakeTimers({ shouldAdvanceTime: true });

    render(<McpInstallBadge />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy URL' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    });

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copy URL' })).toBeInTheDocument();
    });
  });

  it('shows a failure state when the clipboard write rejects', async () => {
    writeTextMock.mockRejectedValueOnce(new Error('denied'));

    render(<McpInstallBadge />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy URL' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copy failed' })).toBeInTheDocument();
    });
  });
});
