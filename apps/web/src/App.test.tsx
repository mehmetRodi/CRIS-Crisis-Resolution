import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App shell', () => {
  it('renders the product name', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: /crisismap ai/i })).toBeInTheDocument();
  });

  it('lists the placeholder surfaces', () => {
    render(<App />);
    expect(screen.getByText('Citizen submission')).toBeInTheDocument();
    expect(screen.getByText('Coordinator dashboard')).toBeInTheDocument();
  });
});
