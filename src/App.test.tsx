import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from './App';

describe('JoyConBench application shell', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'hid', { configurable: true, value: undefined });
  });

  it('shows honest unsupported-browser guidance without fabricated readings', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /Test your controller/i })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('This browser cannot access WebHID');
    expect(screen.queryByText(/59\.9|sample controller/i)).not.toBeInTheDocument();
  });

  it('states that controller processing is local', () => {
    render(<App />);
    expect(screen.getByText(/Runs in your browser/)).toBeInTheDocument();
  });

  it('opens a local development preview without WebHID', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Preview without controller' }));
    expect(await screen.findByRole('heading', { name: 'Controller colours' })).toBeInTheDocument();
    expect(screen.getByText('Preview Left Joy-Con')).toBeInTheDocument();
    expect(screen.getByText('Local preview data')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Colours' })).toHaveAttribute('aria-current', 'page');
  });

  it('presents the landing benefits as a concise ordered list', () => {
    render(<App />);
    const section = screen.getByRole('region', { name: 'How JoyConBench works' });
    expect(section.querySelector('ol.hero-benefits')).toBeInTheDocument();
    expect(section.querySelectorAll('li')).toHaveLength(3);
  });
});
