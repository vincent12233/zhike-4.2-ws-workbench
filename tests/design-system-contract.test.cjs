'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(repo, file), 'utf8');
const designPath = path.join(repo, 'resources', 'app', 'modules', 'design-system.css');
assert.equal(fs.existsSync(designPath), true, 'unified design-system.css must exist');
const css = fs.readFileSync(designPath, 'utf8');
const html = read('resources/app/index.html');
const server = read('resources/app/server.mjs');
const shell = read('resources/app/modules/horizon-atelier.css');
const business = read('resources/app/modules/global-6.css');
const businessRoutes = read('resources/app/modules/business-6.css');
const home = read('resources/app/modules/home-6.css');
const ws = read('resources/app/modules/ws-workbench.css');
const gpt = read('resources/app/modules/gpt-modern.css');

function paletteTokens(source) {
  const dawn = source.match(/html\[data-palette="atelier-dawn"\]\s*\{([^}]+)\}/)?.[1];
  const night = source.match(/html\[data-palette="horizon-night"\]\s*\{([^}]+)\}/)?.[1];
  assert.ok(dawn && night, 'both selectable palettes need explicit isolated token owners');
  for (const token of ['--ds-primary:#2854be','--ds-secondary:#6845af','--ds-accent:#006972','--ds-bg:#f5f7fa','--ds-surface:#fff','--ds-surface-soft:#f1f5fb','--ds-surface-tint:#f5f2fb','--ds-text:#1e2f50','--ds-muted:#4c6080','--ds-border:#cdd8e8','--ds-on-primary:#fff']) assert.ok(dawn.includes(token), `missing daylight token ${token}`);
  for (const token of ['--ds-primary:#9cb7ff','--ds-secondary:#c0aaff','--ds-accent:#70d6cb','--ds-bg:#10182b','--ds-surface:#17233b','--ds-surface-soft:#1c2b46','--ds-surface-tint:#252b47','--ds-text:#eef2ff','--ds-muted:#b0bdd8','--ds-on-primary:#172a4d']) assert.ok(night.includes(token), `missing retained night token ${token}`);
  return { dawn, night };
}
const palettes = paletteTokens(css);
assert.throws(() => paletteTokens(css.replace('--ds-bg:#f5f7fa', '--ds-bg:#10182b')), /missing daylight token/, 'a dark token cannot silently leak into the dawn palette');

// Check actual text/surface pairs, including the soft layers and semantic tags.
// The visual redesign may change color values but cannot relax normal-text AA.
const tokensOf = source => Object.fromEntries([...source.matchAll(/(--ds-[\w-]+):([^;]+);?/g)].map(match => [match[1], match[2].trim()]));
const shared = tokensOf(css.match(/html\[data-palette\]\s*\{([^}]+)\}/)?.[1] || '');
const luminance = color => {
  const hex = color.replace(/^#/, '');
  assert.match(hex, /^(?:[\da-f]{3}|[\da-f]{6})$/i, `contrast color must be an explicit RGB token: ${color}`);
  const rgb = (hex.length === 3 ? [...hex].map(value => value + value).join('') : hex).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
};
const blend = (foreground, background, alpha) => {
  const channels = color => (color.length === 4
    ? [...color.slice(1)].map(value => value.repeat(2))
    : color.slice(1).match(/../g)).map(value => parseInt(value, 16));
  const base = channels(background);
  return '#' + channels(foreground).map((value, index) =>
    Math.round(value * alpha + base[index] * (1 - alpha)).toString(16).padStart(2, '0')
  ).join('');
};
const overlayAlpha = (level, token) => {
  const pattern = new RegExp('var\\(--ds-' + token + '\\) (\\d+)%,transparent');
  const match = shared['--ds-material-' + level].match(pattern);
  assert.ok(match, 'material ' + level + ' needs a measurable ' + token + ' overlay');
  return Number(match[1]) / 100;
};
assert.equal(shared['--ds-material-0'], 'var(--ds-surface)', 'table material stays opaque');
assert.match(shared['--ds-material-1'], /transparent 24px/, 'toolbar highlight fades within 24px');
const contrast = (foreground, background) => {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
};
for (const [name, source] of Object.entries(palettes)) {
  const tokens = tokensOf(source);
  const pairs = [
    ...['bg', 'surface', 'surface-soft', 'surface-tint'].flatMap(surface => ['text', 'muted'].map(text => [text, surface])),
    ...['primary', 'secondary', 'accent'].flatMap(text => ['surface', 'surface-soft'].map(surface => [text, surface])),
    ['nav-text', 'nav-bg'], ['active-text', 'nav-active'], ['on-primary', 'primary'],
    ...['rail-text', 'rail-muted', 'rail-accent'].flatMap(text => ['rail-bg', 'rail-surface', 'rail-hover'].map(surface => [text, surface])),
    ['topbar-control-text', 'topbar-control'],
    ...['success', 'warning', 'danger', 'ai'].map(text => [text, `${text}-bg`]),
  ];
  for (const [foreground, background] of pairs) assert.ok(contrast(tokens[`--ds-${foreground}`], tokens[`--ds-${background}`]) >= 4.5, `${name} ${foreground}/${background} must retain 4.5:1 normal-text contrast`);
  const checkMaterial = (foreground, level, backgrounds) => {
    for (const background of backgrounds) {
      assert.ok(contrast(tokens['--ds-' + foreground], background) >= 4.5,
        name + ' ' + foreground + ' retains AA on material ' + level + ' at ' + background);
    }
  };
  const lightEdge = tokens['--ds-light-edge'];
  const reflection = tokens['--ds-light-reflection'];
  const levelOne = ['surface', 'surface-soft'].flatMap(role => {
    const base = tokens['--ds-' + role];
    return [base, blend(lightEdge, base, overlayAlpha(1, 'light-edge'))];
  });
  for (const foreground of ['text', 'muted', 'primary', 'secondary']) checkMaterial(foreground, 1, levelOne);
  const checkLevelTwo = (foreground, base) => checkMaterial(foreground, 2, [
    base, blend(lightEdge, base, overlayAlpha(2, 'light-edge')),
    blend(reflection, base, overlayAlpha(2, 'light-reflection')),
  ]);
  for (const [background, foreground] of [
    ['nav-active', 'active-text'], ['danger-bg', 'danger'], ['success-bg', 'success'],
    ['warning-bg', 'warning'], ['ai-bg', 'ai'],
  ]) checkLevelTwo(foreground, tokens['--ds-' + background]);
  const accountBase = blend(tokens['--ds-primary'], tokens['--ds-surface'], .07);
  for (const foreground of ['text', 'muted', 'success', 'danger']) checkLevelTwo(foreground, accountBase);
  for (const foreground of ['text', 'muted', 'primary']) {
    for (const role of ['surface', 'surface-tint']) {
      const artBlend = ['#000', '#fff'].map(art => blend(tokens['--ds-' + role], art, overlayAlpha(3, role)));
      checkMaterial(foreground, 3, artBlend);
      const bannerBase = blend(tokens['--ds-' + role], tokens['--ds-surface'], overlayAlpha(3, role));
      checkMaterial(foreground, 3, [bannerBase, blend(tokens['--ds-primary'], bannerBase, .12)]);
    }
  }
  for (const endpoint of tokens['--ds-rail-paint'].match(/#[\da-f]{3,6}\b/gi)) {
    for (const foreground of ['rail-text','rail-muted','rail-accent']) assert.ok(contrast(tokens[`--ds-${foreground}`], endpoint) >= 4.5, `${name} ${foreground} retains AA on every new sidebar gradient stop`);
  }
  for (const [fill, foregrounds] of [
    ['topbar-bg', ['topbar-text', 'topbar-muted']],
    ['home-banner', ['hero-text', 'home-banner-muted', 'home-banner-accent']],
    ...['blue', 'violet', 'teal', 'amber', 'red', 'indigo'].map(tone => [`kpi-${tone}-bg`, [`kpi-${tone}-ink`]]),
  ]) {
    const endpoints = tokens[`--ds-${fill}`].match(/#[\da-f]{3,6}\b/gi) || [];
    assert.equal(endpoints.length, fill === 'home-banner' ? 4 : 2, `${name} ${fill} exposes its opaque stops for verification`);
    for (const foreground of foregrounds) for (const endpoint of endpoints) {
      assert.ok(contrast(tokens[`--ds-${foreground}`], endpoint) >= 4.5, `${name} ${foreground}/${fill} retains 4.5:1 at every gradient stop`);
      if (fill.startsWith('kpi-') || fill === 'home-banner') checkLevelTwo(foreground, endpoint);
    }
  }
}
assert.match(shared['--ds-primary-fill'], /^linear-gradient\(/, 'filled primary controls use the shared blue/purple fill authority');
for (const fill of ['--ds-primary-fill', '--ds-primary-fill-hover', '--ds-ai-fill', '--ds-ai-fill-hover']) {
  const endpoints = shared[fill].match(/#[\da-f]{3,6}\b/gi) || [];
  assert.equal(endpoints.length, 2, `${fill} exposes both actual endpoints for contrast verification`);
  for (const endpoint of endpoints) assert.ok(contrast(shared['--ds-on-primary-fill'], endpoint) >= 4.5, 'normal-size primary labels retain 4.5:1 at both normal/hover gradient endpoints');
}
for (const [legacy, shared] of Object.entries({bg:'bg',surface:'surface',border:'border',ink:'text',muted:'muted',accent:'primary','accent-strong':'primary',blue:'primary',success:'success',warning:'warning',danger:'danger',ai:'ai'})) assert.ok(css.includes(`--zk-${legacy}:var(--ds-${shared})`), `legacy ${legacy} must consume the single shared token authority`);

assert.match(css, /--ds-body-size:14px/, 'body text uses the approved 14px compact typography');
assert.match(css, /body\s*\{[^}]*font-size:var\(--ds-body-size\)/, 'body consumes the shared readable size');
assert.equal(shared['--ds-font-table'], 'var(--ds-body-size)', 'table body size inherits the 14px base');
assert.match(business, /:is\(\.data-table,[^)]*\) td\s*\{[^}]*font-size:var\(--ds-font-table\)!important/, 'the business owner gives table bodies readable 14px type');
assert.equal(shared['--ds-font-reading'], 'var(--ds-body-size)');
assert.equal(shared['--ds-font-table-heading'], '13px');
assert.match(business, /:is\(\.data-table,[^)]*\) th\s*\{[^}]*font-size:var\(--ds-font-table-heading\)!important/, 'table headers use the explicit 13px secondary size');
assert.match(css, /--ds-control-height:44px/, 'the shared control target remains 44px');
assert.equal(shared['--ds-font-control'], 'var(--ds-body-size)');
assert.equal(shared['--ds-font-card'], '14px');
for (const tone of ['blue', 'teal', 'violet', 'amber', 'rose', 'indigo']) {
  const stops = shared[`--ds-icon-${tone}`]?.match(/#[\da-f]{6}\b/gi) || [];
  assert.equal(stops.length, 2, `a distinct ${tone} icon plate is available`);
  for (const stop of stops) assert.ok(contrast('#fff', stop) >= 4.5, `white ${tone} icon ink remains legible`);
}
assert.equal(shared['--ds-font-detail'], '13px');
assert.equal(shared['--ds-font-page'], '20px');
assert.equal(shared['--ds-font-section'], '16px');
assert.match(business, /\.business6-command-copy>strong\s*\{font-size:var\(--ds-font-section\)!important/);
assert.match(business, /\.governance-hero-copy h2\s*\{font-size:var\(--ds-font-section\)!important/);
assert.match(business, /:is\(\.settings-section h3,\.governance-copy strong,\.automation-rule-row strong\)\s*\{font-size:var\(--ds-font-section\)!important/);
assert.match(businessRoutes, /html\[data-view="segments"\] #viewContainer \.segment-tab\s*\{min-height:var\(--ds-control-height,44px\)/, 'the standalone M06 tabs receive the shared hit target');
for (const heading of ['.ws-assist-drawer-title strong', '.stage4-ai-section h3', '.ws-flow-heading strong']) {
  assert.ok(ws.includes(heading + '{font-size:var(--ds-font-section,'), heading + ' consumes the fixed shared section size when a palette is active');
}
assert.equal(shared['--ds-font-kpi'], '26px');
assert.match(css, /\[data-density="compact"\] \{--ds-section-gap:12px;--ds-section-inset:14px\}/);
assert.match(business, /\.table-toolbar \{[^}]*background:var\(--ds-material-1\)!important/);
assert.match(business, /\.customer-drawer \.customer-360-hero \{[^}]*border:[^;]*var\(--zk-panel-edge,var\(--ds-surface-border\)\)[^}]*background:var\(--zk-panel-fill,var\(--ds-material-1\)\)/);
assert.match(business, /\.customer-drawer :is\(p,span,small,label,dt,dd\):where\(:not\(\.zk-avatar,\.zk-avatar__fallback,\.customer-card-icon\)\)/);
assert.match(business, /\.favorite-button \{--favorite-ink:var\(--ds-muted\)/, 'inactive favorite inherits the AA muted ink');
assert.match(business, /\.favorite-button:is\(:hover,\.active\) \{--favorite-ink:var\(--ds-warning\);--favorite-fill:var\(--ds-warning-bg\)/, 'active favorite uses the AA warning pair');
assert.doesNotMatch(business, /\.customer6-workspace\b/, 'customer grid geometry has one stylesheet owner');
assert.match(businessRoutes, /\.customer6-primary \.quick-filters \.filter-grid\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(min\(125px,100%\),1fr\)\)/, 'advanced filters shrink to the customer pane width');
assert.match(businessRoutes, /\.customer6-workspace\.is-preview-collapsed\{grid-template-columns:minmax\(0,1fr\)\}/);
assert.match(home, /\.digital-horizon \{[^}]*background:var\(--ds-material-2\),var\(--ds-home-banner\)/);
assert.match(home, /\.digital-horizon-art \{[^}]*mask-image:linear-gradient\([^)]*\);pointer-events:none/);
assert.match(home, /\.horizon-kpi \{[^}]*background:var\(--ds-material-2\),var\(--kpi-bg\)/);
assert.match(ws, /\.ws-account-row,\.ws-session-row\)\.active\{[^}]*background:var\(--ds-material-2,none\),var\(--ws-panel-hover\)/);
assert.match(gpt, /\.gpt-page \.gpt-chat-head\{[^}]*background:var\(--ds-material-1,var\(--gpt-surface\)\)/);
assert.doesNotMatch(css + home + business, /backdrop-filter\s*:|filter\s*:\s*blur\(|animation\s*:[^;}]*\binfinite\b/, 'shared glass uses local paint without full-screen blur or perpetual animation');
assert.match(shell, /@container main-workspace \(max-width:1000px\)/, 'medium layout responds to actual available workspace width');
assert.match(shell, /@media\s*\(max-width:\s*820px\)/, 'small effective-width layout is explicit');
assert.match(business, /@media\s*\(max-width:\s*560px\)/, 'compact business layout is explicit');
assert.match(shell, /--zhike-sidebar-expanded:248px;--zhike-sidebar-collapsed:72px/, 'expanded and collapsed rail widths share one geometry authority');
assert.match(shell, /#sidebar\s*\{[^}]*width:var\(--zhike-sidebar-expanded\)!important;flex-basis:var\(--zhike-sidebar-expanded\)!important/, 'manual expansion resolves from the shared stable width');
assert.equal(shared['--ds-font-nav'], '14px');
assert.match(shell, /#mainNav \.nav-item\s*\{[^}]*gap:12px[^}]*font-size:var\(--ds-font-nav\)/, 'expanded navigation retains space for readable labels');
assert.match(shell, /#sidebar\.collapsed \.nav-item\s*\{justify-content:center/, 'icon centering is limited to the collapsed rail');
const switcher = shell.match(/html\[data-palette\] \.workspace-switcher\s*\{([^}]+)\}/)?.[1] || '';
const switcherHeight = Number(switcher.match(/(?:^|;)height:(\d+)px/)?.[1]);
const switcherPadding = Number(switcher.match(/(?:^|;)padding:(\d+)px/)?.[1]);
const switcherBorder = Number(switcher.match(/(?:^|;)border:(\d+)px/)?.[1]);
assert.equal(switcherHeight, 44 + switcherPadding * 2 + switcherBorder * 2, 'the 44px tabs fit the border-box exactly without enlarging the shared switcher past 54px');
assert.equal(switcherHeight, 54, 'the 56px WS command row must not center a 56px switcher half a pixel outside its border');
assert.match(css, /prefers-reduced-motion/, 'motion preferences must be respected');
assert.match(css, /animation:\s*none\s*!important/, 'continuous visual animation must be disabled by default');
assert.match(html, /modules\/design-system\.css/, 'index must load the unified compatibility primitives');
assert.ok(html.indexOf('modules/design-system.css') < html.indexOf('modules/horizon-atelier.css'), 'compatibility primitives must load before the 6.0 product skin');
assert.ok(html.indexOf('modules/horizon-atelier.css') < html.indexOf('modules/scroll-system.css'), 'the interaction contract must remain the final stylesheet');
assert.match(server, /['"]\/modules\/design-system\.css['"]/, 'server must allow the unified design system asset');

console.log('design-system contract: tokens, typography, breakpoints, motion and asset wiring are present');
