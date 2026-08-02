import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ViewControls, type ViewControlsProps } from './ViewControls';

function show(overrides: Partial<ViewControlsProps> = {}) {
  const props: ViewControlsProps = {
    showCycleLabels: false,
    onShowCycleLabelsChange: vi.fn(),
    cycleLabelsUnavailable: undefined,
    ...overrides,
  };

  return { ...render(<ViewControls {...props} />), props };
}

const toggle = () => screen.getByRole('checkbox', { name: /cycle labels/i });

describe('ViewControls', () => {
  it('reports the toggle being turned on', () => {
    const { props } = show();

    fireEvent.click(toggle());

    expect(props.onShowCycleLabelsChange).toHaveBeenCalledWith(true);
  });

  it('reports it being turned off again', () => {
    const { props } = show({ showCycleLabels: true });

    fireEvent.click(toggle());

    expect(props.onShowCycleLabelsChange).toHaveBeenCalledWith(false);
  });

  /**
   * UI.md's rule, and the palette's precedent: an unavailable control with
   * something to teach is announced rather than removed. `aria-disabled` keeps
   * it focusable, so the refusal has to happen in the handler.
   */
  it('announces why it is unavailable rather than disappearing', () => {
    show({
      cycleLabelsUnavailable: 'No cycles to label yet: place an operation.',
    });

    expect(toggle()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(/no cycles to label/i);
  });

  it('refuses the change while unavailable', () => {
    const { props } = show({
      cycleLabelsUnavailable: 'No cycles to label yet: place an operation.',
    });

    fireEvent.click(toggle());

    expect(props.onShowCycleLabelsChange).not.toHaveBeenCalled();
  });

  /**
   * A control that reads as on while nothing is drawn would be a lie about the
   * canvas. Unavailable wins over the remembered preference.
   */
  it('shows as unchecked when unavailable, even if the preference is on', () => {
    show({
      showCycleLabels: true,
      cycleLabelsUnavailable: 'No cycles to label yet: place an operation.',
    });

    expect(toggle()).not.toBeChecked();
  });

  it('stays focusable while unavailable, so the region keeps a tab stop', () => {
    show({
      cycleLabelsUnavailable: 'No cycles to label yet: place an operation.',
    });

    expect(toggle()).not.toBeDisabled();
    toggle().focus();
    expect(toggle()).toHaveFocus();
  });
});
