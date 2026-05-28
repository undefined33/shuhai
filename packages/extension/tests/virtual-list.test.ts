import { describe, expect, it } from 'vitest';
import { getVirtualRange } from '../src/components/VirtualList.js';

describe('VirtualList range calculation', () => {
  it('renders only viewport rows plus overscan near the top', () => {
    expect(getVirtualRange(1469, 52, 520, 0, 5)).toEqual({
      endIndex: 15,
      offsetY: 0,
      startIndex: 0,
      totalHeight: 76388,
    });
  });

  it('moves the visible window as the user scrolls', () => {
    expect(getVirtualRange(1469, 52, 520, 5200, 5)).toMatchObject({
      endIndex: 115,
      offsetY: 4940,
      startIndex: 95,
    });
  });

  it('clamps the range at the end of the list', () => {
    expect(getVirtualRange(12, 48, 240, 9999, 5)).toMatchObject({
      endIndex: 12,
    });
  });
});
