import config from '@fluxgantt/eslint-config';

const base = Array.isArray(config) ? config : [config];

export default [
  ...base,
  {
    // SECURITY (security.md §1, spec-svg-renderer.md §8): the render layer writes
    // untrusted host-app strings (task.name/notes/meta) into the DOM. Enforce
    // textContent/createTextNode + setAttribute only — never HTML-parsing sinks — so an
    // XSS regression fails `lint` in CI before any test runs.
    files: ['src/render/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          property: 'innerHTML',
          message:
            'innerHTML is banned in render/: it parses strings as HTML. Use textContent / createTextNode + setAttribute (security.md §1).',
        },
        {
          property: 'outerHTML',
          message: 'outerHTML is banned in render/ — same HTML-injection risk as innerHTML.',
        },
        {
          property: 'insertAdjacentHTML',
          message: 'insertAdjacentHTML is banned in render/ — parses strings as HTML. Build nodes explicitly.',
        },
        {
          object: 'document',
          property: 'write',
          message: 'document.write is banned in render/ — parses strings as HTML.',
        },
        {
          property: 'createContextualFragment',
          message:
            'Range.createContextualFragment is banned in render/ — parses strings as HTML. Build nodes explicitly.',
        },
      ],
      // DOMParser / raw HTML-string parsing sinks: block the global constructors too
      // (review N4) — createElementNS + createTextNode + setAttribute cover every need
      // in this layer.
      'no-restricted-globals': [
        'error',
        { name: 'DOMParser', message: 'DOMParser is banned in render/ — parses untrusted strings as markup.' },
      ],
    },
  },
];
