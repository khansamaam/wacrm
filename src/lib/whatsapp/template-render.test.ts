import { describe, expect, it } from 'vitest';

import { renderTemplateBody } from './template-render';

describe('renderTemplateBody', () => {
  it('renders one-based WhatsApp placeholders', () => {
    expect(
      renderTemplateBody('Hello {{1}}, order {{2}} is ready.', [
        'Aisha',
        '#1234',
      ])
    ).toBe('Hello Aisha, order #1234 is ready.');
  });

  it('leaves missing parameters visible', () => {
    expect(renderTemplateBody('Hello {{1}} — {{2}}', ['Aisha'])).toBe(
      'Hello Aisha — {{2}}'
    );
  });
});
