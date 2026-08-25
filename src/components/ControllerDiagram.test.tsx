import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ControllerDiagram } from './ControllerDiagram';

describe('Joy-Con rail button layout', () => {
  it('mirrors SL and SR between the left and right Joy-Con rails', () => {
    const { container, rerender } = render(<ControllerDiagram kind="joycon-left" />);

    expect(container.querySelector('[data-button="slLeft"]')).toHaveAttribute('y', '188');
    expect(container.querySelector('[data-button="srLeft"]')).toHaveAttribute('y', '263');
    expect(
      [...container.querySelectorAll('.diagram-rail text')].map((label) => label.textContent)
    ).toEqual(['SL', 'SR']);

    rerender(<ControllerDiagram kind="joycon-right" />);

    expect(container.querySelector('[data-button="srRight"]')).toHaveAttribute('y', '188');
    expect(container.querySelector('[data-button="slRight"]')).toHaveAttribute('y', '263');
    expect(
      [...container.querySelectorAll('.diagram-rail text')].map((label) => label.textContent)
    ).toEqual(['SR', 'SL']);
  });
});
