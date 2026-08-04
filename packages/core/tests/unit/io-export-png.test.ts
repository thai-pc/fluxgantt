// @vitest-environment jsdom
//
// Unit tests for `exportPng` (spec-export-png-svg.md §12.2). jsdom has no real canvas
// rasterization or `Image` decode — this file tests ORCHESTRATION ONLY, with the
// canvas/Image/URL pipeline stubbed. Real rasterization proof (actual pixels) needs a
// Playwright e2e test in a real browser (see io-export-svg.test.ts's header note + spec §12.4).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { exportPng, MAX_PNG_DIMENSION_PX } from '../../src/io/export-png.js';
import { exportSvg } from '../../src/io/export-svg.js';
import { createGantt } from '../../src/gantt.js';
import { toTaskId } from '../../src/types.js';
import type { TaskInput } from '../../src/store/index.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function taskInput(id: string, start: string, end: string, extra: Partial<TaskInput> = {}): TaskInput {
  return { id: toTaskId(id), name: id, start, end, progress: 0, type: 'task', ...extra };
}

/** jsdom's `Blob` implementation doesn't have `.text()`/`.arrayBuffer()` — read it back via
 *  `FileReader` instead (which jsdom does implement). */
function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error as unknown as Error);
    reader.readAsText(blob);
  });
}

function makeSvg(width = 200, height = 100): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Gantt chart');
  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('width', String(width));
  rect.setAttribute('height', String(height));
  rect.style.setProperty('fill', 'var(--fg-task-default, #6366f1)');
  svg.appendChild(rect);
  document.body.appendChild(svg);
  return svg;
}

// --- Canvas / Image / URL stubs ------------------------------------------------------------

interface FakeCtx {
  fillStyle: string;
  readonly calls: string[];
  fillRect: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
}

let fakeCtx: FakeCtx;
let capturedCanvas: HTMLCanvasElement | undefined;
let getContextCallCount: number;
let toBlobResult: Blob | null;

let createObjectUrlCalls: Blob[];
let createdUrls: string[];
let revokedUrls: string[];
let realCreateObjectUrl: typeof URL.createObjectURL | undefined;
let realRevokeObjectUrl: typeof URL.revokeObjectURL | undefined;

let imageConstructCount: number;
let imageShouldError: boolean;

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  #src = '';
  constructor() {
    imageConstructCount++;
  }
  get src(): string {
    return this.#src;
  }
  set src(value: string) {
    this.#src = value;
    queueMicrotask(() => {
      if (imageShouldError) this.onerror?.();
      else this.onload?.();
    });
  }
}

beforeEach(() => {
  // jsdom doesn't resolve `var(...)` — the internal `exportSvg()` call legitimately warns on
  // every real (unmocked) baked property here (see io-export-svg.test.ts's beforeEach);
  // silenced, not the concern of these orchestration tests.
  vi.spyOn(console, 'warn').mockImplementation(() => {});

  fakeCtx = {
    fillStyle: '',
    calls: [],
    fillRect: vi.fn(function (this: FakeCtx) {
      this.calls.push('fillRect');
    }),
    setTransform: vi.fn(function (this: FakeCtx) {
      this.calls.push('setTransform');
    }),
    drawImage: vi.fn(function (this: FakeCtx) {
      this.calls.push('drawImage');
    }),
  };
  capturedCanvas = undefined;
  getContextCallCount = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    getContextCallCount++;
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- capturing the canvas the mock was invoked on for later assertions.
    capturedCanvas = this;
    return fakeCtx as unknown as CanvasRenderingContext2D;
  });

  toBlobResult = new Blob(['fake-png-bytes'], { type: 'image/png' });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) {
    queueMicrotask(() => cb(toBlobResult));
  });

  createObjectUrlCalls = [];
  createdUrls = [];
  revokedUrls = [];
  realCreateObjectUrl = URL.createObjectURL;
  realRevokeObjectUrl = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    createObjectUrlCalls.push(blob);
    const url = `blob:fake-${createdUrls.length}`;
    createdUrls.push(url);
    return url;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn((url: string) => {
    revokedUrls.push(url);
  }) as typeof URL.revokeObjectURL;

  imageConstructCount = 0;
  imageShouldError = false;
  vi.stubGlobal('Image', FakeImage);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (realCreateObjectUrl) URL.createObjectURL = realCreateObjectUrl;
  if (realRevokeObjectUrl) URL.revokeObjectURL = realRevokeObjectUrl;
  document.body.innerHTML = '';
});

describe('exportPng — canvas sizing', () => {
  it('canvas.width/height = svg width/height x scale, rounded (default scale 1)', async () => {
    const svg = makeSvg(200, 100);
    await exportPng(svg);
    expect(capturedCanvas!.width).toBe(200);
    expect(capturedCanvas!.height).toBe(100);
  });

  it('canvas.width/height honors an explicit scale (2)', async () => {
    const svg = makeSvg(201, 101);
    await exportPng(svg, { scale: 2 });
    expect(capturedCanvas!.width).toBe(402);
    expect(capturedCanvas!.height).toBe(202);
  });
});

describe('exportPng — background', () => {
  it('default background is solid white, filled BEFORE drawImage', async () => {
    const svg = makeSvg();
    await exportPng(svg);
    expect(fakeCtx.fillStyle).toBe('#ffffff');
    expect(fakeCtx.calls.indexOf('fillRect')).toBeGreaterThanOrEqual(0);
    expect(fakeCtx.calls.indexOf('fillRect')).toBeLessThan(fakeCtx.calls.indexOf('drawImage'));
  });

  it('background: "transparent" never calls fillRect', async () => {
    const svg = makeSvg();
    await exportPng(svg, { background: 'transparent' });
    expect(fakeCtx.calls).not.toContain('fillRect');
  });

  it('a valid custom background sets fillStyle accordingly', async () => {
    const svg = makeSvg();
    await exportPng(svg, { background: '#ff0000' });
    expect(fakeCtx.fillStyle).toBe('#ff0000');
  });

  it.each(['white', 'black', 'red'])('accepts the bare CSS keyword color %j (review B5)', async (bg) => {
    const svg = makeSvg();
    await exportPng(svg, { background: bg });
    expect(fakeCtx.fillStyle).toBe(bg);
  });

  it('an invalid background rejects BEFORE any Image/canvas work starts', async () => {
    const svg = makeSvg();
    // Contains a non-letter/non-whitelisted char → fails both the keyword and the color check.
    await expect(exportPng(svg, { background: 'not-a-color' })).rejects.toThrow(/invalid background/);
    expect(imageConstructCount).toBe(0);
    expect(getContextCallCount).toBe(0);
  });
});

describe('exportPng — dimension guards (review A3/A4/B1)', () => {
  it('rejects a non-numeric SVG width/height before any Image/canvas work (A3)', async () => {
    const svg = makeSvg();
    svg.setAttribute('width', '800px'); // Number("800px") = NaN
    await expect(exportPng(svg)).rejects.toThrow(/no valid numeric width\/height/);
    expect(imageConstructCount).toBe(0);
  });

  it('rejects a degenerately small scale that rounds a side to 0 (A4)', async () => {
    const svg = makeSvg(200, 100);
    await expect(exportPng(svg, { scale: 1e-5 })).rejects.toThrow(/degenerate/);
    expect(imageConstructCount).toBe(0);
  });

  it('rejects when the total AREA exceeds the cap even with both sides under the per-side limit (B1)', async () => {
    // 5000 x 5000 = 25M px² > MAX_PNG_AREA_PX (16.7M), but each side < MAX_PNG_DIMENSION_PX (8192).
    const svg = makeSvg(5000, 5000);
    await expect(exportPng(svg)).rejects.toThrow(/total-area|per-side/);
    expect(imageConstructCount).toBe(0);
  });
});

describe('exportPng — scale validation', () => {
  it.each([0, -1, NaN])('rejects an invalid scale (%s) before any Image/canvas work starts', async (scale) => {
    const svg = makeSvg();
    await expect(exportPng(svg, { scale })).rejects.toThrow(/invalid scale/);
    expect(imageConstructCount).toBe(0);
    expect(getContextCallCount).toBe(0);
  });
});

describe('exportPng — MAX_PNG_DIMENSION_PX guard', () => {
  it('rejects with a message mentioning the limit when scale pushes past it, before any work starts', async () => {
    const svg = makeSvg(5000, 5000);
    await expect(exportPng(svg, { scale: 2 })).rejects.toThrow(
      new RegExp(String(MAX_PNG_DIMENSION_PX)),
    );
    expect(imageConstructCount).toBe(0);
    expect(getContextCallCount).toBe(0);
  });
});

describe('exportPng — SVG pipeline reuse', () => {
  it('the Blob handed to URL.createObjectURL contains the SAME string exportSvg() produces', async () => {
    const svg = makeSvg();
    const expected = exportSvg(svg);
    await exportPng(svg);
    expect(createObjectUrlCalls).toHaveLength(1);
    const actual = await readBlobText(createObjectUrlCalls[0]!);
    expect(actual).toBe(expected);
  });
});

describe('exportPng — object URL lifecycle', () => {
  it('createObjectURL/revokeObjectURL are balanced 1:1, revoke happens AFTER drawImage', async () => {
    const svg = makeSvg();
    await exportPng(svg);
    expect(createdUrls).toHaveLength(1);
    expect(revokedUrls).toEqual(createdUrls);
    expect(fakeCtx.calls).toContain('drawImage');
  });

  it('revokeObjectURL still fires if toBlob rejects (finally path)', async () => {
    const svg = makeSvg();
    toBlobResult = null; // triggers a rejection from the toBlob promise wrapper
    await expect(exportPng(svg)).rejects.toThrow(/toBlob returned null/);
    expect(revokedUrls).toEqual(createdUrls);
    expect(createdUrls).toHaveLength(1);
  });
});

describe('exportPng — happy path', () => {
  it('resolves with a Blob whose type is image/png', async () => {
    const svg = makeSvg();
    const blob = await exportPng(svg);
    expect(blob.type).toBe('image/png');
  });
});

describe('exportPng — facade (gantt.ts)', () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    container.remove();
  });

  it('rejects (not throws synchronously) with a "not mounted" message before mount()', async () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    await expect(gantt.exportPng()).rejects.toThrow(/not mounted/);
  });

  it('resolves once mounted, and rejects again after destroy()', async () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    gantt.mount(container);
    const blob = await gantt.exportPng();
    expect(blob.type).toBe('image/png');

    gantt.destroy();
    await expect(gantt.exportPng()).rejects.toThrow(/not mounted/);
  });

  it('rejects again after unmount() (parallels the exportSvg facade coverage — review C5)', async () => {
    const gantt = createGantt({ tasks: [taskInput('a', '2026-01-05T09:00', '2026-01-06T09:00')] });
    gantt.mount(container);
    await gantt.exportPng(); // works while mounted
    gantt.unmount();
    await expect(gantt.exportPng()).rejects.toThrow(/not mounted/);
  });

  // The unit tests above mock getComputedStyle/canvas/Image, so they prove ORCHESTRATION only,
  // not real rasterization or real CSS-custom-property resolution (spec §12.4). The actual
  // WYSIWYG + pixel proof requires a real browser and is deferred to a Playwright e2e.
  it.todo('e2e (playwright): a host --fg-* override is baked into the real rasterized PNG');
});
