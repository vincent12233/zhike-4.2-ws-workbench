'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const { createContrastInspector } = require('./helpers/visual-contrast.cjs');

function canvasColor(value) {
  if (value === 'transparent') return [0, 0, 0, 0];
  const match = value.match(/^rgba?\(([^)]+)\)$/);
  assert.ok(match, 'computed fixture color: ' + value);
  const [r, g, b, opacity = 1] = match[1].split(',').map(Number);
  const alpha = Math.round(opacity * 255);
  // Mirror the one-pixel canvas's premultiplied 8-bit store and unpremultiplied read.
  return [r, g, b].map(channel => alpha ? Math.round(Math.round(channel * alpha / 255) * 255 / alpha) : 0).concat(alpha);
}

const inspector = createContrastInspector(node => node.style, canvasColor);
const element = (style, parentElement) => ({ parentElement, style: {
  backgroundColor: 'transparent', backgroundImage: 'none', color: 'rgb(0, 0, 0)', ...style,
} });

test('reproduces the reported 1.807438 ratio and resolves the WS blue KPI reflection', () => {
  const foreground = 'rgb(21, 66, 143)';
  const oldReflection = 'rgba(65, 100, 205, 0.08)';
  assert.deepEqual(canvasColor(oldReflection), [64, 102, 204, 20]);
  assert.equal(inspector.contrast(foreground, inspector.normalizedColor(oldReflection)), 1.8074383585135592);

  const surface = element({
    backgroundImage: 'linear-gradient(122deg, rgba(255, 255, 255, 0.1), transparent 48%, ' + oldReflection + '), ' +
      'linear-gradient(135deg, rgb(211, 231, 255), rgb(231, 239, 255))',
  });
  const text = inspector.textSample(element({ color: foreground }, surface));
  assert.equal(text.backgrounds.length, 6, 'every stop of the reflection composes over both opaque base stops');
  assert.ok(text.backgrounds.includes('rgb(199, 221, 251)'));
  assert.equal(text.contrast, inspector.contrast(foreground, 'rgb(199, 221, 251)'));
  assert.ok(text.contrast >= 6.86);
});

test('transparent and white gradients paint over the parent and all lower artwork layers', () => {
  const parent = element({ backgroundColor: 'rgb(0, 0, 0)' });
  const card = element({
    backgroundImage: 'linear-gradient(180deg, rgba(255, 255, 255, 0.5), transparent), ' +
      'linear-gradient(90deg, rgba(255, 0, 0, 0.5), transparent)',
  }, parent);
  const text = inspector.textSample(element({ color: 'rgb(255, 255, 255)' }, card));
  assert.deepEqual(text.backgrounds.sort(), ['rgb(0, 0, 0)', 'rgb(128, 0, 0)', 'rgb(128, 128, 128)', 'rgb(192, 128, 128)'].sort());
  assert.equal(text.contrast, inspector.contrast('rgb(255, 255, 255)', 'rgb(192, 128, 128)'));
});

test('an opaque material 1 base blocks the impossible double night highlight', () => {
  const foreground = 'rgb(176, 189, 216)';
  const highlight = 'rgba(212, 222, 255, 0.14)';
  const canvasBackdrop = 'rgb(26, 31, 58)';
  const simplified = color => element({
    backgroundColor: color,
    backgroundImage: 'linear-gradient(180deg, ' + highlight + ', transparent 24px)',
  });
  // The previous main sampler treated the highlight as an alternative to the
  // opaque lower layer, leaving the canvas and then the outer highlight visible.
  const oldOuter = simplified(canvasBackdrop);
  const oldInner = simplified('transparent');
  oldInner.parentElement = oldOuter;
  const impossible = inspector.textSample(element({ color: foreground }, oldInner));
  assert.ok(impossible.backgrounds.includes('rgb(75, 81, 110)'));
  assert.equal(impossible.contrast.toFixed(3), '4.115');

  const materialImage = oldInner.style.backgroundImage +
    ', linear-gradient(135deg, rgb(23, 35, 59), rgb(28, 43, 70))';
  const outer = element({ backgroundColor: canvasBackdrop, backgroundImage: materialImage });
  const inner = element({ backgroundImage: materialImage }, outer);
  const sample = element({ color: foreground }, inner);
  const actual = inspector.textSample(sample);
  assert.deepEqual(inspector.backgroundColors(sample), actual.backgrounds);
  assert.ok(!actual.backgrounds.includes('rgb(75, 81, 110)'));
  assert.equal(actual.contrast, inspector.contrast(foreground, 'rgb(54, 68, 96)'));
  assert.ok(actual.contrast >= 5.15);
});

test('a genuinely low-contrast opaque stop still misses the 4.5 gate', () => {
  const card = element({
    color: 'rgb(119, 119, 119)',
    backgroundImage: 'linear-gradient(180deg, rgba(255, 255, 255, 0.1), transparent), ' +
      'linear-gradient(90deg, rgb(255, 255, 255), rgb(136, 136, 136))',
  });
  const text = inspector.textSample(card);
  assert.ok(text.backgrounds.includes('rgb(136, 136, 136)'));
  assert.ok(text.contrast < 4.5);
  assert.equal(text.contrast, inspector.contrast(card.style.color, 'rgb(136, 136, 136)'));
});

test('both actual palette KPI and material 1 CSS stops exceed the existing 4.5 guard', t => {
  const css = fs.readFileSync(path.join(root, 'resources/app/modules/design-system.css'), 'utf8');
  const tokens = block => Object.fromEntries([...block.matchAll(/(--ds-[\w-]+):([^;]+);/g)].map(([, name, value]) => [name, value]));
  const shared = tokens(css.match(/html\[data-palette\]\s*\{([^}]+)\}/)[1]);
  const main = fs.readFileSync(path.join(root, 'resources/app/modules/global-6.css'), 'utf8');
  assert.match(main, /\.business6-signal span\s*\{color:var\(--b6-kpi-ink\)!important\}/,
    'CRM business summaries use the same semantic foreground pairs');
  const channels = hex => (hex.length === 3 ? [...hex].map(value => value.repeat(2)) : hex.match(/../g))
    .map(value => Number.parseInt(value, 16));
  for (const palette of ['atelier-dawn', 'horizon-night']) {
    const theme = tokens(css.match(new RegExp('html\\[data-palette="' + palette + '"\\]\\s*\\{([^}]+)\\}'))[1]);
    const asRgb = value => value.replace(/#([\da-f]{6}|[\da-f]{3})\b/gi, (_, hex) => 'rgb(' + channels(hex).join(', ') + ')');
    const computed = value => asRgb(value
      .replace(/color-mix\(in srgb,var\((--ds-[\w-]+)\) (\d+)%,transparent\)/g,
        (_, token, percent) => 'rgba(' + channels(theme[token].slice(1)).join(', ') + ', ' + Number(percent) / 100 + ')')
      .replace(/var\((--ds-[\w-]+)\)/g, (_, token) => theme[token]));
    let kpiMinimum = Infinity;
    let surfaceMinimum = Infinity;
    for (const tone of ['blue', 'violet', 'teal', 'amber']) {
      const text = inspector.textSample(element({
        color: computed(theme['--ds-kpi-' + tone + '-ink']),
        backgroundImage: computed(shared['--ds-material-2'] + ',' + theme['--ds-kpi-' + tone + '-bg']),
      }));
      assert.ok(text.contrast >= 4.5, palette + '/' + tone + ' composed KPI contrast ' + text.contrast);
      kpiMinimum = Math.min(kpiMinimum, text.contrast);
    }
    for (const role of ['text', 'muted', 'primary', 'secondary']) {
      const text = inspector.textSample(element({
        color: computed(theme['--ds-' + role]),
        backgroundImage: computed(shared['--ds-material-1']),
      }));
      assert.ok(text.contrast >= 4.5, palette + '/' + role + ' composed material 1 contrast ' + text.contrast);
      surfaceMinimum = Math.min(surfaceMinimum, text.contrast);
    }
    t.diagnostic(palette + ' conservative minimum KPI ' + kpiMinimum.toFixed(3) + ', material 1 ' + surfaceMinimum.toFixed(3));
  }
});
