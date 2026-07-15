import { fireEvent, render, screen } from '@testing-library/react';
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

  it('opens the coordinator dashboard shell and returns to the overview', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /coordinator dashboard/i }));
    expect(
      screen.getByRole('heading', { level: 1, name: /coordinator dashboard/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /overview/i }));
    expect(screen.getByRole('heading', { level: 1, name: /crisismap ai/i })).toBeInTheDocument();
  });
});
