import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PanelResizeHandle } from './PanelResizeHandle';
function Panel() {
  const [width, setWidth] = useState(300);
  return (
    <PanelResizeHandle
      label="Resize incident list"
      controls="queue"
      width={width}
      onResize={setWidth}
    />
  );
}
describe('Panel resizing by keyboard', () => {
  it('names the divider and adjusts within limits', () => {
    render(<Panel />);
    const divider = screen.getByRole('separator', { name: 'Resize incident list' });
    divider.focus();
    expect(divider).toHaveFocus();
    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(divider).toHaveAttribute('aria-valuenow', '320');
    fireEvent.keyDown(divider, { key: 'Home' });
    expect(divider).toHaveAttribute('aria-valuenow', '240');
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(divider).toHaveAttribute('aria-valuenow', '240');
    fireEvent.keyDown(divider, { key: 'End' });
    expect(divider).toHaveAttribute('aria-valuenow', '480');
  });
});
