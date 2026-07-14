import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

describe('App shell', () => {
  it('renders the product name', () => {
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /crisismap ai/i,
      }),
    ).toBeInTheDocument();
  });

  it('lists the placeholder surfaces', () => {
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );
    expect(screen.getByText('Citizen submission')).toBeInTheDocument();
    expect(screen.getByText('Coordinator dashboard')).toBeInTheDocument();
  });
});
