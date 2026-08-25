import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from './App';

describe('JoyConBench application shell', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'hid', { configurable: true, value: undefined });
  });

  it('shows honest unsupported-browser guidance without fabricated readings', () => {
    render(<App />);
    expect(
      screen.getByRole('heading', { name: /See exactly what your controller/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('This browser cannot access WebHID');
    expect(screen.queryByText(/59\.9|sample controller/i)).not.toBeInTheDocument();
  });

  it('states that controller processing is local', () => {
    render(<App />);
    expect(screen.getByText(/Local only/)).toBeInTheDocument();
  });

  it('presents the landing benefits as a concise ordered list', () => {
    render(<App />);
    const section = screen.getByRole('region', { name: 'How JoyConBench works' });
    expect(section.querySelector('ol.hero-benefits')).toBeInTheDocument();
    expect(section.querySelectorAll('li')).toHaveLength(3);
  });
});
