import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom';
import App from './App';
import { CoordinatorDashboard } from './surfaces/coordinator/CoordinatorDashboard';

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

  it('navigates to the coordinator dashboard shell when its card is activated', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/coordinator" element={<CoordinatorDashboard onExit={() => {}} />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /coordinator dashboard/i }));
    expect(
      screen.getByRole('heading', { level: 1, name: /coordinator dashboard/i }),
    ).toBeInTheDocument();
  });
});
