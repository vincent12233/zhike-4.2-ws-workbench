'use strict';

// Keep this function self-contained: it is serialized into the browser fixtures
// and exercised with an injected style and color reader in the Node tests.
function createContrastInspector(readStyle, readColor) {
  if (!readColor) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    readColor = value => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
  }

  const parsedColors = new Map();
  function rgba(value) {
    if (!parsedColors.has(value)) parsedColors.set(value, readColor(value));
    return parsedColors.get(value);
  }

  const asRgb = color => 'rgb(' + color.slice(0, 3).join(', ') + ')';
  const normalizedColor = value => asRgb(rgba(value));
  function composite(foreground, background) {
    const alpha = foreground[3] / 255;
    return foreground.slice(0, 3).map((value, index) =>
      Math.round(value * alpha + background[index] * (1 - alpha))
    ).concat(255);
  }

  const luminance = color => color.slice(0, 3).map(value => value / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);

  function ratio(foreground, background) {
    const text = luminance(composite(foreground, background));
    const surface = luminance(background);
    return (Math.max(text, surface) + .05) / (Math.min(text, surface) + .05);
  }

  function backgroundSamples(element) {
    const chain = [];
    for (let node = element; node; node = node.parentElement) chain.unshift(node);
    let colors = [[255, 255, 255, 255]];
    function paint(stops) {
      const composed = stops.flatMap(stop => colors.map(under => composite(stop, under)));
      colors = [...new Map(composed.map(color => [color.join(','), color])).values()];
    }

    for (const node of chain) {
      const style = readStyle(node);
      const base = rgba(style.backgroundColor);
      if (base[3]) paint([base]);

      // The background color sits under every image. The first listed image
      // is painted on top. Pair each gradient's computed color stops with the
      // possible lower colors to obtain a conservative endpoint estimate.
      const gradients = style.backgroundImage.match(/(?:repeating-)?(?:linear|radial|conic)-gradient\((?:[^()]|\([^()]*\))*\)/g) || [];
      for (const gradient of gradients.reverse()) {
        const stops = gradient.match(/(?:rgba?|color|oklab|oklch|lab|lch|hsla?|hwb)\([^()]*\)|\btransparent\b/g);
        if (!stops?.length) throw new Error('No computed colors found in ' + gradient);
        paint(stops.map(rgba));
      }
    }
    return colors;
  }

  function textSample(element) {
    const foreground = readStyle(element).color;
    const backgrounds = backgroundSamples(element);
    return {
      foreground,
      backgrounds: backgrounds.map(asRgb),
      contrast: Math.min(...backgrounds.map(color => ratio(rgba(foreground), color))),
    };
  }

  return {
    normalizedColor,
    contrast: (foreground, background) => ratio(rgba(foreground), rgba(background)),
    backgroundColors: element => backgroundSamples(element).map(asRgb),
    textSample,
  };
}

module.exports = { createContrastInspector };
