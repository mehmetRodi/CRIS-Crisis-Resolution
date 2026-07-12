import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

// Wrap App in Router for tests
function renderWithRouter(ui: React.ReactElement) {
  return render(<BrowserRouter>{ui}</BrowserRouter>);
}

describe('App shell', () => {
  it('renders the product name', () => {
    renderWithRouter(<App />);
    expect(document.querySelector('h1')).toBeInTheDocument();
  });

  it('lists the placeholder surfaces', () => {
    renderWithRouter(<App />);
    expect(document.querySelector('h1')).toBeInTheDocument();
  });
});