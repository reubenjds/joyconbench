import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EMPTY_BUTTONS, type ControllerSample } from '../types/controller';
import { ControllerDiagram } from './ControllerDiagram';

describe('Joy-Con rail button layout', () => {
  it('mirrors SL and SR between the left and right Joy-Con rails', () => {
    const { container, rerender } = render(<ControllerDiagram kind="joycon-left" showSideView />);

    expect(container.querySelector('.diagram-side-view [data-button="slLeft"]')).toHaveAttribute(
      'y',
      '546.99408'
    );
    expect(container.querySelector('.diagram-side-view [data-button="srLeft"]')).toHaveAttribute(
      'y',
      '715.82904'
    );
    expect(container.querySelector('.front-rail')).toBeInTheDocument();
    expect(container.querySelector('.side-rail')).toHaveAttribute('width', '38.6479');
    expect(container.querySelector('.diagram-side-view')).toHaveAttribute(
      'transform',
      'translate(200 14)'
    );
    expect(container.querySelector('.side-stick')).not.toBeInTheDocument();
    expect(container.querySelector('.rail-label')).toHaveAttribute('dominant-baseline', 'central');
    expect(
      [...container.querySelectorAll('.diagram-side-view text:not(.trigger-label)')].map(
        (label) => label.textContent
      )
    ).toEqual(['SL', 'SR']);

    rerender(<ControllerDiagram kind="joycon-right" showSideView />);

    expect(container.querySelector('.diagram-side-view [data-button="srRight"]')).toHaveAttribute(
      'y',
      '546.99408'
    );
    expect(container.querySelector('.diagram-side-view [data-button="slRight"]')).toHaveAttribute(
      'y',
      '715.82904'
    );
    expect(
      [...container.querySelectorAll('.diagram-side-view text:not(.trigger-label)')].map(
        (label) => label.textContent
      )
    ).toEqual(['SR', 'SL']);
  });

  it('includes the shoulder and trigger controls for each controller side', () => {
    const { container, rerender } = render(<ControllerDiagram kind="joycon-left" showSideView />);

    expect(container.querySelector('[data-button="l"]')).toBeInTheDocument();
    expect(container.querySelector('[data-button="zl"]')).toBeInTheDocument();

    rerender(<ControllerDiagram kind="joycon-right" showSideView />);

    expect(container.querySelector('[data-button="r"]')).toBeInTheDocument();
    expect(container.querySelector('[data-button="zr"]')).toBeInTheDocument();
  });

  it('keeps the compact front-only view when the side view is not requested', () => {
    const { container } = render(<ControllerDiagram kind="joycon-left" />);

    expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 180 500');
    expect(container.querySelector('.diagram-side-view')).not.toBeInTheDocument();
  });

  it('uses the slim reference proportions for minus and plus', () => {
    const { container, rerender } = render(<ControllerDiagram kind="joycon-left" />);

    expect(container.querySelector('.minus-plus-face')).toHaveAttribute('height', '6');

    rerender(<ControllerDiagram kind="joycon-right" />);

    expect(container.querySelector('.minus-plus-face')).toHaveAttribute(
      'd',
      'M52.5 80v-10h5v10h10v5h-10v10h-5v-10h-10v-5Z'
    );
  });

  it('lights the matching side button in both front and rail-facing views', () => {
    const sample = {
      buttons: { ...EMPTY_BUTTONS, slLeft: true },
      sticks: {},
    } as ControllerSample;
    const { container } = render(
      <ControllerDiagram kind="joycon-left" sample={sample} showSideView />
    );

    expect(container.querySelector('.diagram-front-rail [data-button="slLeft"]')).toHaveClass(
      'active'
    );
    expect(container.querySelector('.diagram-side-view [data-button="slLeft"]')).toHaveClass(
      'active'
    );
    expect(container.querySelector('.diagram-front-rail [data-button="srLeft"]')).not.toHaveClass(
      'active'
    );
  });
});
