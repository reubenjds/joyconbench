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

describe('Pro Controller silhouette', () => {
  it('uses the supplied controller body geometry as its structural base', () => {
    const { container } = render(<ControllerDiagram kind="pro-controller" />);
    const diagram = container.querySelector('.pro-diagram');

    expect(diagram).toHaveAttribute('viewBox', '0 0 525 446');
    expect(container.querySelector('.pro-body')).toHaveAttribute(
      'd',
      'M64 112c7-23 28-39 52-39h293c24 0 45 16 52 39l20 80-102 130H153L50 192Z'
    );
    expect(container.querySelectorAll('.pro-grip')).toHaveLength(2);
    expect(container.querySelector('.diagram-dpad')).toBeInTheDocument();
    expect(container.querySelector('[data-button="zl"]')).toHaveTextContent('ZL');
    expect(container.querySelector('[data-button="zr"]')).toHaveTextContent('ZR');
    expect(container.querySelector('[data-button="l"]')).toHaveTextContent('L');
    expect(container.querySelector('[data-button="r"]')).toHaveTextContent('R');
  });
});
