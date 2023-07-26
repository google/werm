'use strict';

// SOURCE FILE: libdot/js/lib.js
// Copyright (c) 2012 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

const lib = {};

/**
 * List of functions that need to be invoked during library initialization.
 *
 * Each element in the initCallbacks_ array is itself a two-element array.
 * Element 0 is a short string describing the owner of the init routine, useful
 * for debugging.  Element 1 is the callback function.
 */
lib.initCallbacks_ = [];

/**
 * Register an initialization function.
 *
 * The initialization functions are invoked in registration order when
 * lib.init() is invoked.  Each function will receive a single parameter, which
 * is a function to be invoked when it completes its part of the initialization.
 *
 * @param {string} name A short descriptive name of the init routine useful for
 *     debugging.
 * @param {function()} callback The initialization function to register.
 */
lib.registerInit = function(name, callback) {
  lib.initCallbacks_.push([name, callback]);
};

/**
 * Initialize the library.
 *
 * This will ensure that all registered runtime dependencies are met, and
 * invoke any registered initialization functions.
 *
 * Initialization is asynchronous.  The library is not ready for use until
 * the returned promise resolves.
 *
 * @param {function(*)=} logFunction An optional function to send initialization
 *     related log messages to.
 * @return {!Promise<void>} Promise that resolves once all inits finish.
 */
lib.init = async function(logFunction = undefined) {
  const ary = lib.initCallbacks_;
  while (ary.length) {
    const [name, init] = ary.shift();
    if (logFunction) {
      logFunction(`init: ${name}`);
    }
    const ret = init();
    if (ret && typeof ret.then === 'function') {
      await ret;
    }
  }
};

/**
 * Verify |condition| is truthy else throw Error.
 *
 * This function is primarily for satisfying the JS compiler and should be
 * used only when you are certain that your condition is true.  The function is
 * designed to have a version that throws Errors in tests if condition fails,
 * and a nop version for production code.  It configures itself the first time
 * it runs.
 *
 * @param {boolean} condition A condition to check.
 * @closurePrimitive {asserts.truthy}
 */
lib.assert = function(condition) {
  if (window.chai) {
    lib.assert = window.chai.assert;
  } else {
    lib.assert = function(condition) {};
  }
  lib.assert(condition);
};

/**
 * Verify |value| is not null and return |value| if so, else throw Error.
 * See lib.assert.
 *
 * @template T
 * @param {T} value A value to check for null.
 * @return {T} A non-null |value|.
 * @closurePrimitive {asserts.truthy}
 */
lib.notNull = function(value) {
  lib.assert(value !== null);
  return value;
};
// SOURCE FILE: libdot/js/lib_polyfill.js
// Copyright 2017 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @fileoverview Polyfills for ES2019+ features we want to use.
 * @suppress {duplicate} This file redefines many functions.
 */

/** @const */
lib.polyfill = {};

/**
 * https://developer.mozilla.org/en-US/docs/Web/API/Blob/arrayBuffer
 *
 * @return {!Promise<!ArrayBuffer>}
 */
lib.polyfill.BlobArrayBuffer = function() {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onabort = reader.onerror = () => reject(reader);
    reader.readAsArrayBuffer(this);
  });
};

if (typeof Blob.prototype.arrayBuffer != 'function') {
  Blob.prototype.arrayBuffer = lib.polyfill.BlobArrayBuffer;
}

/**
 * https://developer.mozilla.org/en-US/docs/Web/API/Blob/text
 *
 * @return {!Promise<string>}
 */
lib.polyfill.BlobText = function() {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onabort = reader.onerror = () => reject(reader);
    reader.readAsText(this);
  });
};

if (typeof Blob.prototype.arrayBuffer != 'function') {
  Blob.prototype.text = lib.polyfill.BlobText;
}
// SOURCE FILE: libdot/js/lib_array.js
// Copyright 2017 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @fileoverview Helper functions for (typed) arrays.
 */

lib.array = {};

/**
 * Compare two array-like objects entrywise.
 *
 * @template ARRAY_LIKE
 * @param {?ARRAY_LIKE} a The first array to compare.
 * @param {?ARRAY_LIKE} b The second array to compare.
 * @return {boolean} true if both arrays are null or they agree entrywise;
 *     false otherwise.
 */
lib.array.compare = function(a, b) {
  if (a === null || b === null) {
    return a === null && b === null;
  }

  if (a.length !== b.length) {
    return false;
  }

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
};
// SOURCE FILE: libdot/js/lib_codec.js
// Copyright 2018 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

lib.codec = {};

/**
 * Join an array of code units to a string.
 *
 * The code units must not be larger than 65535.  The individual code units may
 * be for UTF-8 or UTF-16 -- it doesn't matter since UTF-16 can handle all UTF-8
 * code units.
 *
 * The input array type may be an Array or a typed Array (e.g. Uint8Array).
 *
 * @param {!Uint8Array|!Array<number>} array The code units to generate for
 *     the string.
 * @return {string} A UTF-16 encoded string.
 */
lib.codec.codeUnitArrayToString = function(array) {
  // String concat is faster than Array.join.
  //
  // String.fromCharCode.apply is faster than this if called less frequently
  // and with smaller array sizes (like <32K).  But it's a recursive call so
  // larger arrays will blow the stack and fail.  We also seem to be faster
  // (or at least more constant time) when called frequently.
  let ret = '';
  for (let i = 0; i < array.length; ++i) {
    ret += String.fromCharCode(array[i]);
  }
  return ret;
};

/**
 * Create an array of code units from a UTF-16 encoded string.
 *
 * @param {string} str The string to extract code units from.
 * @param {!ArrayBufferView=} ret The buffer to hold the result.  If not set, a
 *     new Uint8Array is created.
 * @return {!ArrayBufferView} The array of code units.
 */
lib.codec.stringToCodeUnitArray = function(
    str, ret = new Uint8Array(str.length)) {
  // Indexing string directly is faster than Array.map.
  for (let i = 0; i < str.length; ++i) {
    ret[i] = str.charCodeAt(i);
  }
  return ret;
};
// SOURCE FILE: libdot/js/lib_colors.js
// Copyright (c) 2012 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Namespace for color utilities.
 */
lib.colors = {};

/**
 * First, some canned regular expressions we're going to use in this file.
 *
 *
 *                              BRACE YOURSELF
 *
 *                                 ,~~~~.
 *                                 |>_< ~~
 *                                3`---'-/.
 *                                3:::::\v\
 *                               =o=:::::\,\
 *                                | :::::\,,\
 *
 *                        THE REGULAR EXPRESSIONS
 *                               ARE COMING.
 *
 * There's no way to break long RE literals in JavaScript.  Fix that why don't
 * you?  Oh, and also there's no way to write a string that doesn't interpret
 * escapes.
 *
 * Instead, we stoop to this .replace() trick.
 */
lib.colors.re_ = {
  // CSS hex color, #RGB or RGBA.
  hex16: /^#([a-f0-9])([a-f0-9])([a-f0-9])([a-f0-9])?$/i,

  // CSS hex color, #RRGGBB or #RRGGBBAA.
  hex24: /^#([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})?$/i,

  // CSS rgb color, rgb(rrr,ggg,bbb).
  rgb: new RegExp(
      ('^/s*rgb/s*/(/s*(/d{1,3})/s*,/s*(/d{1,3})/s*,' +
       '/s*(/d{1,3})/s*/)/s*$'
       ).replace(/\//g, '\\'), 'i'),

  // CSS rgb color, rgba(rrr,ggg,bbb,aaa).
  rgba: new RegExp(
      ('^/s*rgba/s*' +
       '/(/s*(/d{1,3})/s*,/s*(/d{1,3})/s*,/s*(/d{1,3})/s*' +
       '(?:,/s*(/d+(?:/./d+)?)/s*)/)/s*$'
       ).replace(/\//g, '\\'), 'i'),

  // Either RGB or RGBA.
  rgbx: new RegExp(
      ('^/s*rgba?/s*' +
       '/(/s*(/d{1,3})/s*,/s*(/d{1,3})/s*,/s*(/d{1,3})/s*' +
       '(?:,/s*(/d+(?:/./d+)?)/s*)?/)/s*$'
       ).replace(/\//g, '\\'), 'i'),

  // CSS hsl color, hsl(hhh,sss%,lll%).
  hsl: new RegExp(
      ('^/s*hsl/s*' +
       '/(/s*(/d{1,3})/s*,/s*(/d{1,3})/s*%/s*,/s*(/d{1,3})/s*%/s*/)/s*$'
       ).replace(/\//g, '\\'), 'i'),

  // CSS hsl color, hsla(hhh,sss%,lll%,aaa).
  hsla: new RegExp(
      ('^/s*hsla/s*' +
       '/(/s*(/d{1,3})/s*,/s*(/d{1,3})/s*%/s*,/s*(/d{1,3})/s*%/s*' +
       '(?:,/s*(/d+(?:/./d+)?)/s*)/)/s*$'
       ).replace(/\//g, '\\'), 'i'),

  // Either HSL or HSLA.
  hslx: new RegExp(
      ('^/s*hsla?/s*' +
       '/(/s*(/d{1,3})/s*,/s*(/d{1,3})/s*%/s*,/s*(/d{1,3})/s*%/s*' +
       '(?:,/s*(/d+(?:/./d+)?)/s*)?/)/s*$'
       ).replace(/\//g, '\\'), 'i'),

  // An X11 "rgb:dddd/dddd/dddd" value.
  x11rgb: /^\s*rgb:([a-f0-9]{1,4})\/([a-f0-9]{1,4})\/([a-f0-9]{1,4})\s*$/i,

  // English color name.
  name: /[a-z][a-z0-9\s]+/,
};

/**
 * Convert a CSS rgb(ddd,ddd,ddd) color value into an X11 color value.
 *
 * Other CSS color values are ignored to ensure sanitary data handling.
 *
 * Each 'ddd' component is a one byte value specified in decimal.
 *
 * @param {string} value The CSS color value to convert.
 * @return {?string} The X11 color value or null if the value could not be
 *     converted.
 */
lib.colors.rgbToX11 = function(value) {
  function scale(v) {
    v = (Math.min(v, 255) * 257).toString(16);
    return lib.f.zpad(v, 4);
  }

  const ary = value.match(lib.colors.re_.rgbx);
  if (!ary) {
    return null;
  }

  return 'rgb:' + scale(ary[1]) + '/' + scale(ary[2]) + '/' + scale(ary[3]);
};

/**
 * Convert a legacy X11 color value into an CSS rgb(...) color value.
 *
 * They take the form:
 * 12 bit: #RGB          -> #R000G000B000
 * 24 bit: #RRGGBB       -> #RR00GG00BB00
 * 36 bit: #RRRGGGBBB    -> #RRR0GGG0BBB0
 * 48 bit: #RRRRGGGGBBBB
 * These are the most significant bits.
 *
 * Truncate values back down to 24 bit since that's all CSS supports.
 *
 * @param {string} v The X11 hex color value to convert.
 * @return {?string} The CSS color value or null if the value could not be
 *     converted.
 */
lib.colors.x11HexToCSS = function(v) {
  if (!v.startsWith('#')) {
    return null;
  }
  // Strip the leading # off.
  v = v.substr(1);

  // Reject unknown sizes.
  if ([3, 6, 9, 12].indexOf(v.length) == -1) {
    return null;
  }

  // Reject non-hex values.
  if (v.match(/[^a-f0-9]/i)) {
    return null;
  }

  // Split the colors out.
  const size = v.length / 3;
  const r = v.substr(0, size);
  const g = v.substr(size, size);
  const b = v.substr(size + size, size);

  // Normalize to 16 bits.
  function norm16(v) {
    v = parseInt(v, 16);
    return size == 2 ? v :         // 16 bit
           size == 1 ? v << 4 :    // 8 bit
           v >> (4 * (size - 2));  // 24 or 32 bit
  }
  return lib.colors.arrayToRGBA([r, g, b].map(norm16));
};

/**
 * Convert an X11 color value into an CSS rgb(...) color value.
 *
 * The X11 value may be an X11 color name, or an RGB value of the form
 * rgb:hhhh/hhhh/hhhh.  If a component value is less than 4 digits it is
 * padded out to 4, then scaled down to fit in a single byte.
 *
 * @param {string} v The X11 color value to convert.
 * @return {?string} The CSS color value or null if the value could not be
 *     converted.
 */
lib.colors.x11ToCSS = function(v) {
  function scale(v) {
    // Pad out values with less than four digits.  This padding (probably)
    // matches xterm.  It's difficult to say for sure since xterm seems to
    // arrive at a padded value and then perform some combination of
    // gamma correction, color space transformation, and quantization.

    if (v.length == 1) {
      // Single digits pad out to four by repeating the character.  "f" becomes
      // "ffff".  Scaling down a hex value of this pattern by 257 is the same
      // as cutting off one byte.  We skip the middle step and just double
      // the character.
      return parseInt(v + v, 16);
    }

    if (v.length == 2) {
      // Similar deal here.  X11 pads two digit values by repeating the
      // byte (or scale up by 257).  Since we're going to scale it back
      // down anyway, we can just return the original value.
      return parseInt(v, 16);
    }

    if (v.length == 3) {
      // Three digit values seem to be padded by repeating the final digit.
      // e.g. 10f becomes 10ff.
      v = v + v.substr(2);
    }

    // Scale down the 2 byte value.
    return Math.round(parseInt(v, 16) / 257);
  }

  const ary = v.match(lib.colors.re_.x11rgb);
  if (!ary) {
    // Handle the legacy format.
    if (v.startsWith('#')) {
      return lib.colors.x11HexToCSS(v);
    } else {
      return lib.colors.nameToRGB(v);
    }
  }

  ary.splice(0, 1);
  return lib.colors.arrayToRGBA(ary.map(scale));
};

/**
 * Converts one or more CSS '#RRGGBB' or '#RRGGBBAA' color values into their
 * rgb(...) or rgba(...) form respectively.
 *
 * Arrays are converted in place. If a value cannot be converted, it is
 * replaced with null.
 *
 * @param {string} hex A single RGB or RGBA value to convert.
 * @return {?string} The converted value.
 */
lib.colors.hexToRGB = function(hex) {
  const hex16 = lib.colors.re_.hex16;
  const hex24 = lib.colors.re_.hex24;

  if (hex16.test(hex)) {
    // Convert from RGB to RRGGBB and from RGBA to RRGGBBAA.
    hex = `#${hex.match(/[a-f0-9]/gi).map((x) => `${x}${x}`).join('')}`;
  }

  const ary = hex.match(hex24);
  if (!ary) {
    return null;
  }

  const val = (index) => parseInt(ary[index + 1], 16);
  return ary[4] === undefined || val(3) === 255
      ? `rgb(${val(0)}, ${val(1)}, ${val(2)})`
      : `rgba(${val(0)}, ${val(1)}, ${val(2)}, ${val(3) / 255})`;
};

/**
 * Converts one or more CSS rgb(...) or rgba(...) forms into their '#RRGGBB' or
 * '#RRGGBBAA' color values respectively.
 *
 * Arrays are converted in place. If a value cannot be converted, it is
 * replaced with null.
 *
 * @param {string} rgb A single rgb(...) or rgba(...) value to convert.
 * @return {?string} The converted value.
 */
lib.colors.rgbToHex = function(rgb) {
  const ary = lib.colors.crackRGB(rgb);
  if (!ary) {
    return null;
  }

  const hex = '#' + lib.f.zpad((
      (parseInt(ary[0], 10) << 16) |
      (parseInt(ary[1], 10) << 8) |
      (parseInt(ary[2], 10) << 0)).toString(16), 6);
  if (ary[3] === undefined || ary[3] === '1') {
    return hex;
  } else {
    const alpha = Math.round(255 * parseFloat(ary[3])).toString(16);
    return `${hex}${lib.f.zpad(alpha, 2)}`;
  }
};

/**
 * Split an hsl/hsla color into an array of its components.
 *
 * On success, a 4 element array will be returned.  For hsl values, the alpha
 * will be set to 1.
 *
 * @param {string} color The HSL/HSLA CSS color spec.
 * @return {?Array<string>} The HSL/HSLA values split out.
 */
lib.colors.crackHSL = function(color) {
  if (color.startsWith('hsla')) {
    const ary = color.match(lib.colors.re_.hsla);
    if (ary) {
      ary.shift();
      return Array.from(ary);
    }
  } else {
    const ary = color.match(lib.colors.re_.hsl);
    if (ary) {
      ary.shift();
      ary.push('1');
      return Array.from(ary);
    }
  }

  console.error(`Couldn't crack: ${color}`);
  return null;
};

/**
 * Converts hslx array to rgba array.
 *
 * The returned alpha component defaults to 1 if it isn't present in the input.
 *
 * The returned values are not rounded to preserve precision for computations,
 * so should be rounded before they are used in CSS strings.
 *
 * @param {?Array<string|number>} hslx The HSL or HSLA elements to convert.
 * @return {!Array<number>} The RGBA values.
 */
lib.colors.hslxArrayToRgbaArray = function(hslx) {
  const hue = parseInt(hslx[0], 10) / 60;
  const sat = parseInt(hslx[1], 10) / 100;
  const light = parseInt(hslx[2], 10) / 100;

  // The following algorithm has been adapted from:
  //     https://www.w3.org/TR/css-color-4/#hsl-to-rgb
  const hueToRgb = (t1, t2, hue) => {
    if (hue < 0) {
      hue += 6;
    }
    if (hue >= 6) {
      hue -= 6;
    }

    if (hue < 1) {
      return (t2 - t1) * hue + t1;
    } else if (hue < 3) {
      return t2;
    } else if (hue < 4) {
      return (t2 - t1) * (4 - hue) + t1;
    } else {
      return t1;
    }
  };

  const t2 = light <= 0.5 ? light * (sat + 1) : light + sat - (light * sat);
  const t1 = light * 2 - t2;

  return [
    255 * hueToRgb(t1, t2, hue + 2),
    255 * hueToRgb(t1, t2, hue),
    255 * hueToRgb(t1, t2, hue - 2),
    hslx[3] !== undefined ? +hslx[3] : 1,
  ];
};

/**
 * Converts a hsvx array to a hsla array. The hsvx array is an array of [hue
 * (>=0, <=360), saturation (>=0, <=100), value (>=0, <=100), alpha] (alpha can
 * be missing).
 *
 * The returned alpha component defaults to 1 if it isn't present in the input.
 *
 * The returned values are not rounded to preserve precision for computations,
 * so should be rounded before they are used in CSS strings.
 *
 * @param {?Array<string|number>} hsvx The hsv or hsva array.
 * @return {!Array<number>} The hsla array.
 */
lib.colors.hsvxArrayToHslaArray = function(hsvx) {
  const clamp = (x) => lib.f.clamp(x, 0, 100);
  const [hue, saturation, value] = hsvx.map(parseFloat);
  const hslLightness = clamp(value * (100 - saturation / 2) / 100);
  let hslSaturation = 0;
  if (hslLightness !== 0 && hslLightness !== 100) {
    hslSaturation = clamp((value - hslLightness) /
        Math.min(hslLightness, 100 - hslLightness) * 100);
  }
  return [
      hue,
      hslSaturation,
      hslLightness,
      hsvx.length === 4 ? +hsvx[3] : 1,
  ];
};

/**
 * Converts a hslx array to a hsva array. The hsva array is an array of [hue
 * (>=0, <=360), saturation (>=0, <=100), value (>=0, <=100), alpha].
 *
 * The returned alpha component defaults to 1 if it isn't present in the input.
 *
 * @param {?Array<string|number>} hslx The hsl or hsla array.
 * @return {!Array<number>} The hsva array.
 */
lib.colors.hslxArrayToHsvaArray = function(hslx) {
  const clamp = (x) => lib.f.clamp(x, 0, 100);
  const [hue, saturation, lightness] = hslx.map(parseFloat);
  const hsvValue = clamp(
      lightness + saturation * Math.min(lightness, 100 - lightness) / 100);
  let hsvSaturation = 0;
  if (hsvValue !== 0) {
    hsvSaturation = clamp(200 * (1 - lightness / hsvValue));
  }
  return [hue, hsvSaturation, hsvValue, hslx.length === 4 ? +hslx[3] : 1];
};

/**
 * Converts one or more CSS hsl(...) or hsla(...) forms into their rgb(...) or
 * rgba(...) color values respectively.
 *
 * Arrays are converted in place. If a value cannot be converted, it is
 * replaced with null.
 *
 * @param {string} hsl A single hsl(...) or hsla(...) value to convert.
 * @return {?string} The converted value.
 */
lib.colors.hslToRGB = function(hsl) {
  const ary = lib.colors.crackHSL(hsl);
  if (!ary) {
    return null;
  }

  const [r, g, b, a] = lib.colors.hslxArrayToRgbaArray(ary);

  const rgb = [r, g, b].map(Math.round).join(', ');

  return a === 1 ? `rgb(${rgb})` : `rgba(${rgb}, ${a})`;
};

/**
 * Converts rgbx array to hsla array.
 *
 * The returned alpha component defaults to 1 if it isn't present in the input.
 *
 * The returned values are not rounded to preserve precision for computations,
 * so should be rounded before they are used in CSS strings.
 *
 * @param {?Array<string|number>} rgbx The RGB or RGBA elements to convert.
 * @return {!Array<number>} The HSLA values.
 */
lib.colors.rgbxArrayToHslaArray = function(rgbx) {
  const r = parseInt(rgbx[0], 10) / 255;
  const g = parseInt(rgbx[1], 10) / 255;
  const b = parseInt(rgbx[2], 10) / 255;

  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  const spread = max - min;

  /* eslint-disable id-denylist */
  const l = (max + min) / 2;

  if (spread == 0) {
    return [0, 0, 100 * l, rgbx[3] !== undefined ? +rgbx[3] : 1];
  }

  let h = (() => {
    switch (max) {
      case r: return ((g - b) / spread) % 6;
      case g: return (b - r) / spread + 2;
      case b: return (r - g) / spread + 4;
    }
  })();
  h *= 60;
  if (h < 0) {
    h += 360;
  }

  const s = spread / (1 - Math.abs(2 * l - 1));

  return [h, 100 * s, 100 * l, rgbx[3] !== undefined ? +rgbx[3] : 1];
  /* eslint-enable id-denylist */
};

/**
 * Converts one or more CSS rgb(...) or rgba(...) forms into their hsl(...) or
 * hsla(...) color values respectively.
 *
 * Arrays are converted in place. If a value cannot be converted, it is
 * replaced with null.
 *
 * @param {string} rgb A single rgb(...) or rgba(...) value to convert.
 * @return {?string} The converted value.
 */
lib.colors.rgbToHsl = function(rgb) {
  const ary = lib.colors.crackRGB(rgb);
  if (!ary) {
    return null;
  }

  /* eslint-disable id-denylist */
  // eslint-disable-next-line prefer-const
  let [h, s, l, a] = lib.colors.rgbxArrayToHslaArray(ary);
  h = Math.round(h);
  s = Math.round(s);
  l = Math.round(l);

  return a === 1 ? `hsl(${h}, ${s}%, ${l}%)` : `hsla(${h}, ${s}%, ${l}%, ${a})`;
  /* eslint-enable id-denylist */
};

/**
 * Take any valid CSS color definition and turn it into an rgb or rgba value.
 *
 * @param {string} def The CSS color spec to normalize.
 * @return {?string} The converted value.
 */
lib.colors.normalizeCSS = function(def) {
  if (def.startsWith('#')) {
    return lib.colors.hexToRGB(def);
  }

  if (lib.colors.re_.rgbx.test(def)) {
    return def;
  }

  if (lib.colors.re_.hslx.test(def)) {
    return lib.colors.hslToRGB(def);
  }

  return lib.colors.nameToRGB(def);
};

/**
 * Convert a 3 or 4 element array into an rgb(...) or rgba(...) string.
 *
 * @param {?Array<string|number>} ary The RGB or RGBA elements to convert.
 * @return {string} The normalized CSS color spec.
 */
lib.colors.arrayToRGBA = function(ary) {
  if (ary.length == 3) {
    return `rgb(${ary[0]}, ${ary[1]}, ${ary[2]})`;
  }
  return `rgba(${ary[0]}, ${ary[1]}, ${ary[2]}, ${ary[3]})`;
};

/**
 * Overwrite the alpha channel of an rgb/rgba color.
 *
 * @param {string} rgb The normalized CSS color spec.
 * @param {number} alpha The alpha channel.
 * @return {string} The normalized CSS color spec with updated alpha channel.
 */
lib.colors.setAlpha = function(rgb, alpha) {
  const ary = lib.colors.crackRGB(rgb);
  ary[3] = alpha.toString();
  return lib.colors.arrayToRGBA(ary);
};

/**
 * Mix a percentage of a tint color into a base color.
 *
 * @param  {string} base The normalized CSS base color spec.
 * @param  {string} tint The normalized CSS color to tint with.
 * @param  {number} percent The percentage of the tinting.
 * @return {string} The new tinted CSS color spec.
 */
lib.colors.mix = function(base, tint, percent) {
  const ary1 = lib.colors.crackRGB(base);
  const ary2 = lib.colors.crackRGB(tint);

  for (let i = 0; i < 4; ++i) {
    const basecol = parseInt(ary1[i], 10);
    const tintcol = parseInt(ary2[i], 10);
    const diff = tintcol - basecol;
    ary1[i] = Math.round(base + diff * percent).toString();
  }

  return lib.colors.arrayToRGBA(ary1);
};

/**
 * Split an rgb/rgba color into an array of its components.
 *
 * On success, a 4 element array will be returned.  For rgb values, the alpha
 * will be set to 1.
 *
 * @param {string} color The RGB/RGBA CSS color spec.
 * @return {?Array<string>} The RGB/RGBA values split out.
 */
lib.colors.crackRGB = function(color) {
  if (color.startsWith('rgba')) {
    const ary = color.match(lib.colors.re_.rgba);
    if (ary) {
      ary.shift();
      return Array.from(ary);
    }
  } else {
    const ary = color.match(lib.colors.re_.rgb);
    if (ary) {
      ary.shift();
      ary.push('1');
      return Array.from(ary);
    }
  }

  console.error('Couldn\'t crack: ' + color);
  return null;
};

/**
 * Convert an X11 color name into a CSS rgb(...) value.
 *
 * Names are stripped of spaces and converted to lowercase.  If the name is
 * unknown, null is returned.
 *
 * This list of color name to RGB mapping is derived from the stock X11
 * rgb.txt file.
 *
 * @param {string} name The color name to convert.
 * @return {?string} The corresponding CSS rgb(...) value.
 */
lib.colors.nameToRGB = function(name) {
  if (name in lib.colors.colorNames) {
    return lib.colors.colorNames[name];
  }

  name = name.toLowerCase();
  if (name in lib.colors.colorNames) {
    return lib.colors.colorNames[name];
  }

  name = name.replace(/\s+/g, '');
  if (name in lib.colors.colorNames) {
    return lib.colors.colorNames[name];
  }

  return null;
};

/**
 * Calculate the relative luminance as per
 * https://www.w3.org/TR/WCAG20/#relativeluminancedef
 *
 * @param {number} r The value (>=0 and <= 255) of the rgb component.
 * @param {number} g The value (>=0 and <= 255) of the rgb component.
 * @param {number} b The value (>=0 and <= 255) of the rgb component.
 * @return {number} The relative luminance.
 */
lib.colors.luminance = function(r, g, b) {
  const [rr, gg, bb] = [r, g, b].map((value) => {
    value /= 255;
    if (value <= 0.03928) {
      return value / 12.92;
    } else {
      return Math.pow((value + 0.055) / 1.055, 2.4);
    }
  });

  return 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
};

/**
 * Calculate the contrast ratio of two relative luminance values as per
 * https://www.w3.org/TR/WCAG20/#contrast-ratiodef
 *
 * @param {number} l1 Relative luminance value.
 * @param {number} l2 Relative luminance value.
 * @return {number} The contrast ratio.
 */
lib.colors.contrastRatio = function(l1, l2) {
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/**
 * The stock color palette.
 *
 * @type {!Array<string>}
 */
lib.colors.stockPalette = [
     // The "ANSI 16"...
    '#000000', '#CC0000', '#4E9A06', '#C4A000',
    '#3465A4', '#75507B', '#06989A', '#D3D7CF',
    '#555753', '#EF2929', '#00BA13', '#FCE94F',
    '#729FCF', '#F200CB', '#00B5BD', '#EEEEEC',

    // The 6x6 color cubes...
    '#000000', '#00005F', '#000087', '#0000AF', '#0000D7', '#0000FF',
    '#005F00', '#005F5F', '#005F87', '#005FAF', '#005FD7', '#005FFF',
    '#008700', '#00875F', '#008787', '#0087AF', '#0087D7', '#0087FF',
    '#00AF00', '#00AF5F', '#00AF87', '#00AFAF', '#00AFD7', '#00AFFF',
    '#00D700', '#00D75F', '#00D787', '#00D7AF', '#00D7D7', '#00D7FF',
    '#00FF00', '#00FF5F', '#00FF87', '#00FFAF', '#00FFD7', '#00FFFF',

    '#5F0000', '#5F005F', '#5F0087', '#5F00AF', '#5F00D7', '#5F00FF',
    '#5F5F00', '#5F5F5F', '#5F5F87', '#5F5FAF', '#5F5FD7', '#5F5FFF',
    '#5F8700', '#5F875F', '#5F8787', '#5F87AF', '#5F87D7', '#5F87FF',
    '#5FAF00', '#5FAF5F', '#5FAF87', '#5FAFAF', '#5FAFD7', '#5FAFFF',
    '#5FD700', '#5FD75F', '#5FD787', '#5FD7AF', '#5FD7D7', '#5FD7FF',
    '#5FFF00', '#5FFF5F', '#5FFF87', '#5FFFAF', '#5FFFD7', '#5FFFFF',

    '#870000', '#87005F', '#870087', '#8700AF', '#8700D7', '#8700FF',
    '#875F00', '#875F5F', '#875F87', '#875FAF', '#875FD7', '#875FFF',
    '#878700', '#87875F', '#878787', '#8787AF', '#8787D7', '#8787FF',
    '#87AF00', '#87AF5F', '#87AF87', '#87AFAF', '#87AFD7', '#87AFFF',
    '#87D700', '#87D75F', '#87D787', '#87D7AF', '#87D7D7', '#87D7FF',
    '#87FF00', '#87FF5F', '#87FF87', '#87FFAF', '#87FFD7', '#87FFFF',

    '#AF0000', '#AF005F', '#AF0087', '#AF00AF', '#AF00D7', '#AF00FF',
    '#AF5F00', '#AF5F5F', '#AF5F87', '#AF5FAF', '#AF5FD7', '#AF5FFF',
    '#AF8700', '#AF875F', '#AF8787', '#AF87AF', '#AF87D7', '#AF87FF',
    '#AFAF00', '#AFAF5F', '#AFAF87', '#AFAFAF', '#AFAFD7', '#AFAFFF',
    '#AFD700', '#AFD75F', '#AFD787', '#AFD7AF', '#AFD7D7', '#AFD7FF',
    '#AFFF00', '#AFFF5F', '#AFFF87', '#AFFFAF', '#AFFFD7', '#AFFFFF',

    '#D70000', '#D7005F', '#D70087', '#D700AF', '#D700D7', '#D700FF',
    '#D75F00', '#D75F5F', '#D75F87', '#D75FAF', '#D75FD7', '#D75FFF',
    '#D78700', '#D7875F', '#D78787', '#D787AF', '#D787D7', '#D787FF',
    '#D7AF00', '#D7AF5F', '#D7AF87', '#D7AFAF', '#D7AFD7', '#D7AFFF',
    '#D7D700', '#D7D75F', '#D7D787', '#D7D7AF', '#D7D7D7', '#D7D7FF',
    '#D7FF00', '#D7FF5F', '#D7FF87', '#D7FFAF', '#D7FFD7', '#D7FFFF',

    '#FF0000', '#FF005F', '#FF0087', '#FF00AF', '#FF00D7', '#FF00FF',
    '#FF5F00', '#FF5F5F', '#FF5F87', '#FF5FAF', '#FF5FD7', '#FF5FFF',
    '#FF8700', '#FF875F', '#FF8787', '#FF87AF', '#FF87D7', '#FF87FF',
    '#FFAF00', '#FFAF5F', '#FFAF87', '#FFAFAF', '#FFAFD7', '#FFAFFF',
    '#FFD700', '#FFD75F', '#FFD787', '#FFD7AF', '#FFD7D7', '#FFD7FF',
    '#FFFF00', '#FFFF5F', '#FFFF87', '#FFFFAF', '#FFFFD7', '#FFFFFF',

    // The greyscale ramp...
    '#080808', '#121212', '#1C1C1C', '#262626', '#303030', '#3A3A3A',
    '#444444', '#4E4E4E', '#585858', '#626262', '#6C6C6C', '#767676',
    '#808080', '#8A8A8A', '#949494', '#9E9E9E', '#A8A8A8', '#B2B2B2',
    '#BCBCBC', '#C6C6C6', '#D0D0D0', '#DADADA', '#E4E4E4', '#EEEEEE',
   ].map(lib.colors.hexToRGB);

/**
 * Named colors according to the stock X11 rgb.txt file.
 */
lib.colors.colorNames = {
  'aliceblue': 'rgb(240, 248, 255)',
  'antiquewhite': 'rgb(250, 235, 215)',
  'antiquewhite1': 'rgb(255, 239, 219)',
  'antiquewhite2': 'rgb(238, 223, 204)',
  'antiquewhite3': 'rgb(205, 192, 176)',
  'antiquewhite4': 'rgb(139, 131, 120)',
  'aquamarine': 'rgb(127, 255, 212)',
  'aquamarine1': 'rgb(127, 255, 212)',
  'aquamarine2': 'rgb(118, 238, 198)',
  'aquamarine3': 'rgb(102, 205, 170)',
  'aquamarine4': 'rgb(69, 139, 116)',
  'azure': 'rgb(240, 255, 255)',
  'azure1': 'rgb(240, 255, 255)',
  'azure2': 'rgb(224, 238, 238)',
  'azure3': 'rgb(193, 205, 205)',
  'azure4': 'rgb(131, 139, 139)',
  'beige': 'rgb(245, 245, 220)',
  'bisque': 'rgb(255, 228, 196)',
  'bisque1': 'rgb(255, 228, 196)',
  'bisque2': 'rgb(238, 213, 183)',
  'bisque3': 'rgb(205, 183, 158)',
  'bisque4': 'rgb(139, 125, 107)',
  'black': 'rgb(0, 0, 0)',
  'blanchedalmond': 'rgb(255, 235, 205)',
  'blue': 'rgb(0, 0, 255)',
  'blue1': 'rgb(0, 0, 255)',
  'blue2': 'rgb(0, 0, 238)',
  'blue3': 'rgb(0, 0, 205)',
  'blue4': 'rgb(0, 0, 139)',
  'blueviolet': 'rgb(138, 43, 226)',
  'brown': 'rgb(165, 42, 42)',
  'brown1': 'rgb(255, 64, 64)',
  'brown2': 'rgb(238, 59, 59)',
  'brown3': 'rgb(205, 51, 51)',
  'brown4': 'rgb(139, 35, 35)',
  'burlywood': 'rgb(222, 184, 135)',
  'burlywood1': 'rgb(255, 211, 155)',
  'burlywood2': 'rgb(238, 197, 145)',
  'burlywood3': 'rgb(205, 170, 125)',
  'burlywood4': 'rgb(139, 115, 85)',
  'cadetblue': 'rgb(95, 158, 160)',
  'cadetblue1': 'rgb(152, 245, 255)',
  'cadetblue2': 'rgb(142, 229, 238)',
  'cadetblue3': 'rgb(122, 197, 205)',
  'cadetblue4': 'rgb(83, 134, 139)',
  'chartreuse': 'rgb(127, 255, 0)',
  'chartreuse1': 'rgb(127, 255, 0)',
  'chartreuse2': 'rgb(118, 238, 0)',
  'chartreuse3': 'rgb(102, 205, 0)',
  'chartreuse4': 'rgb(69, 139, 0)',
  'chocolate': 'rgb(210, 105, 30)',
  'chocolate1': 'rgb(255, 127, 36)',
  'chocolate2': 'rgb(238, 118, 33)',
  'chocolate3': 'rgb(205, 102, 29)',
  'chocolate4': 'rgb(139, 69, 19)',
  'coral': 'rgb(255, 127, 80)',
  'coral1': 'rgb(255, 114, 86)',
  'coral2': 'rgb(238, 106, 80)',
  'coral3': 'rgb(205, 91, 69)',
  'coral4': 'rgb(139, 62, 47)',
  'cornflowerblue': 'rgb(100, 149, 237)',
  'cornsilk': 'rgb(255, 248, 220)',
  'cornsilk1': 'rgb(255, 248, 220)',
  'cornsilk2': 'rgb(238, 232, 205)',
  'cornsilk3': 'rgb(205, 200, 177)',
  'cornsilk4': 'rgb(139, 136, 120)',
  'cyan': 'rgb(0, 255, 255)',
  'cyan1': 'rgb(0, 255, 255)',
  'cyan2': 'rgb(0, 238, 238)',
  'cyan3': 'rgb(0, 205, 205)',
  'cyan4': 'rgb(0, 139, 139)',
  'darkblue': 'rgb(0, 0, 139)',
  'darkcyan': 'rgb(0, 139, 139)',
  'darkgoldenrod': 'rgb(184, 134, 11)',
  'darkgoldenrod1': 'rgb(255, 185, 15)',
  'darkgoldenrod2': 'rgb(238, 173, 14)',
  'darkgoldenrod3': 'rgb(205, 149, 12)',
  'darkgoldenrod4': 'rgb(139, 101, 8)',
  'darkgray': 'rgb(169, 169, 169)',
  'darkgreen': 'rgb(0, 100, 0)',
  'darkgrey': 'rgb(169, 169, 169)',
  'darkkhaki': 'rgb(189, 183, 107)',
  'darkmagenta': 'rgb(139, 0, 139)',
  'darkolivegreen': 'rgb(85, 107, 47)',
  'darkolivegreen1': 'rgb(202, 255, 112)',
  'darkolivegreen2': 'rgb(188, 238, 104)',
  'darkolivegreen3': 'rgb(162, 205, 90)',
  'darkolivegreen4': 'rgb(110, 139, 61)',
  'darkorange': 'rgb(255, 140, 0)',
  'darkorange1': 'rgb(255, 127, 0)',
  'darkorange2': 'rgb(238, 118, 0)',
  'darkorange3': 'rgb(205, 102, 0)',
  'darkorange4': 'rgb(139, 69, 0)',
  'darkorchid': 'rgb(153, 50, 204)',
  'darkorchid1': 'rgb(191, 62, 255)',
  'darkorchid2': 'rgb(178, 58, 238)',
  'darkorchid3': 'rgb(154, 50, 205)',
  'darkorchid4': 'rgb(104, 34, 139)',
  'darkred': 'rgb(139, 0, 0)',
  'darksalmon': 'rgb(233, 150, 122)',
  'darkseagreen': 'rgb(143, 188, 143)',
  'darkseagreen1': 'rgb(193, 255, 193)',
  'darkseagreen2': 'rgb(180, 238, 180)',
  'darkseagreen3': 'rgb(155, 205, 155)',
  'darkseagreen4': 'rgb(105, 139, 105)',
  'darkslateblue': 'rgb(72, 61, 139)',
  'darkslategray': 'rgb(47, 79, 79)',
  'darkslategray1': 'rgb(151, 255, 255)',
  'darkslategray2': 'rgb(141, 238, 238)',
  'darkslategray3': 'rgb(121, 205, 205)',
  'darkslategray4': 'rgb(82, 139, 139)',
  'darkslategrey': 'rgb(47, 79, 79)',
  'darkturquoise': 'rgb(0, 206, 209)',
  'darkviolet': 'rgb(148, 0, 211)',
  'debianred': 'rgb(215, 7, 81)',
  'deeppink': 'rgb(255, 20, 147)',
  'deeppink1': 'rgb(255, 20, 147)',
  'deeppink2': 'rgb(238, 18, 137)',
  'deeppink3': 'rgb(205, 16, 118)',
  'deeppink4': 'rgb(139, 10, 80)',
  'deepskyblue': 'rgb(0, 191, 255)',
  'deepskyblue1': 'rgb(0, 191, 255)',
  'deepskyblue2': 'rgb(0, 178, 238)',
  'deepskyblue3': 'rgb(0, 154, 205)',
  'deepskyblue4': 'rgb(0, 104, 139)',
  'dimgray': 'rgb(105, 105, 105)',
  'dimgrey': 'rgb(105, 105, 105)',
  'dodgerblue': 'rgb(30, 144, 255)',
  'dodgerblue1': 'rgb(30, 144, 255)',
  'dodgerblue2': 'rgb(28, 134, 238)',
  'dodgerblue3': 'rgb(24, 116, 205)',
  'dodgerblue4': 'rgb(16, 78, 139)',
  'firebrick': 'rgb(178, 34, 34)',
  'firebrick1': 'rgb(255, 48, 48)',
  'firebrick2': 'rgb(238, 44, 44)',
  'firebrick3': 'rgb(205, 38, 38)',
  'firebrick4': 'rgb(139, 26, 26)',
  'floralwhite': 'rgb(255, 250, 240)',
  'forestgreen': 'rgb(34, 139, 34)',
  'gainsboro': 'rgb(220, 220, 220)',
  'ghostwhite': 'rgb(248, 248, 255)',
  'gold': 'rgb(255, 215, 0)',
  'gold1': 'rgb(255, 215, 0)',
  'gold2': 'rgb(238, 201, 0)',
  'gold3': 'rgb(205, 173, 0)',
  'gold4': 'rgb(139, 117, 0)',
  'goldenrod': 'rgb(218, 165, 32)',
  'goldenrod1': 'rgb(255, 193, 37)',
  'goldenrod2': 'rgb(238, 180, 34)',
  'goldenrod3': 'rgb(205, 155, 29)',
  'goldenrod4': 'rgb(139, 105, 20)',
  'gray': 'rgb(190, 190, 190)',
  'gray0': 'rgb(0, 0, 0)',
  'gray1': 'rgb(3, 3, 3)',
  'gray10': 'rgb(26, 26, 26)',
  'gray100': 'rgb(255, 255, 255)',
  'gray11': 'rgb(28, 28, 28)',
  'gray12': 'rgb(31, 31, 31)',
  'gray13': 'rgb(33, 33, 33)',
  'gray14': 'rgb(36, 36, 36)',
  'gray15': 'rgb(38, 38, 38)',
  'gray16': 'rgb(41, 41, 41)',
  'gray17': 'rgb(43, 43, 43)',
  'gray18': 'rgb(46, 46, 46)',
  'gray19': 'rgb(48, 48, 48)',
  'gray2': 'rgb(5, 5, 5)',
  'gray20': 'rgb(51, 51, 51)',
  'gray21': 'rgb(54, 54, 54)',
  'gray22': 'rgb(56, 56, 56)',
  'gray23': 'rgb(59, 59, 59)',
  'gray24': 'rgb(61, 61, 61)',
  'gray25': 'rgb(64, 64, 64)',
  'gray26': 'rgb(66, 66, 66)',
  'gray27': 'rgb(69, 69, 69)',
  'gray28': 'rgb(71, 71, 71)',
  'gray29': 'rgb(74, 74, 74)',
  'gray3': 'rgb(8, 8, 8)',
  'gray30': 'rgb(77, 77, 77)',
  'gray31': 'rgb(79, 79, 79)',
  'gray32': 'rgb(82, 82, 82)',
  'gray33': 'rgb(84, 84, 84)',
  'gray34': 'rgb(87, 87, 87)',
  'gray35': 'rgb(89, 89, 89)',
  'gray36': 'rgb(92, 92, 92)',
  'gray37': 'rgb(94, 94, 94)',
  'gray38': 'rgb(97, 97, 97)',
  'gray39': 'rgb(99, 99, 99)',
  'gray4': 'rgb(10, 10, 10)',
  'gray40': 'rgb(102, 102, 102)',
  'gray41': 'rgb(105, 105, 105)',
  'gray42': 'rgb(107, 107, 107)',
  'gray43': 'rgb(110, 110, 110)',
  'gray44': 'rgb(112, 112, 112)',
  'gray45': 'rgb(115, 115, 115)',
  'gray46': 'rgb(117, 117, 117)',
  'gray47': 'rgb(120, 120, 120)',
  'gray48': 'rgb(122, 122, 122)',
  'gray49': 'rgb(125, 125, 125)',
  'gray5': 'rgb(13, 13, 13)',
  'gray50': 'rgb(127, 127, 127)',
  'gray51': 'rgb(130, 130, 130)',
  'gray52': 'rgb(133, 133, 133)',
  'gray53': 'rgb(135, 135, 135)',
  'gray54': 'rgb(138, 138, 138)',
  'gray55': 'rgb(140, 140, 140)',
  'gray56': 'rgb(143, 143, 143)',
  'gray57': 'rgb(145, 145, 145)',
  'gray58': 'rgb(148, 148, 148)',
  'gray59': 'rgb(150, 150, 150)',
  'gray6': 'rgb(15, 15, 15)',
  'gray60': 'rgb(153, 153, 153)',
  'gray61': 'rgb(156, 156, 156)',
  'gray62': 'rgb(158, 158, 158)',
  'gray63': 'rgb(161, 161, 161)',
  'gray64': 'rgb(163, 163, 163)',
  'gray65': 'rgb(166, 166, 166)',
  'gray66': 'rgb(168, 168, 168)',
  'gray67': 'rgb(171, 171, 171)',
  'gray68': 'rgb(173, 173, 173)',
  'gray69': 'rgb(176, 176, 176)',
  'gray7': 'rgb(18, 18, 18)',
  'gray70': 'rgb(179, 179, 179)',
  'gray71': 'rgb(181, 181, 181)',
  'gray72': 'rgb(184, 184, 184)',
  'gray73': 'rgb(186, 186, 186)',
  'gray74': 'rgb(189, 189, 189)',
  'gray75': 'rgb(191, 191, 191)',
  'gray76': 'rgb(194, 194, 194)',
  'gray77': 'rgb(196, 196, 196)',
  'gray78': 'rgb(199, 199, 199)',
  'gray79': 'rgb(201, 201, 201)',
  'gray8': 'rgb(20, 20, 20)',
  'gray80': 'rgb(204, 204, 204)',
  'gray81': 'rgb(207, 207, 207)',
  'gray82': 'rgb(209, 209, 209)',
  'gray83': 'rgb(212, 212, 212)',
  'gray84': 'rgb(214, 214, 214)',
  'gray85': 'rgb(217, 217, 217)',
  'gray86': 'rgb(219, 219, 219)',
  'gray87': 'rgb(222, 222, 222)',
  'gray88': 'rgb(224, 224, 224)',
  'gray89': 'rgb(227, 227, 227)',
  'gray9': 'rgb(23, 23, 23)',
  'gray90': 'rgb(229, 229, 229)',
  'gray91': 'rgb(232, 232, 232)',
  'gray92': 'rgb(235, 235, 235)',
  'gray93': 'rgb(237, 237, 237)',
  'gray94': 'rgb(240, 240, 240)',
  'gray95': 'rgb(242, 242, 242)',
  'gray96': 'rgb(245, 245, 245)',
  'gray97': 'rgb(247, 247, 247)',
  'gray98': 'rgb(250, 250, 250)',
  'gray99': 'rgb(252, 252, 252)',
  'green': 'rgb(0, 255, 0)',
  'green1': 'rgb(0, 255, 0)',
  'green2': 'rgb(0, 238, 0)',
  'green3': 'rgb(0, 205, 0)',
  'green4': 'rgb(0, 139, 0)',
  'greenyellow': 'rgb(173, 255, 47)',
  'grey': 'rgb(190, 190, 190)',
  'grey0': 'rgb(0, 0, 0)',
  'grey1': 'rgb(3, 3, 3)',
  'grey10': 'rgb(26, 26, 26)',
  'grey100': 'rgb(255, 255, 255)',
  'grey11': 'rgb(28, 28, 28)',
  'grey12': 'rgb(31, 31, 31)',
  'grey13': 'rgb(33, 33, 33)',
  'grey14': 'rgb(36, 36, 36)',
  'grey15': 'rgb(38, 38, 38)',
  'grey16': 'rgb(41, 41, 41)',
  'grey17': 'rgb(43, 43, 43)',
  'grey18': 'rgb(46, 46, 46)',
  'grey19': 'rgb(48, 48, 48)',
  'grey2': 'rgb(5, 5, 5)',
  'grey20': 'rgb(51, 51, 51)',
  'grey21': 'rgb(54, 54, 54)',
  'grey22': 'rgb(56, 56, 56)',
  'grey23': 'rgb(59, 59, 59)',
  'grey24': 'rgb(61, 61, 61)',
  'grey25': 'rgb(64, 64, 64)',
  'grey26': 'rgb(66, 66, 66)',
  'grey27': 'rgb(69, 69, 69)',
  'grey28': 'rgb(71, 71, 71)',
  'grey29': 'rgb(74, 74, 74)',
  'grey3': 'rgb(8, 8, 8)',
  'grey30': 'rgb(77, 77, 77)',
  'grey31': 'rgb(79, 79, 79)',
  'grey32': 'rgb(82, 82, 82)',
  'grey33': 'rgb(84, 84, 84)',
  'grey34': 'rgb(87, 87, 87)',
  'grey35': 'rgb(89, 89, 89)',
  'grey36': 'rgb(92, 92, 92)',
  'grey37': 'rgb(94, 94, 94)',
  'grey38': 'rgb(97, 97, 97)',
  'grey39': 'rgb(99, 99, 99)',
  'grey4': 'rgb(10, 10, 10)',
  'grey40': 'rgb(102, 102, 102)',
  'grey41': 'rgb(105, 105, 105)',
  'grey42': 'rgb(107, 107, 107)',
  'grey43': 'rgb(110, 110, 110)',
  'grey44': 'rgb(112, 112, 112)',
  'grey45': 'rgb(115, 115, 115)',
  'grey46': 'rgb(117, 117, 117)',
  'grey47': 'rgb(120, 120, 120)',
  'grey48': 'rgb(122, 122, 122)',
  'grey49': 'rgb(125, 125, 125)',
  'grey5': 'rgb(13, 13, 13)',
  'grey50': 'rgb(127, 127, 127)',
  'grey51': 'rgb(130, 130, 130)',
  'grey52': 'rgb(133, 133, 133)',
  'grey53': 'rgb(135, 135, 135)',
  'grey54': 'rgb(138, 138, 138)',
  'grey55': 'rgb(140, 140, 140)',
  'grey56': 'rgb(143, 143, 143)',
  'grey57': 'rgb(145, 145, 145)',
  'grey58': 'rgb(148, 148, 148)',
  'grey59': 'rgb(150, 150, 150)',
  'grey6': 'rgb(15, 15, 15)',
  'grey60': 'rgb(153, 153, 153)',
  'grey61': 'rgb(156, 156, 156)',
  'grey62': 'rgb(158, 158, 158)',
  'grey63': 'rgb(161, 161, 161)',
  'grey64': 'rgb(163, 163, 163)',
  'grey65': 'rgb(166, 166, 166)',
  'grey66': 'rgb(168, 168, 168)',
  'grey67': 'rgb(171, 171, 171)',
  'grey68': 'rgb(173, 173, 173)',
  'grey69': 'rgb(176, 176, 176)',
  'grey7': 'rgb(18, 18, 18)',
  'grey70': 'rgb(179, 179, 179)',
  'grey71': 'rgb(181, 181, 181)',
  'grey72': 'rgb(184, 184, 184)',
  'grey73': 'rgb(186, 186, 186)',
  'grey74': 'rgb(189, 189, 189)',
  'grey75': 'rgb(191, 191, 191)',
  'grey76': 'rgb(194, 194, 194)',
  'grey77': 'rgb(196, 196, 196)',
  'grey78': 'rgb(199, 199, 199)',
  'grey79': 'rgb(201, 201, 201)',
  'grey8': 'rgb(20, 20, 20)',
  'grey80': 'rgb(204, 204, 204)',
  'grey81': 'rgb(207, 207, 207)',
  'grey82': 'rgb(209, 209, 209)',
  'grey83': 'rgb(212, 212, 212)',
  'grey84': 'rgb(214, 214, 214)',
  'grey85': 'rgb(217, 217, 217)',
  'grey86': 'rgb(219, 219, 219)',
  'grey87': 'rgb(222, 222, 222)',
  'grey88': 'rgb(224, 224, 224)',
  'grey89': 'rgb(227, 227, 227)',
  'grey9': 'rgb(23, 23, 23)',
  'grey90': 'rgb(229, 229, 229)',
  'grey91': 'rgb(232, 232, 232)',
  'grey92': 'rgb(235, 235, 235)',
  'grey93': 'rgb(237, 237, 237)',
  'grey94': 'rgb(240, 240, 240)',
  'grey95': 'rgb(242, 242, 242)',
  'grey96': 'rgb(245, 245, 245)',
  'grey97': 'rgb(247, 247, 247)',
  'grey98': 'rgb(250, 250, 250)',
  'grey99': 'rgb(252, 252, 252)',
  'honeydew': 'rgb(240, 255, 240)',
  'honeydew1': 'rgb(240, 255, 240)',
  'honeydew2': 'rgb(224, 238, 224)',
  'honeydew3': 'rgb(193, 205, 193)',
  'honeydew4': 'rgb(131, 139, 131)',
  'hotpink': 'rgb(255, 105, 180)',
  'hotpink1': 'rgb(255, 110, 180)',
  'hotpink2': 'rgb(238, 106, 167)',
  'hotpink3': 'rgb(205, 96, 144)',
  'hotpink4': 'rgb(139, 58, 98)',
  'indianred': 'rgb(205, 92, 92)',
  'indianred1': 'rgb(255, 106, 106)',
  'indianred2': 'rgb(238, 99, 99)',
  'indianred3': 'rgb(205, 85, 85)',
  'indianred4': 'rgb(139, 58, 58)',
  'ivory': 'rgb(255, 255, 240)',
  'ivory1': 'rgb(255, 255, 240)',
  'ivory2': 'rgb(238, 238, 224)',
  'ivory3': 'rgb(205, 205, 193)',
  'ivory4': 'rgb(139, 139, 131)',
  'khaki': 'rgb(240, 230, 140)',
  'khaki1': 'rgb(255, 246, 143)',
  'khaki2': 'rgb(238, 230, 133)',
  'khaki3': 'rgb(205, 198, 115)',
  'khaki4': 'rgb(139, 134, 78)',
  'lavender': 'rgb(230, 230, 250)',
  'lavenderblush': 'rgb(255, 240, 245)',
  'lavenderblush1': 'rgb(255, 240, 245)',
  'lavenderblush2': 'rgb(238, 224, 229)',
  'lavenderblush3': 'rgb(205, 193, 197)',
  'lavenderblush4': 'rgb(139, 131, 134)',
  'lawngreen': 'rgb(124, 252, 0)',
  'lemonchiffon': 'rgb(255, 250, 205)',
  'lemonchiffon1': 'rgb(255, 250, 205)',
  'lemonchiffon2': 'rgb(238, 233, 191)',
  'lemonchiffon3': 'rgb(205, 201, 165)',
  'lemonchiffon4': 'rgb(139, 137, 112)',
  'lightblue': 'rgb(173, 216, 230)',
  'lightblue1': 'rgb(191, 239, 255)',
  'lightblue2': 'rgb(178, 223, 238)',
  'lightblue3': 'rgb(154, 192, 205)',
  'lightblue4': 'rgb(104, 131, 139)',
  'lightcoral': 'rgb(240, 128, 128)',
  'lightcyan': 'rgb(224, 255, 255)',
  'lightcyan1': 'rgb(224, 255, 255)',
  'lightcyan2': 'rgb(209, 238, 238)',
  'lightcyan3': 'rgb(180, 205, 205)',
  'lightcyan4': 'rgb(122, 139, 139)',
  'lightgoldenrod': 'rgb(238, 221, 130)',
  'lightgoldenrod1': 'rgb(255, 236, 139)',
  'lightgoldenrod2': 'rgb(238, 220, 130)',
  'lightgoldenrod3': 'rgb(205, 190, 112)',
  'lightgoldenrod4': 'rgb(139, 129, 76)',
  'lightgoldenrodyellow': 'rgb(250, 250, 210)',
  'lightgray': 'rgb(211, 211, 211)',
  'lightgreen': 'rgb(144, 238, 144)',
  'lightgrey': 'rgb(211, 211, 211)',
  'lightpink': 'rgb(255, 182, 193)',
  'lightpink1': 'rgb(255, 174, 185)',
  'lightpink2': 'rgb(238, 162, 173)',
  'lightpink3': 'rgb(205, 140, 149)',
  'lightpink4': 'rgb(139, 95, 101)',
  'lightsalmon': 'rgb(255, 160, 122)',
  'lightsalmon1': 'rgb(255, 160, 122)',
  'lightsalmon2': 'rgb(238, 149, 114)',
  'lightsalmon3': 'rgb(205, 129, 98)',
  'lightsalmon4': 'rgb(139, 87, 66)',
  'lightseagreen': 'rgb(32, 178, 170)',
  'lightskyblue': 'rgb(135, 206, 250)',
  'lightskyblue1': 'rgb(176, 226, 255)',
  'lightskyblue2': 'rgb(164, 211, 238)',
  'lightskyblue3': 'rgb(141, 182, 205)',
  'lightskyblue4': 'rgb(96, 123, 139)',
  'lightslateblue': 'rgb(132, 112, 255)',
  'lightslategray': 'rgb(119, 136, 153)',
  'lightslategrey': 'rgb(119, 136, 153)',
  'lightsteelblue': 'rgb(176, 196, 222)',
  'lightsteelblue1': 'rgb(202, 225, 255)',
  'lightsteelblue2': 'rgb(188, 210, 238)',
  'lightsteelblue3': 'rgb(162, 181, 205)',
  'lightsteelblue4': 'rgb(110, 123, 139)',
  'lightyellow': 'rgb(255, 255, 224)',
  'lightyellow1': 'rgb(255, 255, 224)',
  'lightyellow2': 'rgb(238, 238, 209)',
  'lightyellow3': 'rgb(205, 205, 180)',
  'lightyellow4': 'rgb(139, 139, 122)',
  'limegreen': 'rgb(50, 205, 50)',
  'linen': 'rgb(250, 240, 230)',
  'magenta': 'rgb(255, 0, 255)',
  'magenta1': 'rgb(255, 0, 255)',
  'magenta2': 'rgb(238, 0, 238)',
  'magenta3': 'rgb(205, 0, 205)',
  'magenta4': 'rgb(139, 0, 139)',
  'maroon': 'rgb(176, 48, 96)',
  'maroon1': 'rgb(255, 52, 179)',
  'maroon2': 'rgb(238, 48, 167)',
  'maroon3': 'rgb(205, 41, 144)',
  'maroon4': 'rgb(139, 28, 98)',
  'mediumaquamarine': 'rgb(102, 205, 170)',
  'mediumblue': 'rgb(0, 0, 205)',
  'mediumorchid': 'rgb(186, 85, 211)',
  'mediumorchid1': 'rgb(224, 102, 255)',
  'mediumorchid2': 'rgb(209, 95, 238)',
  'mediumorchid3': 'rgb(180, 82, 205)',
  'mediumorchid4': 'rgb(122, 55, 139)',
  'mediumpurple': 'rgb(147, 112, 219)',
  'mediumpurple1': 'rgb(171, 130, 255)',
  'mediumpurple2': 'rgb(159, 121, 238)',
  'mediumpurple3': 'rgb(137, 104, 205)',
  'mediumpurple4': 'rgb(93, 71, 139)',
  'mediumseagreen': 'rgb(60, 179, 113)',
  'mediumslateblue': 'rgb(123, 104, 238)',
  'mediumspringgreen': 'rgb(0, 250, 154)',
  'mediumturquoise': 'rgb(72, 209, 204)',
  'mediumvioletred': 'rgb(199, 21, 133)',
  'midnightblue': 'rgb(25, 25, 112)',
  'mintcream': 'rgb(245, 255, 250)',
  'mistyrose': 'rgb(255, 228, 225)',
  'mistyrose1': 'rgb(255, 228, 225)',
  'mistyrose2': 'rgb(238, 213, 210)',
  'mistyrose3': 'rgb(205, 183, 181)',
  'mistyrose4': 'rgb(139, 125, 123)',
  'moccasin': 'rgb(255, 228, 181)',
  'navajowhite': 'rgb(255, 222, 173)',
  'navajowhite1': 'rgb(255, 222, 173)',
  'navajowhite2': 'rgb(238, 207, 161)',
  'navajowhite3': 'rgb(205, 179, 139)',
  'navajowhite4': 'rgb(139, 121, 94)',
  'navy': 'rgb(0, 0, 128)',
  'navyblue': 'rgb(0, 0, 128)',
  'oldlace': 'rgb(253, 245, 230)',
  'olivedrab': 'rgb(107, 142, 35)',
  'olivedrab1': 'rgb(192, 255, 62)',
  'olivedrab2': 'rgb(179, 238, 58)',
  'olivedrab3': 'rgb(154, 205, 50)',
  'olivedrab4': 'rgb(105, 139, 34)',
  'orange': 'rgb(255, 165, 0)',
  'orange1': 'rgb(255, 165, 0)',
  'orange2': 'rgb(238, 154, 0)',
  'orange3': 'rgb(205, 133, 0)',
  'orange4': 'rgb(139, 90, 0)',
  'orangered': 'rgb(255, 69, 0)',
  'orangered1': 'rgb(255, 69, 0)',
  'orangered2': 'rgb(238, 64, 0)',
  'orangered3': 'rgb(205, 55, 0)',
  'orangered4': 'rgb(139, 37, 0)',
  'orchid': 'rgb(218, 112, 214)',
  'orchid1': 'rgb(255, 131, 250)',
  'orchid2': 'rgb(238, 122, 233)',
  'orchid3': 'rgb(205, 105, 201)',
  'orchid4': 'rgb(139, 71, 137)',
  'palegoldenrod': 'rgb(238, 232, 170)',
  'palegreen': 'rgb(152, 251, 152)',
  'palegreen1': 'rgb(154, 255, 154)',
  'palegreen2': 'rgb(144, 238, 144)',
  'palegreen3': 'rgb(124, 205, 124)',
  'palegreen4': 'rgb(84, 139, 84)',
  'paleturquoise': 'rgb(175, 238, 238)',
  'paleturquoise1': 'rgb(187, 255, 255)',
  'paleturquoise2': 'rgb(174, 238, 238)',
  'paleturquoise3': 'rgb(150, 205, 205)',
  'paleturquoise4': 'rgb(102, 139, 139)',
  'palevioletred': 'rgb(219, 112, 147)',
  'palevioletred1': 'rgb(255, 130, 171)',
  'palevioletred2': 'rgb(238, 121, 159)',
  'palevioletred3': 'rgb(205, 104, 137)',
  'palevioletred4': 'rgb(139, 71, 93)',
  'papayawhip': 'rgb(255, 239, 213)',
  'peachpuff': 'rgb(255, 218, 185)',
  'peachpuff1': 'rgb(255, 218, 185)',
  'peachpuff2': 'rgb(238, 203, 173)',
  'peachpuff3': 'rgb(205, 175, 149)',
  'peachpuff4': 'rgb(139, 119, 101)',
  'peru': 'rgb(205, 133, 63)',
  'pink': 'rgb(255, 192, 203)',
  'pink1': 'rgb(255, 181, 197)',
  'pink2': 'rgb(238, 169, 184)',
  'pink3': 'rgb(205, 145, 158)',
  'pink4': 'rgb(139, 99, 108)',
  'plum': 'rgb(221, 160, 221)',
  'plum1': 'rgb(255, 187, 255)',
  'plum2': 'rgb(238, 174, 238)',
  'plum3': 'rgb(205, 150, 205)',
  'plum4': 'rgb(139, 102, 139)',
  'powderblue': 'rgb(176, 224, 230)',
  'purple': 'rgb(160, 32, 240)',
  'purple1': 'rgb(155, 48, 255)',
  'purple2': 'rgb(145, 44, 238)',
  'purple3': 'rgb(125, 38, 205)',
  'purple4': 'rgb(85, 26, 139)',
  'red': 'rgb(255, 0, 0)',
  'red1': 'rgb(255, 0, 0)',
  'red2': 'rgb(238, 0, 0)',
  'red3': 'rgb(205, 0, 0)',
  'red4': 'rgb(139, 0, 0)',
  'rosybrown': 'rgb(188, 143, 143)',
  'rosybrown1': 'rgb(255, 193, 193)',
  'rosybrown2': 'rgb(238, 180, 180)',
  'rosybrown3': 'rgb(205, 155, 155)',
  'rosybrown4': 'rgb(139, 105, 105)',
  'royalblue': 'rgb(65, 105, 225)',
  'royalblue1': 'rgb(72, 118, 255)',
  'royalblue2': 'rgb(67, 110, 238)',
  'royalblue3': 'rgb(58, 95, 205)',
  'royalblue4': 'rgb(39, 64, 139)',
  'saddlebrown': 'rgb(139, 69, 19)',
  'salmon': 'rgb(250, 128, 114)',
  'salmon1': 'rgb(255, 140, 105)',
  'salmon2': 'rgb(238, 130, 98)',
  'salmon3': 'rgb(205, 112, 84)',
  'salmon4': 'rgb(139, 76, 57)',
  'sandybrown': 'rgb(244, 164, 96)',
  'seagreen': 'rgb(46, 139, 87)',
  'seagreen1': 'rgb(84, 255, 159)',
  'seagreen2': 'rgb(78, 238, 148)',
  'seagreen3': 'rgb(67, 205, 128)',
  'seagreen4': 'rgb(46, 139, 87)',
  'seashell': 'rgb(255, 245, 238)',
  'seashell1': 'rgb(255, 245, 238)',
  'seashell2': 'rgb(238, 229, 222)',
  'seashell3': 'rgb(205, 197, 191)',
  'seashell4': 'rgb(139, 134, 130)',
  'sienna': 'rgb(160, 82, 45)',
  'sienna1': 'rgb(255, 130, 71)',
  'sienna2': 'rgb(238, 121, 66)',
  'sienna3': 'rgb(205, 104, 57)',
  'sienna4': 'rgb(139, 71, 38)',
  'skyblue': 'rgb(135, 206, 235)',
  'skyblue1': 'rgb(135, 206, 255)',
  'skyblue2': 'rgb(126, 192, 238)',
  'skyblue3': 'rgb(108, 166, 205)',
  'skyblue4': 'rgb(74, 112, 139)',
  'slateblue': 'rgb(106, 90, 205)',
  'slateblue1': 'rgb(131, 111, 255)',
  'slateblue2': 'rgb(122, 103, 238)',
  'slateblue3': 'rgb(105, 89, 205)',
  'slateblue4': 'rgb(71, 60, 139)',
  'slategray': 'rgb(112, 128, 144)',
  'slategray1': 'rgb(198, 226, 255)',
  'slategray2': 'rgb(185, 211, 238)',
  'slategray3': 'rgb(159, 182, 205)',
  'slategray4': 'rgb(108, 123, 139)',
  'slategrey': 'rgb(112, 128, 144)',
  'snow': 'rgb(255, 250, 250)',
  'snow1': 'rgb(255, 250, 250)',
  'snow2': 'rgb(238, 233, 233)',
  'snow3': 'rgb(205, 201, 201)',
  'snow4': 'rgb(139, 137, 137)',
  'springgreen': 'rgb(0, 255, 127)',
  'springgreen1': 'rgb(0, 255, 127)',
  'springgreen2': 'rgb(0, 238, 118)',
  'springgreen3': 'rgb(0, 205, 102)',
  'springgreen4': 'rgb(0, 139, 69)',
  'steelblue': 'rgb(70, 130, 180)',
  'steelblue1': 'rgb(99, 184, 255)',
  'steelblue2': 'rgb(92, 172, 238)',
  'steelblue3': 'rgb(79, 148, 205)',
  'steelblue4': 'rgb(54, 100, 139)',
  'tan': 'rgb(210, 180, 140)',
  'tan1': 'rgb(255, 165, 79)',
  'tan2': 'rgb(238, 154, 73)',
  'tan3': 'rgb(205, 133, 63)',
  'tan4': 'rgb(139, 90, 43)',
  'thistle': 'rgb(216, 191, 216)',
  'thistle1': 'rgb(255, 225, 255)',
  'thistle2': 'rgb(238, 210, 238)',
  'thistle3': 'rgb(205, 181, 205)',
  'thistle4': 'rgb(139, 123, 139)',
  'tomato': 'rgb(255, 99, 71)',
  'tomato1': 'rgb(255, 99, 71)',
  'tomato2': 'rgb(238, 92, 66)',
  'tomato3': 'rgb(205, 79, 57)',
  'tomato4': 'rgb(139, 54, 38)',
  'turquoise': 'rgb(64, 224, 208)',
  'turquoise1': 'rgb(0, 245, 255)',
  'turquoise2': 'rgb(0, 229, 238)',
  'turquoise3': 'rgb(0, 197, 205)',
  'turquoise4': 'rgb(0, 134, 139)',
  'violet': 'rgb(238, 130, 238)',
  'violetred': 'rgb(208, 32, 144)',
  'violetred1': 'rgb(255, 62, 150)',
  'violetred2': 'rgb(238, 58, 140)',
  'violetred3': 'rgb(205, 50, 120)',
  'violetred4': 'rgb(139, 34, 82)',
  'wheat': 'rgb(245, 222, 179)',
  'wheat1': 'rgb(255, 231, 186)',
  'wheat2': 'rgb(238, 216, 174)',
  'wheat3': 'rgb(205, 186, 150)',
  'wheat4': 'rgb(139, 126, 102)',
  'white': 'rgb(255, 255, 255)',
  'whitesmoke': 'rgb(245, 245, 245)',
  'yellow': 'rgb(255, 255, 0)',
  'yellow1': 'rgb(255, 255, 0)',
  'yellow2': 'rgb(238, 238, 0)',
  'yellow3': 'rgb(205, 205, 0)',
  'yellow4': 'rgb(139, 139, 0)',
  'yellowgreen': 'rgb(154, 205, 50)',
};
// SOURCE FILE: libdot/js/lib_f.js
// Copyright (c) 2012 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Grab bag of utility functions.
 */
lib.f = {};

/**
 * Replace variable references in a string.
 *
 * Variables are of the form %FUNCTION(VARNAME).  FUNCTION is an optional
 * escape function to apply to the value.
 *
 * For example
 *   lib.f.replaceVars("%(greeting), %encodeURIComponent(name)",
 *                     { greeting: "Hello",
 *                       name: "Google+" });
 *
 * Will result in "Hello, Google%2B".
 *
 * @param {string} str String containing variable references.
 * @param {!Object<string, string>} vars Variables to substitute in.
 * @return {string} String with references substituted.
 */
lib.f.replaceVars = function(str, vars) {
  return str.replace(/%([a-z]*)\(([^)]+)\)/gi, function(match, fn, varname) {
      if (typeof vars[varname] == 'undefined') {
        throw new Error(`Unknown variable: ${varname}`);
      }

      let rv = vars[varname];

      if (fn in lib.f.replaceVars.functions) {
        rv = lib.f.replaceVars.functions[fn](rv);
      } else if (fn) {
        throw new Error(`Unknown escape function: ${fn}`);
      }

      return rv;
    });
};

/**
 * Functions that can be used with replaceVars.
 *
 * Clients can add to this list to extend lib.f.replaceVars().
 */
lib.f.replaceVars.functions = {
  encodeURI: encodeURI,
  encodeURIComponent: encodeURIComponent,
  escapeHTML: function(str) {
    const map = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      '"': '&quot;',
      "'": '&#39;',
    };

    return str.replace(/[<>&"']/g, (m) => map[m]);
  },
};

/**
 * Convert a relative path to a fully qualified URI.
 *
 * @param {string} path Relative path
 * @return {string} Fully qualified URI.
 */
lib.f.getURL = function(path) {
  if (lib.f.getURL.chromeSupported()) {
    return chrome.runtime.getURL(path);
  }

  // Use current location origin if path is absolute.
  if (path.startsWith('/')) {
    return window.location.origin + path;
  }

  return path;
};

/**
 * Determine whether the runtime is Chrome (or equiv).
 *
 * @return {boolean} True if chrome.runtime.getURL is supported.
 */
lib.f.getURL.chromeSupported = function() {
  return !!(window.chrome && chrome.runtime && chrome.runtime.getURL);
};

/**
 * Clamp a given integer to a specified range.
 *
 * @param {number} v The value to be clamped.
 * @param {number} min The minimum acceptable value.
 * @param {number} max The maximum acceptable value.
 * @return {number} The clamped value.
 */
lib.f.clamp = function(v, min, max) {
  if (v < min) {
    return min;
  }
  if (v > max) {
    return max;
  }
  return v;
};

/**
 * Left pad a number to a given length with leading zeros.
 *
 * @param {string|number} number The number to pad.
 * @param {number} length The desired length.
 * @return {string} The padded number as a string.
 */
lib.f.zpad = function(number, length) {
  return String(number).padStart(length, '0');
};

/**
 * Return the current call stack after skipping a given number of frames.
 *
 * This method is intended to be used for debugging only.  It returns an
 * Object instead of an Array, because the console stringifies arrays by
 * default and that's not what we want.
 *
 * A typical call might look like...
 *
 *    console.log('Something wicked this way came', lib.f.getStack());
 *    //                         Notice the comma ^
 *
 * This would print the message to the js console, followed by an object
 * which can be clicked to reveal the stack.
 *
 * @param {number=} ignoreFrames How many inner stack frames to ignore.  The
 *     innermost 'getStack' call is always ignored.
 * @param {number=} count How many frames to return.
 * @return {!Array<string>} The stack frames.
 */
lib.f.getStack = function(ignoreFrames = 0, count = undefined) {
  const stackArray = (new Error()).stack.split('\n');

  // Always ignore the Error() object and getStack call itself.
  // [0] = 'Error'
  // [1] = '    at Object.lib.f.getStack (file:///.../lib_f.js:267:23)'
  ignoreFrames += 2;

  const max = stackArray.length - ignoreFrames;
  if (count === undefined) {
    count = max;
  } else {
    count = lib.f.clamp(count, 0, max);
  }

  // Remove the leading spaces and "at" from each line:
  // '    at window.onload (file:///.../lib_test.js:11:18)'
  const stackObject = new Array();
  for (let i = ignoreFrames; i < count + ignoreFrames; ++i) {
    stackObject.push(stackArray[i].replace(/^\s*at\s+/, ''));
  }

  return stackObject;
};

/**
 * Divides the two numbers and floors the results, unless the remainder is less
 * than an incredibly small value, in which case it returns the ceiling.
 * This is useful when the number are truncated approximations of longer
 * values, and so doing division with these numbers yields a result incredibly
 * close to a whole number.
 *
 * @param {number} numerator
 * @param {number} denominator
 * @return {number}
 */
lib.f.smartFloorDivide = function(numerator, denominator) {
  const val = numerator / denominator;
  const ceiling = Math.ceil(val);
  if (ceiling - val < .0001) {
    return ceiling;
  } else {
    return Math.floor(val);
  }
};

/**
 * Get the current OS.
 *
 * @return {!Promise<string>} A promise that resolves to a constant in
 *     runtime.PlatformOs.
 */
lib.f.getOs = function() {
  // Try the brower extensions API.
  if (window.browser && browser.runtime && browser.runtime.getPlatformInfo) {
    return browser.runtime.getPlatformInfo().then((info) => info.os);
  }

  // Use the native Chrome API if available.
  if (window.chrome && chrome.runtime && chrome.runtime.getPlatformInfo) {
    return new Promise((resolve, reject) => {
      return chrome.runtime.getPlatformInfo((info) => resolve(info.os));
    });
  }

  // Fallback logic.  Capture the major OS's.  The rest should support the
  // browser API above.
  if (window.navigator && navigator.userAgent) {
    const ua = navigator.userAgent;
    if (ua.includes('Mac OS X')) {
      return Promise.resolve('mac');
    } else if (ua.includes('CrOS')) {
      return Promise.resolve('cros');
    } else if (ua.includes('Linux')) {
      return Promise.resolve('linux');
    } else if (ua.includes('Android')) {
      return Promise.resolve('android');
    } else if (ua.includes('Windows')) {
      return Promise.resolve('windows');
    }
  }

  // Probe node environment.
  if (typeof process != 'undefined') {
    return Promise.resolve('node');
  }

  // Still here?  No idea.
  return Promise.reject(null);
};

/**
 * Get the current Chrome milestone version.
 *
 * @return {number} The milestone number if we're running on Chrome, else NaN.
 */
lib.f.getChromeMilestone = function() {
  if (window.navigator && navigator.userAgent) {
    const ary = navigator.userAgent.match(/\sChrome\/(\d+)/);
    if (ary) {
      return parseInt(ary[1], 10);
    }
  }

  // Returning NaN will make all number comparisons fail.
  return NaN;
};

/**
 * Return the lastError string in the browser.
 *
 * This object might live in different locations, and it isn't always defined
 * (if there hasn't been a "last error").  Wrap all that ugliness here.
 *
 * @param {?string=} defaultMsg The default message if no error is found.
 * @return {?string} The last error message from the browser.
 */
lib.f.lastError = function(defaultMsg = null) {
  let lastError;
  if (window.browser && browser.runtime) {
    lastError = browser.runtime.lastError;
  } else if (window.chrome && chrome.runtime) {
    lastError = chrome.runtime.lastError;
  }

  if (lastError && lastError.message) {
    return lastError.message;
  } else {
    return defaultMsg;
  }
};

/**
 * Just like window.open, but enforce noopener.
 *
 * If we're not careful, the website we open will have access to use via its
 * window.opener field.  Newer browser support putting 'noopener' into the
 * features argument, but there are many which still don't.  So hack it.
 *
 * @param {string=} url The URL to point the new window to.
 * @param {string=} name The name of the new window.
 * @param {string=} features The window features to enable.
 * @return {?Window} The newly opened window.
 */
lib.f.openWindow = function(url, name = undefined, features = undefined) {
  // We create the window first without the URL loaded.
  const win = window.open(undefined, name, features);

  // If the system is blocking window.open, don't crash.
  if (win !== null) {
    // Clear the opener setting before redirecting.
    win.opener = null;

    // Now it's safe to redirect.  Skip this step if the url is not set so we
    // mimic the window.open behavior more precisely.
    if (url) {
      win.location = url;
    }
  }

  return win;
};
// SOURCE FILE: libdot/js/lib_i18n.js
// Copyright 2018 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Wrappers over the browser i18n helpers.
 *
 * Arguably some of these functions should be l10n, but oh well.
 */
lib.i18n = {};

/**
 * Convenience shortcut to the browser i18n object.
 */
lib.i18n.browser_ =
    window.browser && browser.i18n ? browser.i18n :
    window.chrome && chrome.i18n ? chrome.i18n :
    null;

/**
 * Return whether the browser supports i18n natively.
 *
 * @return {boolean} True if browser.i18n or chrome.i18n exists.
 */
lib.i18n.browserSupported = function() {
  return lib.i18n.browser_ !== null;
};

/**
 * Get the list of accepted UI languages.
 *
 * https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/i18n/getAcceptLanguages
 *
 * @return {!Promise<!Array<string>>} Promise resolving to the list of locale
 *     names.
 */
lib.i18n.getAcceptLanguages = function() {
  if (lib.i18n.browser_) {
    return new Promise((resolve) => {
      lib.i18n.browser_.getAcceptLanguages((languages) => {
        // Chrome might be in a bad state and not return any languages.  If we
        // pass this up to the caller who isn't expecting undefined, they'll
        // probably crash.  Fallback to the default language that we expect all
        // translations to have.
        if (!languages) {
          // Clear the error to avoid throwing an unchecked error.
          console.error('getAcceptLanguages failed', lib.f.lastError());
          languages = ['en'];
        }

        resolve(languages);
      });
    });
  } else {
    const languages = navigator.languages || [navigator.language];
    return Promise.resolve(languages);
  }
};

/**
 * Get a message by name, optionally replacing arguments too.
 *
 * https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/i18n/getMessage
 *
 * @param {string} msgname The id for this localized string.
 * @param {?Array<string>=} substitutions Any replacements in the string.
 * @param {string=} fallback Translation if the message wasn't found.
 * @return {string} The translated message.
 */
lib.i18n.getMessage = function(msgname, substitutions = [], fallback = '') {
  // First let the native browser APIs handle everything for us.
  if (lib.i18n.browser_) {
    const message = lib.i18n.browser_.getMessage(msgname, substitutions);
    if (message) {
      return message;
    }
  }

  // Do our best to get something reasonable.
  return lib.i18n.replaceReferences(fallback, substitutions);
};

/**
 * Replace $1...$n references with the elements of the args array.
 *
 * This largely behaves like Chrome's getMessage helper.  The $# references are
 * always replaced/removed regardless of the specified substitutions.
 *
 * @param {string} msg String containing the message and argument references.
 * @param {(?Array<string>|string)=} args Array containing the argument values,
 *     or single value.
 * @return {string} The message with replacements expanded.
 */
lib.i18n.replaceReferences = function(msg, args = []) {
  // The Chrome API allows a single substitution as a string rather than array.
  if (args === null) {
    args = [];
  }
  if (!(args instanceof Array)) {
    args = [args];
  }

  return msg.replace(/\$(\d+)/g, (m, index) => {
    return index <= args.length ? args[index - 1] : '';
  });
};

/**
 * This function aims to copy the chrome.i18n mapping from language to which
 * _locales/<locale>/messages.json translation is used.  E.g. en-AU maps to
 * en_GB.
 * https://cs.chromium.org/chromium/src/ui/base/l10n/l10n_util.cc?type=cs&q=CheckAndResolveLocale
 *
 * @param {string} language language from navigator.languages.
 * @return {!Array<string>} priority list of locales for translation.
 */
lib.i18n.resolveLanguage = function(language) {
  const [lang, region] = language.toLowerCase().split(/[-_]/, 2);

  // Map es-RR other than es-ES to es-419 (Chrome's Latin American
  // Spanish locale).
  if (lang == 'es') {
    if ([undefined, 'es'].includes(region)) {
      return ['es'];
    }
    return ['es_419'];
  }

  // Map pt-RR other than pt-BR to pt-PT. Note that "pt" by itself maps to
  // pt-BR (logic below).
  if (lang == 'pt') {
    if ([undefined, 'br'].includes(region)) {
      return ['pt_BR'];
    }
    return ['pt_PT'];
  }

  // Map zh-HK and zh-MO to zh-TW. Otherwise, zh-FOO is mapped to zh-CN.
  if (lang == 'zh') {
    if (['tw', 'hk', 'mo'].includes(region)) {
      return ['zh_TW'];
    }
    return ['zh_CN'];
  }

  // Map Liberian and Filipino English to US English, and everything else to
  // British English.
  if (lang == 'en') {
    if ([undefined, 'us', 'lr', 'ph'].includes(region)) {
      return ['en'];
    }

    // Our GB translation is not complete, so need to add 'en' as a fallback.
    return ['en_GB', 'en'];
  }

  if (region) {
    return [language.replace(/-/g, '_'), lang];
  } else {
    return [lang];
  }
};
// SOURCE FILE: libdot/js/lib_preference_manager.js
// Copyright (c) 2012 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Constructor for lib.PreferenceManager objects.
 *
 * These objects deal with persisting changes to stable storage and notifying
 * consumers when preferences change.
 *
 * It is intended that the backing store could be something other than HTML5
 * storage, but there aren't any use cases at the moment.  In the future there
 * may be a chrome api to store sync-able name/value pairs, and we'd want
 * that.
 *
 * @param {!lib.Storage} storage The storage object to use as a backing
 *     store.
 * @param {string=} prefix The optional prefix to be used for all preference
 *     names.  The '/' character should be used to separate levels of hierarchy,
 *     if you're going to have that kind of thing.  If provided, the prefix
 *     should start with a '/'.  If not provided, it defaults to '/'.
 * @constructor
 */
lib.PreferenceManager = function(storage, prefix = '/') {
  this.storage = storage;
  this.storageObserver_ = this.onStorageChange_.bind(this);
  this.storage.addObserver(this.storageObserver_);

  this.trace = false;

  if (!prefix.endsWith('/')) {
    prefix += '/';
  }

  this.prefix = prefix;

  // Internal state for when we're doing a bulk import from JSON and we want
  // to elide redundant storage writes (for quota reasons).
  this.isImportingJson_ = false;

  /** @type {!Object<string, !lib.PreferenceManager.Record>} */
  this.prefRecords_ = {};
  this.globalObservers_ = [];
  this.prefixObservers_ = [];

  this.childFactories_ = {};

  // Map of list-name to {map of child pref managers}
  // As in...
  //
  //  this.childLists_ = {
  //    'profile-ids': {
  //      'one': PreferenceManager,
  //      'two': PreferenceManager,
  //      ...
  //    },
  //
  //    'frob-ids': {
  //      ...
  //    }
  //  }
  this.childLists_ = {};
};

/**
 * Used internally to indicate that the current value of the preference should
 * be taken from the default value defined with the preference.
 *
 * Equality tests against this value MUST use '===' or '!==' to be accurate.
 *
 * @type {symbol}
 */
lib.PreferenceManager.prototype.DEFAULT_VALUE = Symbol('DEFAULT_VALUE');

/**
 * An individual preference.
 *
 * These objects are managed by the PreferenceManager, you shouldn't need to
 * handle them directly.
 *
 * @param {string} name The name of the new preference (used for indexing).
 * @param {*} defaultValue The default value for this preference.
 * @constructor
 */
lib.PreferenceManager.Record = function(name, defaultValue) {
  this.name = name;
  this.defaultValue = defaultValue;
  this.currentValue = this.DEFAULT_VALUE;
  this.observers = [];
};

/**
 * A local copy of the DEFAULT_VALUE constant to make it less verbose.
 *
 * @type {symbol}
 */
lib.PreferenceManager.Record.prototype.DEFAULT_VALUE =
    lib.PreferenceManager.prototype.DEFAULT_VALUE;

/**
 * Register a callback to be invoked when this preference changes.
 *
 * @param {function(string, string, !lib.PreferenceManager)} observer The
 *     function to invoke.  It will receive the new value, the name of the
 *     preference, and a reference to the PreferenceManager as parameters.
 */
lib.PreferenceManager.Record.prototype.addObserver = function(observer) {
  this.observers.push(observer);
};

/**
 * Unregister an observer callback.
 *
 * @param {function(string, string, !lib.PreferenceManager)} observer A
 *     previously registered callback.
 */
lib.PreferenceManager.Record.prototype.removeObserver = function(observer) {
  const i = this.observers.indexOf(observer);
  if (i >= 0) {
    this.observers.splice(i, 1);
  }
};

/**
 * Fetch the value of this preference.
 *
 * @return {*} The value for this preference.
 */
lib.PreferenceManager.Record.prototype.get = function() {
  const result = this.currentValue === this.DEFAULT_VALUE ?
      this.defaultValue : this.currentValue;

  if (typeof this.defaultValue === 'object') {
    // We want to return a COPY of the value so that users can
    // modify the array or object without changing the value.
    return JSON.parse(JSON.stringify(result));
  }

  return result;
};

/**
 * Update prefix and reset and reload storage, then notify prefix observers, and
 * all pref observers with new values.
 *
 * @param {string} prefix
 * @param {function()=} callback Optional function to invoke when completed.
 */
lib.PreferenceManager.prototype.setPrefix = function(prefix, callback) {
  if (!prefix.endsWith('/')) {
    prefix += '/';
  }
  if (prefix === this.prefix) {
    if (callback) {
      callback();
    }
    return;
  }

  this.prefix = prefix;

  for (const name in this.prefRecords_) {
    this.prefRecords_[name].currentValue = this.DEFAULT_VALUE;
  }

  this.readStorage(() => {
    for (const o of this.prefixObservers_) {
      o(this.prefix, this);
    }
    this.notifyAll();
    if (callback) {
      callback();
    }
  });
};

/**
 * Read the backing storage for these preferences.
 *
 * You should do this once at initialization time to prime the local cache
 * of preference values.  The preference manager will monitor the backing
 * storage for changes, so you should not need to call this more than once.
 *
 * This function recursively reads storage for all child preference managers as
 * well.
 *
 * This function is asynchronous, if you need to read preference values, you
 * *must* wait for the callback.
 *
 * @param {function()=} callback Optional function to invoke when the read
 *     has completed.
 */
lib.PreferenceManager.prototype.readStorage = function(callback = undefined) {
  let pendingChildren = 0;

  function onChildComplete() {
    if (--pendingChildren == 0 && callback) {
      callback();
    }
  }

  const keys = Object.keys(this.prefRecords_).map((el) => this.prefix + el);

  if (this.trace) {
    console.log('Preferences read: ' + this.prefix);
  }

  this.storage.getItems(keys).then((items) => {
      const prefixLength = this.prefix.length;

      for (const key in items) {
        const value = items[key];
        const name = key.substr(prefixLength);
        const needSync = (
            name in this.childLists_ &&
            (JSON.stringify(value) !=
             JSON.stringify(this.prefRecords_[name].currentValue)));

        this.prefRecords_[name].currentValue = value;

        if (needSync) {
          pendingChildren++;
          this.syncChildList(name, onChildComplete);
        }
      }

      if (pendingChildren == 0 && callback) {
        setTimeout(callback);
      }
    });
};

/**
 * Define a preference.
 *
 * This registers a name, default value, and onChange handler for a preference.
 *
 * @param {string} name The name of the preference.  This will be prefixed by
 *     the prefix of this PreferenceManager before written to local storage.
 * @param {string|number|boolean|!Object|!Array|null} value The default value of
 *     this preference.  Anything that can be represented in JSON is a valid
 *     default value.
 * @param {function(*, string, !lib.PreferenceManager)=} onChange A
 *     function to invoke when the preference changes.  It will receive the new
 *     value, the name of the preference, and a reference to the
 *     PreferenceManager as parameters.
 */
lib.PreferenceManager.prototype.definePreference = function(
    name, value, onChange = undefined) {

  let record = this.prefRecords_[name];
  if (record) {
    this.changeDefault(name, value);
  } else {
    record = this.prefRecords_[name] =
        new lib.PreferenceManager.Record(name, value);
  }

  if (onChange) {
    record.addObserver(onChange);
  }
};

/**
 * Define multiple preferences with a single function call.
 *
 * @param {!Array<*>} defaults An array of 3-element arrays.  Each three element
 *     array should contain the [key, value, onChange] parameters for a
 *     preference.
 */
lib.PreferenceManager.prototype.definePreferences = function(defaults) {
  for (let i = 0; i < defaults.length; i++) {
    this.definePreference(defaults[i][0], defaults[i][1], defaults[i][2]);
  }
};

/**
 * Unregister an observer callback.
 *
 * @param {function(string, !lib.PreferenceManager)} observer A
 *     previously registered callback.
 */
lib.PreferenceManager.prototype.removePrefixObserver = function(observer) {
  const i = this.prefixObservers_.indexOf(observer);
  if (i >= 0) {
    this.prefixObservers_.splice(i, 1);
  }
};

/**
 * Register to observe preference changes.
 *
 * @param {string} name The name of preference you wish to observe..
 * @param {function(*, string, !lib.PreferenceManager)} observer The callback.
 */
lib.PreferenceManager.prototype.addObserver = function(name, observer) {
  if (!(name in this.prefRecords_)) {
    throw new Error(`Unknown preference: ${name}`);
  }

  this.prefRecords_[name].addObserver(observer);
};

/**
 * Register to observe preference changes.
 *
 * @param {?function()} global A callback that will happen for every preference.
 *     Pass null if you don't need one.
 * @param {!Object} map A map of preference specific callbacks.  Pass null if
 *     you don't need any.
 */
lib.PreferenceManager.prototype.addObservers = function(global, map) {
  if (global && typeof global != 'function') {
    throw new Error('Invalid param: globals');
  }

  if (global) {
    this.globalObservers_.push(global);
  }

  if (!map) {
    return;
  }

  for (const name in map) {
    this.addObserver(name, map[name]);
  }
};

/**
 * Remove preference observer.
 *
 * @param {string} name The name of preference you wish to stop observing.
 * @param {function(*, string, !lib.PreferenceManager)} observer The observer to
 *     remove.
 */
lib.PreferenceManager.prototype.removeObserver = function(name, observer) {
  if (!(name in this.prefRecords_)) {
    throw new Error(`Unknown preference: ${name}`);
  }

  this.prefRecords_[name].removeObserver(observer);
};

/**
 * Dispatch the change observers for all known preferences.
 *
 * It may be useful to call this after readStorage completes, in order to
 * get application state in sync with user preferences.
 *
 * This can be used if you've changed a preference manager out from under
 * a live object, for example when switching to a different prefix.
 */
lib.PreferenceManager.prototype.notifyAll = function() {
  for (const name in this.prefRecords_) {
    this.notifyChange_(name);
  }
};

/**
 * Notify the change observers for a given preference.
 *
 * @param {string} name The name of the preference that changed.
 */
lib.PreferenceManager.prototype.notifyChange_ = function(name) {
  const record = this.prefRecords_[name];
  if (!record) {
    throw new Error('Unknown preference: ' + name);
  }

  const currentValue = record.get();

  for (let i = 0; i < this.globalObservers_.length; i++) {
    this.globalObservers_[i](name, currentValue);
  }

  for (let i = 0; i < record.observers.length; i++) {
    record.observers[i](currentValue, name, this);
  }
};

/**
 * Remove a child preferences instance.
 *
 * Removes a child preference manager and clears any preferences stored in it.
 *
 * @param {string} listName The name of the child list containing the child to
 *     remove.
 * @param {string} id The child ID.
 */
lib.PreferenceManager.prototype.removeChild = function(listName, id) {
  const prefs = this.getChild(listName, id);
  prefs.resetAll();

  const ids = /** @type {!Array<string>} */ (this.get(listName));
  const i = ids.indexOf(id);
  if (i != -1) {
    ids.splice(i, 1);
    this.set(listName, ids, undefined, !this.isImportingJson_);
  }

  delete this.childLists_[listName][id];
};

/**
 * Return a child PreferenceManager instance for a given id.
 *
 * If the child list or child id is not known this will return the specified
 * default value or throw an exception if no default value is provided.
 *
 * @param {string} listName The child list to look in.
 * @param {string} id The child ID.
 * @param {!lib.PreferenceManager=} defaultValue The value to return if the
 *     child is not found.
 * @return {!lib.PreferenceManager} The specified child PreferenceManager.
 */
lib.PreferenceManager.prototype.getChild = function(
    listName, id, defaultValue = undefined) {
  if (!(listName in this.childLists_)) {
    throw new Error('Unknown child list: ' + listName);
  }

  const childList = this.childLists_[listName];
  if (!(id in childList)) {
    if (defaultValue === undefined) {
      throw new Error('Unknown "' + listName + '" child: ' + id);
    }

    return defaultValue;
  }

  return childList[id];
};

/**
 * Reset a preference to its default state.
 *
 * This will dispatch the onChange handler if the preference value actually
 * changes.
 *
 * @param {string} name The preference to reset.
 */
lib.PreferenceManager.prototype.reset = function(name) {
  const record = this.prefRecords_[name];
  if (!record) {
    throw new Error('Unknown preference: ' + name);
  }

  this.storage.removeItem(this.prefix + name);

  if (record.currentValue !== this.DEFAULT_VALUE) {
    record.currentValue = this.DEFAULT_VALUE;
    this.notifyChange_(name);
  }
};

/**
 * Reset all preferences back to their default state.
 */
lib.PreferenceManager.prototype.resetAll = function() {
  const changed = [];

  for (const listName in this.childLists_) {
    const childList = this.childLists_[listName];
    for (const id in childList) {
      childList[id].resetAll();
    }
  }

  for (const name in this.prefRecords_) {
    if (this.prefRecords_[name].currentValue !== this.DEFAULT_VALUE) {
      this.prefRecords_[name].currentValue = this.DEFAULT_VALUE;
      changed.push(name);
    }
  }

  const keys = Object.keys(this.prefRecords_).map(function(el) {
      return this.prefix + el;
  }.bind(this));

  this.storage.removeItems(keys);

  changed.forEach(this.notifyChange_.bind(this));
};

/**
 * Return true if two values should be considered not-equal.
 *
 * If both values are the same scalar type and compare equal this function
 * returns false (no difference), otherwise return true.
 *
 * This is used in places where we want to check if a preference has changed.
 * Compare complex values (objects or arrays) using JSON serialization. Objects
 * with more than a single primitive property may not have the same JSON
 * serialization, but for our purposes with default objects, this is OK.
 *
 * @param {*} a A value to compare.
 * @param {*} b A value to compare.
 * @return {boolean} Whether the two are not equal.
 */
lib.PreferenceManager.prototype.diff = function(a, b) {
  // If the types are different.
  if ((typeof a) !== (typeof b)) {
    return true;
  }

  // Or if the type is not a simple primitive one.
  if (!(/^(undefined|boolean|number|string)$/.test(typeof a))) {
    // Special case the null object.
    if (a === null && b === null) {
      return false;
    } else {
      return JSON.stringify(a) !== JSON.stringify(b);
    }
  }

  // Do a normal compare for primitive types.
  return a !== b;
};

/**
 * Change the default value of a preference.
 *
 * This is useful when subclassing preference managers.
 *
 * The function does not alter the current value of the preference, unless
 * it has the old default value.  When that happens, the change observers
 * will be notified.
 *
 * @param {string} name The name of the parameter to change.
 * @param {*} newValue The new default value for the preference.
 */
lib.PreferenceManager.prototype.changeDefault = function(name, newValue) {
  const record = this.prefRecords_[name];
  if (!record) {
    throw new Error('Unknown preference: ' + name);
  }

  if (!this.diff(record.defaultValue, newValue)) {
    // Default value hasn't changed.
    return;
  }

  if (record.currentValue !== this.DEFAULT_VALUE) {
    // This pref has a specific value, just change the default and we're done.
    record.defaultValue = newValue;
    return;
  }

  record.defaultValue = newValue;

  this.notifyChange_(name);
};

/**
 * Change the default value of multiple preferences.
 *
 * @param {!Object} map A map of name -> value pairs specifying the new default
 *     values.
 */
lib.PreferenceManager.prototype.changeDefaults = function(map) {
  for (const key in map) {
    this.changeDefault(key, map[key]);
  }
};

/**
 * Set a preference to a specific value.
 *
 * This will dispatch the onChange handler if the preference value actually
 * changes.
 *
 * @param {string} name The preference to set.
 * @param {*} newValue The value to set.  Anything that can be represented in
 *     JSON is a valid value.
 * @param {function()=} onComplete Callback when the set call completes.
 * @param {boolean=} saveToStorage Whether to commit the change to the backing
 *     storage or only the in-memory record copy.
 * @return {!Promise<void>} Promise which resolves once all observers are
 *     notified.
 */
lib.PreferenceManager.prototype.set = function(
    name, newValue, onComplete = undefined, saveToStorage = true) {
  const record = this.prefRecords_[name];
  if (!record) {
    throw new Error('Unknown preference: ' + name);
  }

  const oldValue = record.get();

  if (!this.diff(oldValue, newValue)) {
    return Promise.resolve();
  }

  if (this.diff(record.defaultValue, newValue)) {
    record.currentValue = newValue;
    if (saveToStorage) {
      this.storage.setItem(this.prefix + name, newValue).then(onComplete);
    }
  } else {
    record.currentValue = this.DEFAULT_VALUE;
    if (saveToStorage) {
      this.storage.removeItem(this.prefix + name).then(onComplete);
    }
  }

  // We need to manually send out the notification on this instance.  If we
  // The storage event won't fire a notification because we've already changed
  // the currentValue, so it won't see a difference.  If we delayed changing
  // currentValue until the storage event, a pref read immediately after a write
  // would return the previous value.
  //
  // The notification is async so clients don't accidentally depend on
  // a synchronous notification.
  return Promise.resolve().then(() => {
    this.notifyChange_(name);
  });
};

/**
 * Get the value of a preference.
 *
 * @param {string} name The preference to get.
 * @return {*} The preference's value.
 */
lib.PreferenceManager.prototype.get = function(name) {
  const record = this.prefRecords_[name];
  if (!record) {
    throw new Error('Unknown preference: ' + name);
  }

  return record.get();
};

/**
 * Get the default value of a preference.
 *
 * @param {string} name The preference to get.
 * @return {*} The preference's default value.
 */
lib.PreferenceManager.prototype.getDefault = function(name) {
  const record = this.prefRecords_[name];
  if (!record) {
    throw new Error(`Unknown preference: ${name}`);
  }

  return record.defaultValue;
};

/**
 * Get the boolean value of a preference.
 *
 * @param {string} name The preference to get.
 * @return {boolean}
 */
lib.PreferenceManager.prototype.getBoolean = function(name) {
  const result = this.get(name);
  lib.assert(typeof result == 'boolean');
  return result;
};

/**
 * Get the number value of a preference.
 *
 * @param {string} name The preference to get.
 * @return {number}
 */
lib.PreferenceManager.prototype.getNumber = function(name) {
  const result = this.get(name);
  lib.assert(typeof result == 'number');
  return result;
};

/**
 * Get the string value of a preference.
 *
 * @param {string} name The preference to get.
 * @return {string}
 */
lib.PreferenceManager.prototype.getString = function(name) {
  const result = this.get(name);
  lib.assert(typeof result == 'string');
  return result;
};

/**
 * Called when a key in the storage changes.
 *
 * @param {!Object} map Dictionary of changed settings.
 */
lib.PreferenceManager.prototype.onStorageChange_ = function(map) {
  for (const key in map) {
    if (this.prefix) {
      if (key.lastIndexOf(this.prefix, 0) != 0) {
        continue;
      }
    }

    const name = key.substr(this.prefix.length);

    if (!(name in this.prefRecords_)) {
      // Sometimes we'll get notified about prefs that are no longer defined.
      continue;
    }

    const record = this.prefRecords_[name];

    const newValue = map[key].newValue;
    let currentValue = record.currentValue;
    if (currentValue === record.DEFAULT_VALUE) {
      currentValue = undefined;
    }

    if (this.diff(currentValue, newValue)) {
      if (typeof newValue == 'undefined' || newValue === null) {
        record.currentValue = record.DEFAULT_VALUE;
      } else {
        record.currentValue = newValue;
      }

      this.notifyChange_(name);
    }
  }
};
// SOURCE FILE: libdot/js/lib_resource.js
// Copyright (c) 2012 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Storage for canned resources.
 *
 * These are usually non-JavaScript things that are collected during a build
 * step and converted into a series of 'lib.resource.add(...)' calls.  See
 * the "@resource" directive from libdot/bin/concat for the canonical use
 * case.
 *
 * This is global storage, so you should prefix your resource names to avoid
 * collisions.
 */
lib.resource = {
  resources_: {},
};

/** @typedef {{type: string, name: string, data: *}} */
lib.resource.ResourceRecord;

/**
 * Add a resource.
 *
 * @param {string} name A name for the resource.  You should prefix this to
 *     avoid collisions with resources from a shared library.
 * @param {string} type A mime type for the resource, or "raw" if not
 *     applicable.
 * @param {*} data The value of the resource.
 */
lib.resource.add = function(name, type, data) {
  lib.resource.resources_[name] = {
    type: type,
    name: name,
    data: data,
  };
};

/**
 * Retrieve a resource record.
 *
 * The resource data is stored on the "data" property of the returned object.
 *
 * @param {string} name The name of the resource to get.
 * @param {!lib.resource.ResourceRecord=} defaultValue The value to return if
 *     the resource is not defined.
 * @return {!lib.resource.ResourceRecord} The matching resource if it exists.
 */
lib.resource.get = function(name, defaultValue) {
  if (!(name in lib.resource.resources_)) {
    lib.assert(defaultValue !== undefined);
    return defaultValue;
  }

  return lib.resource.resources_[name];
};

/**
 * @param {string} name The name of the resource to get.
 * @return {string} The resource data.
 */
lib.resource.getText = function(name) {
  const resource = lib.resource.resources_[name];
  if (resource === undefined) {
    throw new Error(`Error: Resource "${name}" does not exist`);
  }
  if (!resource.type.startsWith('text/') &&
      !resource.type.startsWith('image/svg')) {
    throw new Error(`Error: Resource "${name}" is not of type string`);
  }

  return String(lib.resource.resources_[name].data);
};

/**
 * Retrieve resource data.
 *
 * @param {string} name The name of the resource to get.
 * @param {*=} defaultValue The value to return if the resource is not defined.
 * @return {*} The resource data.
 */
lib.resource.getData = function(name, defaultValue) {
  if (!(name in lib.resource.resources_)) {
    return defaultValue;
  }

  return lib.resource.resources_[name].data;
};

/**
 * Retrieve resource as a data: url.
 *
 * @param {string} name The name of the resource to get.
 * @param {!lib.resource.ResourceRecord=} defaultValue The value to return if
 *     the resource is not defined.
 * @return {string} A data: url encoded version of the resource.
 */
lib.resource.getDataUrl = function(name, defaultValue) {
  const resource = lib.resource.get(name, defaultValue);
  return 'data:' + resource.type + ',' + resource.data;
};
// SOURCE FILE: libdot/js/lib_storage.js
// Copyright (c) 2012 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Namespace for implementations of persistent, possibly cloud-backed
 * storage.
 *
 * @interface
 */
lib.Storage = function() {};

/**
 * Register a function to observe storage changes.
 *
 * @param {function(!Object<string, !StorageChange>)} callback The function to
 *     invoke when the storage changes.
 */
lib.Storage.prototype.addObserver = function(callback) {};

/**
 * Unregister a change observer.
 *
 * @param {function(!Object<string, !StorageChange>)} callback A previously
 *     registered callback.
 */
lib.Storage.prototype.removeObserver = function(callback) {};

/**
 * Delete everything in this storage.
 */
lib.Storage.prototype.clear = async function() {};

/**
 * Return the current value of a storage item.
 *
 * @param {string} key The key to look up.
 * @return {!Promise<*>} A promise resolving to the requested item.
 */
lib.Storage.prototype.getItem = async function(key) {};

/**
 * Fetch the values of multiple storage items.
 *
 * @param {?Array<string>} keys The keys to look up.  Pass null for all keys.
 * @return {!Promise<!Object<string, *>>} A promise resolving to the requested
 *     items.
 */
lib.Storage.prototype.getItems = async function(keys) {};

/**
 * Set a value in storage.
 *
 * You don't have to wait for the set to complete in order to read the value
 * since the local cache is updated synchronously.
 *
 * @param {string} key The key for the value to be stored.
 * @param {*} value The value to be stored.  Anything that can be serialized
 *     with JSON is acceptable.
 */
lib.Storage.prototype.setItem = async function(key, value) {};

/**
 * Set multiple values in storage.
 *
 * You don't have to wait for the set to complete in order to read the value
 * since the local cache is updated synchronously.
 *
 * @param {!Object} obj A map of key/values to set in storage.
 */
lib.Storage.prototype.setItems = async function(obj) {};

/**
 * Remove an item from storage.
 *
 * @param {string} key The key to be removed.
 */
lib.Storage.prototype.removeItem = async function(key) {};

/**
 * Remove multiple items from storage.
 *
 * @param {!Array<string>} keys The keys to be removed.
 */
lib.Storage.prototype.removeItems = async function(keys) {};

/**
 * Create the set of changes between two states.
 *
 * This is used to synthesize the equivalent of Chrome's StorageEvent for use
 * by our stub APIs and testsuites.  We expect Chrome's StorageEvent to also
 * match the web's Storage API & window.onstorage events.
 *
 * @param {!Object<string, *>} oldStorage The old storage state.
 * @param {!Object<string, *>} newStorage The new storage state.
 * @return {!Object<string, {oldValue: ?, newValue: ?}>} The changes.
 */
lib.Storage.generateStorageChanges = function(oldStorage, newStorage) {
  const changes = {};

  // See what's changed.
  for (const key in newStorage) {
    const newValue = newStorage[key];
    if (oldStorage.hasOwnProperty(key)) {
      // Key has been updated.
      const oldValue = oldStorage[key];
      if (oldValue !== newValue) {
        changes[key] = {oldValue, newValue};
      }
    } else {
      // Key has been added.
      changes[key] = {newValue};
    }
  }

  // See what's deleted.
  for (const key in oldStorage) {
    if (!newStorage.hasOwnProperty(key)) {
      changes[key] = {oldValue: oldStorage[key]};
    }
  }

  return changes;
};
// SOURCE FILE: libdot/js/lib_storage_memory.js
// Copyright (c) 2012 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * In-memory storage class with an async interface that is interchangeable with
 * other lib.Storage.* implementations.
 *
 * @constructor
 * @implements {lib.Storage}
 */
lib.Storage.Memory = function() {
  this.observers_ = [];
  this.storage_ = {};
};

/**
 * Register a function to observe storage changes.
 *
 * @param {function(!Object)} callback The function to invoke when the storage
 *     changes.
 * @override
 */
lib.Storage.Memory.prototype.addObserver = function(callback) {
  this.observers_.push(callback);
};

/**
 * Unregister a change observer.
 *
 * @param {function(!Object)} callback A previously registered callback.
 * @override
 */
lib.Storage.Memory.prototype.removeObserver = function(callback) {
  const i = this.observers_.indexOf(callback);
  if (i != -1) {
    this.observers_.splice(i, 1);
  }
};

/**
 * Update the internal storage state and generate change events for it.
 *
 * @param {!Object<string, *>} newStorage
 */
lib.Storage.Memory.prototype.update_ = async function(newStorage) {
  const changes = lib.Storage.generateStorageChanges(this.storage_, newStorage);
  this.storage_ = newStorage;

  // Force deferment for the standard API.
  await 0;

  // Don't bother notifying if there are no changes.
  if (Object.keys(changes).length) {
    this.observers_.forEach((o) => o(changes));
  }
};

/**
 * Delete everything in this storage.
 *
 * @override
 */
lib.Storage.Memory.prototype.clear = async function() {
  return this.update_({});
};

/**
 * Return the current value of a storage item.
 *
 * @param {string} key The key to look up.
 * @override
 */
lib.Storage.Memory.prototype.getItem = async function(key) {
  return this.getItems([key]).then((items) => items[key]);
};

/**
 * Fetch the values of multiple storage items.
 *
 * @param {?Array<string>} keys The keys to look up.  Pass null for all keys.
 * @override
 */
lib.Storage.Memory.prototype.getItems = async function(keys) {
  const rv = {};
  if (!keys) {
    keys = Object.keys(this.storage_);
  }

  keys.forEach((key) => {
    if (this.storage_.hasOwnProperty(key)) {
      rv[key] = this.storage_[key];
    }
  });

  // Force deferment for the standard API.
  await 0;

  return rv;
};

/**
 * Set a value in storage.
 *
 * @param {string} key The key for the value to be stored.
 * @param {*} value The value to be stored.  Anything that can be serialized
 *     with JSON is acceptable.
 * @override
 */
lib.Storage.Memory.prototype.setItem = async function(key, value) {
  return this.setItems({[key]: value});
};

/**
 * Set multiple values in storage.
 *
 * @param {!Object} obj A map of key/values to set in storage.
 * @override
 */
lib.Storage.Memory.prototype.setItems = async function(obj) {
  const newStorage = Object.assign({}, this.storage_);
  for (const key in obj) {
    // Normalize through JSON to mimic Local/Chrome backends.
    newStorage[key] = JSON.parse(JSON.stringify(obj[key]));
  }
  return this.update_(newStorage);
};

/**
 * Remove an item from storage.
 *
 * @param {string} key The key to be removed.
 * @override
 */
lib.Storage.Memory.prototype.removeItem = async function(key) {
  return this.removeItems([key]);
};

/**
 * Remove multiple items from storage.
 *
 * @param {!Array<string>} keys The keys to be removed.
 * @override
 */
lib.Storage.Memory.prototype.removeItems = async function(keys) {
  const newStorage = Object.assign({}, this.storage_);
  keys.forEach((key) => delete newStorage[key]);
  return this.update_(newStorage);
};
// SOURCE FILE: libdot/third_party/intl-segmenter/intl-segmenter.js
// Rough polyfill for Intl.Segmenter proposal
//
// https://github.com/tc39/proposal-intl-segmenter/blob/HEAD/README.md
//
// Caveats and Limitations
//  * granularity: 'line': 'strictness' option is not supported (ignored)
//  * In Chrome, uses v8BreakIterator
//  * Otherwise, uses very simplistic rules
//    * Ignores locale; only "usable" on English
//    * granularity: 'grapheme' does not understand combining characters
//    * granularity: 'sentence' does not understand decimals

(function(global) {
  if ('Intl' in global && 'Segmenter' in global.Intl) {
    return;
  }

  global.Intl = global.Intl || {};

  const GRANULARITIES = ['grapheme', 'word', 'sentence', 'line'];

  // TODO: Implement https://www.unicode.org/reports/tr29/
  const RULES = {
    grapheme: {
      grapheme: /^(.|\n)/,
    },
    word: {
      letter: /^[a-z](?:'?[a-z])*/i,
      number: /^\d+([,.]\d+)*/,
    },
    sentence: {
      terminator: /^[^.?!\r\n]+[.?!]+[\r\n]?/,
      separator: /^[^.?!\r\n]+[\r\n]?/,
    },
    line: {
      hard: /^\S*[\r\n]/,
      soft: /^\S*\s*/,
    },
  };

  // Work around bug in v8BreakIterator where ICU's UWordBreak enum is
  // used even if granularity is not "word". See the code in
  // Runtime_BreakIteratorBreakType in runtime/runtime-i18n.cc for
  // details.
  function fixBreakType(value, granularity) {
    // Undo the mapping of UWordBreak to string
    const ruleStatus = {
      none: 0, // UBRK_WORD_NONE
      number: 100, // UBRK_WORD_NUMBER
      letter: 200, // UBRK_WORD_LETTER
      kana: 300, // UBRK_WORD_KANA
      ideo: 400, // UBRK_WORD_IDEO
      unknown: -1,
    }[value] || 0;


    switch (granularity) {
    case 'character':
      return undefined;
    case 'word':
      return value;
    case 'sentence':
      // Map ULineBreakTag rule status to string.
      return {
        0: 'terminator',
        100: 'separator',
      }[ruleStatus] || value;
    case 'line':
      // Map ULineBreakTag rule status to string.
      return {
        0: 'soft',
        100: 'hard',
      }[ruleStatus] || value;
    default:
      return value;
    }
  }

  function segment(locale, granularity, string) {
    const breaks = [];
    if ('v8BreakIterator' in global.Intl) {
      if (granularity === 'grapheme') {
        granularity = 'character';
      }
      const vbi = new global.Intl.v8BreakIterator(locale, {type: granularity});
      vbi.adoptText(string);
      let last = 0;
      let pos = vbi.next();
      while (pos !== -1) {
        breaks.push({
          pos: vbi.current(),
          segment: string.slice(last, pos),
          breakType: fixBreakType(vbi.breakType(), granularity),
        });
        last = pos;
        pos = vbi.next();
      }
    } else {
      const rules = RULES[granularity];
      let pos = 0;
      while (pos < string.length) {
        let found = false;
        for (const rule of Object.keys(rules)) {
          const re = rules[rule];
          const m = string.slice(pos).match(re);
          if (m) {
            pos += m[0].length;
            breaks.push({
              pos: pos,
              segment: m[0],
              breakType: granularity === 'grapheme' ? undefined : rule,
            });
            found = true;
            break;
          }
        }
        if (!found) {
          breaks.push({
            pos: pos + 1,
            segment: string.slice(pos, ++pos),
            breakType: 'none',
          });
        }
      }
    }
    return breaks;
  }

  class $SegmentIterator$ {
    constructor(string, breaks) {
      this._cur = -1;
      this._type = undefined;
      this._breaks = breaks;
    }

    [Symbol.iterator]() {
      return this;
    }

    next() {
      if (this._cur < this._breaks.length) {
        ++this._cur;
      }

      if (this._cur >= this._breaks.length) {
        this._type = undefined;
        return {done: true, value: undefined};
      }

      this._type = this._breaks[this._cur].breakType;
      return {
        done: false,
        value: {
          segment: this._breaks[this._cur].segment,
          breakType: this._breaks[this._cur].breakType,
        },
      };
    }

    following(index = undefined) {
      if (!this._breaks.length) {
        return true;
      }
      if (index === undefined) {
        if (this._cur < this._breaks.length) {
          ++this._cur;
        }
      } else {
        // TODO: binary search
        for (this._cur = 0;
             this._cur < this._breaks.length
             && this._breaks[this._cur].pos < index;
             ++this._cur) { /* TODO */ }
      }

      this._type = this._cur < this._breaks.length
        ? this._breaks[this._cur].breakType : undefined;
      return this._cur + 1 >= this._breaks.length;
    }

    preceding(index = undefined) {
      if (!this._breaks.length) {
        return true;
      }
      if (index === undefined) {
        if (this._cur >= this._breaks.length) {
          --this._cur;
        }
        if (this._cur >= 0) {
          --this._cur;
        }
      } else {
        // TODO: binary search
        for (this._cur = this._breaks.length - 1;
             this._cur >= 0
             && this._breaks[this._cur].pos >= index;
             --this._cur) { /* TODO */ }
      }

      this._type =
        this._cur + 1 >= this._breaks.length ? undefined :
        this._breaks[this._cur + 1].breakType;
      return this._cur < 0;
    }

    get position() {
      if (this._cur < 0 || !this._breaks.length) {
        return 0;
      }
      if (this._cur >= this._breaks.length) {
        return this._breaks[this._breaks.length - 1].pos;
      }
      return this._breaks[this._cur].pos;
    }

    get breakType() {
      return this._type;
    }
  }

  global.Intl.Segmenter = class Segmenter {
    constructor(locale, {localeMatcher, granularity = 'grapheme'} = {}) {
      this._locale = Array.isArray(locale)
        ? locale.map((s) => String(s)) : String(locale || navigator.language);
      this._granularity = GRANULARITIES.includes(granularity)
        ? granularity : 'grapheme';
    }

    segment(string) {
      return new $SegmentIterator$(
        string, segment(this._locale, this._granularity, string));
    }
  };
}(typeof window !== 'undefined' ?
      window :
      (typeof global !== 'undefined' ? global : this)));
// SOURCE FILE: libdot/third_party/wcwidth/lib_wc.js
// Copyright (c) 2014 The Chromium OS Authors. All rights reserved.
// Use of lib.wc source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @fileoverview
 * This JavaScript library is ported from the wcwidth.js module of node.js.
 * The original implementation can be found at:
 * https://npmjs.org/package/wcwidth.js
 */

/**
 * JavaScript porting of Markus Kuhn's wcwidth() implementation
 *
 * The following explanation comes from the original C implementation:
 *
 * This is an implementation of wcwidth() and wcswidth() (defined in
 * IEEE Std 1002.1-2001) for Unicode.
 *
 * https://www.opengroup.org/onlinepubs/007904975/functions/wcwidth.html
 * https://www.opengroup.org/onlinepubs/007904975/functions/wcswidth.html
 *
 * In fixed-width output devices, Latin characters all occupy a single
 * "cell" position of equal width, whereas ideographic CJK characters
 * occupy two such cells. Interoperability between terminal-line
 * applications and (teletype-style) character terminals using the
 * UTF-8 encoding requires agreement on which character should advance
 * the cursor by how many cell positions. No established formal
 * standards exist at present on which Unicode character shall occupy
 * how many cell positions on character terminals. These routines are
 * a first attempt of defining such behavior based on simple rules
 * applied to data provided by the Unicode Consortium.
 *
 * For some graphical characters, the Unicode standard explicitly
 * defines a character-cell width via the definition of the East Asian
 * FullWidth (F), Wide (W), Half-width (H), and Narrow (Na) classes.
 * In all these cases, there is no ambiguity about which width a
 * terminal shall use. For characters in the East Asian Ambiguous (A)
 * class, the width choice depends purely on a preference of backward
 * compatibility with either historic CJK or Western practice.
 * Choosing single-width for these characters is easy to justify as
 * the appropriate long-term solution, as the CJK practice of
 * displaying these characters as double-width comes from historic
 * implementation simplicity (8-bit encoded characters were displayed
 * single-width and 16-bit ones double-width, even for Greek,
 * Cyrillic, etc.) and not any typographic considerations.
 *
 * Much less clear is the choice of width for the Not East Asian
 * (Neutral) class. Existing practice does not dictate a width for any
 * of these characters. It would nevertheless make sense
 * typographically to allocate two character cells to characters such
 * as for instance EM SPACE or VOLUME INTEGRAL, which cannot be
 * represented adequately with a single-width glyph. The following
 * routines at present merely assign a single-cell width to all
 * neutral characters, in the interest of simplicity. This is not
 * entirely satisfactory and should be reconsidered before
 * establishing a formal standard in lib.wc area. At the moment, the
 * decision which Not East Asian (Neutral) characters should be
 * represented by double-width glyphs cannot yet be answered by
 * applying a simple rule from the Unicode database content. Setting
 * up a proper standard for the behavior of UTF-8 character terminals
 * will require a careful analysis not only of each Unicode character,
 * but also of each presentation form, something the author of these
 * routines has avoided to do so far.
 *
 * https://www.unicode.org/unicode/reports/tr11/
 *
 * Markus Kuhn -- 2007-05-26 (Unicode 5.0)
 *
 * Permission to use, copy, modify, and distribute lib.wc software
 * for any purpose and without fee is hereby granted. The author
 * disclaims all warranties with regard to lib.wc software.
 *
 * Latest version: https://www.cl.cam.ac.uk/~mgk25/ucs/wcwidth.c
 */

/**
 * The following function defines the column width of an ISO 10646 character
 * as follows:
 *
 *  - The null character (U+0000) has a column width of 0.
 *  - Other C0/C1 control characters and DEL will lead to a return value of -1.
 *  - Non-spacing and enclosing combining characters (general category code Mn
 *    or Me in the Unicode database) have a column width of 0.
 *  - SOFT HYPHEN (U+00AD) has a column width of 1.
 *  - Other format characters (general category code Cf in the Unicode database)
 *    and ZERO WIDTH SPACE (U+200B) have a column width of 0.
 *  - Hangul Jamo medial vowels and final consonants (U+1160-U+11FF) have a
 *    column width of 0.
 *  - Spacing characters in the East Asian Wide (W) or East Asian Full-width (F)
 *    category as defined in Unicode Technical Report #11 have a column width of
 *    2.
 *  - East Asian Ambiguous characters are taken into account if
 *    regardCjkAmbiguous flag is enabled. They have a column width of 2.
 *  - All remaining characters (including all printable ISO 8859-1 and WGL4
 *    characters, Unicode control characters, etc.) have a column width of 1.
 *
 * This implementation assumes that characters are encoded in ISO 10646.
 */

lib.wc = {};

// Width of a nul character.
lib.wc.nulWidth = 0;

// Width of a control character.
lib.wc.controlWidth = 0;

// Flag whether to consider East Asian Ambiguous characters.
lib.wc.regardCjkAmbiguous = false;

// Width of an East Asian Ambiguous character.
lib.wc.cjkAmbiguousWidth = 2;

// Sorted list of non-overlapping intervals of non-spacing characters
// generated by the `./ranges.py` helper.
lib.wc.combining = [
  [0x00ad, 0x00ad], [0x0300, 0x036f], [0x0483, 0x0489],
  [0x0591, 0x05bd], [0x05bf, 0x05bf], [0x05c1, 0x05c2],
  [0x05c4, 0x05c5], [0x05c7, 0x05c7], [0x0610, 0x061a],
  [0x061c, 0x061c], [0x064b, 0x065f], [0x0670, 0x0670],
  [0x06d6, 0x06dc], [0x06df, 0x06e4], [0x06e7, 0x06e8],
  [0x06ea, 0x06ed], [0x0711, 0x0711], [0x0730, 0x074a],
  [0x07a6, 0x07b0], [0x07eb, 0x07f3], [0x07fd, 0x07fd],
  [0x0816, 0x0819], [0x081b, 0x0823], [0x0825, 0x0827],
  [0x0829, 0x082d], [0x0859, 0x085b], [0x0898, 0x089f],
  [0x08ca, 0x08e1], [0x08e3, 0x0902], [0x093a, 0x093a],
  [0x093c, 0x093c], [0x0941, 0x0948], [0x094d, 0x094d],
  [0x0951, 0x0957], [0x0962, 0x0963], [0x0981, 0x0981],
  [0x09bc, 0x09bc], [0x09c1, 0x09c4], [0x09cd, 0x09cd],
  [0x09e2, 0x09e3], [0x09fe, 0x09fe], [0x0a01, 0x0a02],
  [0x0a3c, 0x0a3c], [0x0a41, 0x0a42], [0x0a47, 0x0a48],
  [0x0a4b, 0x0a4d], [0x0a51, 0x0a51], [0x0a70, 0x0a71],
  [0x0a75, 0x0a75], [0x0a81, 0x0a82], [0x0abc, 0x0abc],
  [0x0ac1, 0x0ac5], [0x0ac7, 0x0ac8], [0x0acd, 0x0acd],
  [0x0ae2, 0x0ae3], [0x0afa, 0x0aff], [0x0b01, 0x0b01],
  [0x0b3c, 0x0b3c], [0x0b3f, 0x0b3f], [0x0b41, 0x0b44],
  [0x0b4d, 0x0b4d], [0x0b55, 0x0b56], [0x0b62, 0x0b63],
  [0x0b82, 0x0b82], [0x0bc0, 0x0bc0], [0x0bcd, 0x0bcd],
  [0x0c00, 0x0c00], [0x0c04, 0x0c04], [0x0c3c, 0x0c3c],
  [0x0c3e, 0x0c40], [0x0c46, 0x0c48], [0x0c4a, 0x0c4d],
  [0x0c55, 0x0c56], [0x0c62, 0x0c63], [0x0c81, 0x0c81],
  [0x0cbc, 0x0cbc], [0x0cbf, 0x0cbf], [0x0cc6, 0x0cc6],
  [0x0ccc, 0x0ccd], [0x0ce2, 0x0ce3], [0x0d00, 0x0d01],
  [0x0d3b, 0x0d3c], [0x0d41, 0x0d44], [0x0d4d, 0x0d4d],
  [0x0d62, 0x0d63], [0x0d81, 0x0d81], [0x0dca, 0x0dca],
  [0x0dd2, 0x0dd4], [0x0dd6, 0x0dd6], [0x0e31, 0x0e31],
  [0x0e34, 0x0e3a], [0x0e47, 0x0e4e], [0x0eb1, 0x0eb1],
  [0x0eb4, 0x0ebc], [0x0ec8, 0x0ecd], [0x0f18, 0x0f19],
  [0x0f35, 0x0f35], [0x0f37, 0x0f37], [0x0f39, 0x0f39],
  [0x0f71, 0x0f7e], [0x0f80, 0x0f84], [0x0f86, 0x0f87],
  [0x0f8d, 0x0f97], [0x0f99, 0x0fbc], [0x0fc6, 0x0fc6],
  [0x102d, 0x1030], [0x1032, 0x1037], [0x1039, 0x103a],
  [0x103d, 0x103e], [0x1058, 0x1059], [0x105e, 0x1060],
  [0x1071, 0x1074], [0x1082, 0x1082], [0x1085, 0x1086],
  [0x108d, 0x108d], [0x109d, 0x109d], [0x1160, 0x11ff],
  [0x135d, 0x135f], [0x1712, 0x1714], [0x1732, 0x1733],
  [0x1752, 0x1753], [0x1772, 0x1773], [0x17b4, 0x17b5],
  [0x17b7, 0x17bd], [0x17c6, 0x17c6], [0x17c9, 0x17d3],
  [0x17dd, 0x17dd], [0x180b, 0x180f], [0x1885, 0x1886],
  [0x18a9, 0x18a9], [0x1920, 0x1922], [0x1927, 0x1928],
  [0x1932, 0x1932], [0x1939, 0x193b], [0x1a17, 0x1a18],
  [0x1a1b, 0x1a1b], [0x1a56, 0x1a56], [0x1a58, 0x1a5e],
  [0x1a60, 0x1a60], [0x1a62, 0x1a62], [0x1a65, 0x1a6c],
  [0x1a73, 0x1a7c], [0x1a7f, 0x1a7f], [0x1ab0, 0x1ace],
  [0x1b00, 0x1b03], [0x1b34, 0x1b34], [0x1b36, 0x1b3a],
  [0x1b3c, 0x1b3c], [0x1b42, 0x1b42], [0x1b6b, 0x1b73],
  [0x1b80, 0x1b81], [0x1ba2, 0x1ba5], [0x1ba8, 0x1ba9],
  [0x1bab, 0x1bad], [0x1be6, 0x1be6], [0x1be8, 0x1be9],
  [0x1bed, 0x1bed], [0x1bef, 0x1bf1], [0x1c2c, 0x1c33],
  [0x1c36, 0x1c37], [0x1cd0, 0x1cd2], [0x1cd4, 0x1ce0],
  [0x1ce2, 0x1ce8], [0x1ced, 0x1ced], [0x1cf4, 0x1cf4],
  [0x1cf8, 0x1cf9], [0x1dc0, 0x1dff], [0x200b, 0x200f],
  [0x202a, 0x202e], [0x2060, 0x2064], [0x2066, 0x206f],
  [0x20d0, 0x20f0], [0x2cef, 0x2cf1], [0x2d7f, 0x2d7f],
  [0x2de0, 0x2dff], [0x302a, 0x302d], [0x3099, 0x309a],
  [0xa66f, 0xa672], [0xa674, 0xa67d], [0xa69e, 0xa69f],
  [0xa6f0, 0xa6f1], [0xa802, 0xa802], [0xa806, 0xa806],
  [0xa80b, 0xa80b], [0xa825, 0xa826], [0xa82c, 0xa82c],
  [0xa8c4, 0xa8c5], [0xa8e0, 0xa8f1], [0xa8ff, 0xa8ff],
  [0xa926, 0xa92d], [0xa947, 0xa951], [0xa980, 0xa982],
  [0xa9b3, 0xa9b3], [0xa9b6, 0xa9b9], [0xa9bc, 0xa9bd],
  [0xa9e5, 0xa9e5], [0xaa29, 0xaa2e], [0xaa31, 0xaa32],
  [0xaa35, 0xaa36], [0xaa43, 0xaa43], [0xaa4c, 0xaa4c],
  [0xaa7c, 0xaa7c], [0xaab0, 0xaab0], [0xaab2, 0xaab4],
  [0xaab7, 0xaab8], [0xaabe, 0xaabf], [0xaac1, 0xaac1],
  [0xaaec, 0xaaed], [0xaaf6, 0xaaf6], [0xabe5, 0xabe5],
  [0xabe8, 0xabe8], [0xabed, 0xabed], [0xfb1e, 0xfb1e],
  [0xfe00, 0xfe0f], [0xfe20, 0xfe2f], [0xfeff, 0xfeff],
  [0xfff9, 0xfffb], [0x101fd, 0x101fd], [0x102e0, 0x102e0],
  [0x10376, 0x1037a], [0x10a01, 0x10a03], [0x10a05, 0x10a06],
  [0x10a0c, 0x10a0f], [0x10a38, 0x10a3a], [0x10a3f, 0x10a3f],
  [0x10ae5, 0x10ae6], [0x10d24, 0x10d27], [0x10eab, 0x10eac],
  [0x10f46, 0x10f50], [0x10f82, 0x10f85], [0x11001, 0x11001],
  [0x11038, 0x11046], [0x11070, 0x11070], [0x11073, 0x11074],
  [0x1107f, 0x11081], [0x110b3, 0x110b6], [0x110b9, 0x110ba],
  [0x110c2, 0x110c2], [0x11100, 0x11102], [0x11127, 0x1112b],
  [0x1112d, 0x11134], [0x11173, 0x11173], [0x11180, 0x11181],
  [0x111b6, 0x111be], [0x111c9, 0x111cc], [0x111cf, 0x111cf],
  [0x1122f, 0x11231], [0x11234, 0x11234], [0x11236, 0x11237],
  [0x1123e, 0x1123e], [0x112df, 0x112df], [0x112e3, 0x112ea],
  [0x11300, 0x11301], [0x1133b, 0x1133c], [0x11340, 0x11340],
  [0x11366, 0x1136c], [0x11370, 0x11374], [0x11438, 0x1143f],
  [0x11442, 0x11444], [0x11446, 0x11446], [0x1145e, 0x1145e],
  [0x114b3, 0x114b8], [0x114ba, 0x114ba], [0x114bf, 0x114c0],
  [0x114c2, 0x114c3], [0x115b2, 0x115b5], [0x115bc, 0x115bd],
  [0x115bf, 0x115c0], [0x115dc, 0x115dd], [0x11633, 0x1163a],
  [0x1163d, 0x1163d], [0x1163f, 0x11640], [0x116ab, 0x116ab],
  [0x116ad, 0x116ad], [0x116b0, 0x116b5], [0x116b7, 0x116b7],
  [0x1171d, 0x1171f], [0x11722, 0x11725], [0x11727, 0x1172b],
  [0x1182f, 0x11837], [0x11839, 0x1183a], [0x1193b, 0x1193c],
  [0x1193e, 0x1193e], [0x11943, 0x11943], [0x119d4, 0x119d7],
  [0x119da, 0x119db], [0x119e0, 0x119e0], [0x11a01, 0x11a0a],
  [0x11a33, 0x11a38], [0x11a3b, 0x11a3e], [0x11a47, 0x11a47],
  [0x11a51, 0x11a56], [0x11a59, 0x11a5b], [0x11a8a, 0x11a96],
  [0x11a98, 0x11a99], [0x11c30, 0x11c36], [0x11c38, 0x11c3d],
  [0x11c3f, 0x11c3f], [0x11c92, 0x11ca7], [0x11caa, 0x11cb0],
  [0x11cb2, 0x11cb3], [0x11cb5, 0x11cb6], [0x11d31, 0x11d36],
  [0x11d3a, 0x11d3a], [0x11d3c, 0x11d3d], [0x11d3f, 0x11d45],
  [0x11d47, 0x11d47], [0x11d90, 0x11d91], [0x11d95, 0x11d95],
  [0x11d97, 0x11d97], [0x11ef3, 0x11ef4], [0x13430, 0x13438],
  [0x16af0, 0x16af4], [0x16b30, 0x16b36], [0x16f4f, 0x16f4f],
  [0x16f8f, 0x16f92], [0x16fe4, 0x16fe4], [0x1bc9d, 0x1bc9e],
  [0x1bca0, 0x1bca3], [0x1cf00, 0x1cf2d], [0x1cf30, 0x1cf46],
  [0x1d167, 0x1d169], [0x1d173, 0x1d182], [0x1d185, 0x1d18b],
  [0x1d1aa, 0x1d1ad], [0x1d242, 0x1d244], [0x1da00, 0x1da36],
  [0x1da3b, 0x1da6c], [0x1da75, 0x1da75], [0x1da84, 0x1da84],
  [0x1da9b, 0x1da9f], [0x1daa1, 0x1daaf], [0x1e000, 0x1e006],
  [0x1e008, 0x1e018], [0x1e01b, 0x1e021], [0x1e023, 0x1e024],
  [0x1e026, 0x1e02a], [0x1e130, 0x1e136], [0x1e2ae, 0x1e2ae],
  [0x1e2ec, 0x1e2ef], [0x1e8d0, 0x1e8d6], [0x1e944, 0x1e94a],
  [0xe0001, 0xe0001], [0xe0020, 0xe007f], [0xe0100, 0xe01ef],
];

// Sorted list of non-overlapping intervals of East Asian Ambiguous characters
// generated by the `./ranges.py` helper.
lib.wc.ambiguous = [
  [0x00a1, 0x00a1], [0x00a4, 0x00a4], [0x00a7, 0x00a8],
  [0x00aa, 0x00aa], [0x00ad, 0x00ae], [0x00b0, 0x00b4],
  [0x00b6, 0x00ba], [0x00bc, 0x00bf], [0x00c6, 0x00c6],
  [0x00d0, 0x00d0], [0x00d7, 0x00d8], [0x00de, 0x00e1],
  [0x00e6, 0x00e6], [0x00e8, 0x00ea], [0x00ec, 0x00ed],
  [0x00f0, 0x00f0], [0x00f2, 0x00f3], [0x00f7, 0x00fa],
  [0x00fc, 0x00fc], [0x00fe, 0x00fe], [0x0101, 0x0101],
  [0x0111, 0x0111], [0x0113, 0x0113], [0x011b, 0x011b],
  [0x0126, 0x0127], [0x012b, 0x012b], [0x0131, 0x0133],
  [0x0138, 0x0138], [0x013f, 0x0142], [0x0144, 0x0144],
  [0x0148, 0x014b], [0x014d, 0x014d], [0x0152, 0x0153],
  [0x0166, 0x0167], [0x016b, 0x016b], [0x01ce, 0x01ce],
  [0x01d0, 0x01d0], [0x01d2, 0x01d2], [0x01d4, 0x01d4],
  [0x01d6, 0x01d6], [0x01d8, 0x01d8], [0x01da, 0x01da],
  [0x01dc, 0x01dc], [0x0251, 0x0251], [0x0261, 0x0261],
  [0x02c4, 0x02c4], [0x02c7, 0x02c7], [0x02c9, 0x02cb],
  [0x02cd, 0x02cd], [0x02d0, 0x02d0], [0x02d8, 0x02db],
  [0x02dd, 0x02dd], [0x02df, 0x02df], [0x0300, 0x036f],
  [0x0391, 0x03a1], [0x03a3, 0x03a9], [0x03b1, 0x03c1],
  [0x03c3, 0x03c9], [0x0401, 0x0401], [0x0410, 0x044f],
  [0x0451, 0x0451], [0x1100, 0x115f], [0x2010, 0x2010],
  [0x2013, 0x2016], [0x2018, 0x2019], [0x201c, 0x201d],
  [0x2020, 0x2022], [0x2024, 0x2027], [0x2030, 0x2030],
  [0x2032, 0x2033], [0x2035, 0x2035], [0x203b, 0x203b],
  [0x203e, 0x203e], [0x2074, 0x2074], [0x207f, 0x207f],
  [0x2081, 0x2084], [0x20ac, 0x20ac], [0x2103, 0x2103],
  [0x2105, 0x2105], [0x2109, 0x2109], [0x2113, 0x2113],
  [0x2116, 0x2116], [0x2121, 0x2122], [0x2126, 0x2126],
  [0x212b, 0x212b], [0x2153, 0x2154], [0x215b, 0x215e],
  [0x2160, 0x216b], [0x2170, 0x2179], [0x2189, 0x2189],
  [0x2190, 0x2199], [0x21b8, 0x21b9], [0x21d2, 0x21d2],
  [0x21d4, 0x21d4], [0x21e7, 0x21e7], [0x2200, 0x2200],
  [0x2202, 0x2203], [0x2207, 0x2208], [0x220b, 0x220b],
  [0x220f, 0x220f], [0x2211, 0x2211], [0x2215, 0x2215],
  [0x221a, 0x221a], [0x221d, 0x2220], [0x2223, 0x2223],
  [0x2225, 0x2225], [0x2227, 0x222c], [0x222e, 0x222e],
  [0x2234, 0x2237], [0x223c, 0x223d], [0x2248, 0x2248],
  [0x224c, 0x224c], [0x2252, 0x2252], [0x2260, 0x2261],
  [0x2264, 0x2267], [0x226a, 0x226b], [0x226e, 0x226f],
  [0x2282, 0x2283], [0x2286, 0x2287], [0x2295, 0x2295],
  [0x2299, 0x2299], [0x22a5, 0x22a5], [0x22bf, 0x22bf],
  [0x2312, 0x2312], [0x231a, 0x231b], [0x2329, 0x232a],
  [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
  [0x2460, 0x24e9], [0x24eb, 0x254b], [0x2550, 0x2573],
  [0x2580, 0x258f], [0x2592, 0x2595], [0x25a0, 0x25a1],
  [0x25a3, 0x25a9], [0x25b2, 0x25b3], [0x25b6, 0x25b7],
  [0x25bc, 0x25bd], [0x25c0, 0x25c1], [0x25c6, 0x25c8],
  [0x25cb, 0x25cb], [0x25ce, 0x25d1], [0x25e2, 0x25e5],
  [0x25ef, 0x25ef], [0x25fd, 0x25fe], [0x2605, 0x2606],
  [0x2609, 0x2609], [0x260e, 0x260f], [0x2614, 0x2615],
  [0x261c, 0x261c], [0x261e, 0x261e], [0x2640, 0x2640],
  [0x2642, 0x2642], [0x2648, 0x2653], [0x2660, 0x2661],
  [0x2663, 0x2665], [0x2667, 0x266a], [0x266c, 0x266d],
  [0x266f, 0x266f], [0x267f, 0x267f], [0x2693, 0x2693],
  [0x269e, 0x269f], [0x26a1, 0x26a1], [0x26aa, 0x26ab],
  [0x26bd, 0x26bf], [0x26c4, 0x26e1], [0x26e3, 0x26e3],
  [0x26e8, 0x26ff], [0x2705, 0x2705], [0x270a, 0x270b],
  [0x2728, 0x2728], [0x273d, 0x273d], [0x274c, 0x274c],
  [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757],
  [0x2776, 0x277f], [0x2795, 0x2797], [0x27b0, 0x27b0],
  [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50],
  [0x2b55, 0x2b59], [0x2e80, 0x2fdf], [0x2ff0, 0x303e],
  [0x3040, 0x4dbf], [0x4e00, 0xa4cf], [0xa960, 0xa97f],
  [0xac00, 0xd7a3], [0xe000, 0xfaff], [0xfe00, 0xfe19],
  [0xfe30, 0xfe6f], [0xff01, 0xff60], [0xffe0, 0xffe6],
  [0xfffd, 0xfffd], [0x16fe0, 0x16fe4], [0x16ff0, 0x16ff1],
  [0x17000, 0x18cd5], [0x18d00, 0x18d08], [0x1aff0, 0x1aff3],
  [0x1aff5, 0x1affb], [0x1affd, 0x1affe], [0x1b000, 0x1b12f],
  [0x1b150, 0x1b152], [0x1b164, 0x1b167], [0x1b170, 0x1b2ff],
  [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f100, 0x1f10a],
  [0x1f110, 0x1f12d], [0x1f130, 0x1f169], [0x1f170, 0x1f1ac],
  [0x1f200, 0x1f202], [0x1f210, 0x1f23b], [0x1f240, 0x1f248],
  [0x1f250, 0x1f251], [0x1f260, 0x1f265], [0x1f300, 0x1f320],
  [0x1f32d, 0x1f335], [0x1f337, 0x1f37c], [0x1f37e, 0x1f393],
  [0x1f3a0, 0x1f3ca], [0x1f3cf, 0x1f3d3], [0x1f3e0, 0x1f3f0],
  [0x1f3f4, 0x1f3f4], [0x1f3f8, 0x1f43e], [0x1f440, 0x1f440],
  [0x1f442, 0x1f4fc], [0x1f4ff, 0x1f53d], [0x1f54b, 0x1f54e],
  [0x1f550, 0x1f567], [0x1f57a, 0x1f57a], [0x1f595, 0x1f596],
  [0x1f5a4, 0x1f5a4], [0x1f5fb, 0x1f64f], [0x1f680, 0x1f6c5],
  [0x1f6cc, 0x1f6cc], [0x1f6d0, 0x1f6d2], [0x1f6d5, 0x1f6d7],
  [0x1f6dd, 0x1f6df], [0x1f6eb, 0x1f6ec], [0x1f6f4, 0x1f6fc],
  [0x1f7e0, 0x1f7eb], [0x1f7f0, 0x1f7f0], [0x1f90c, 0x1f93a],
  [0x1f93c, 0x1f945], [0x1f947, 0x1f9ff], [0x1fa70, 0x1fa74],
  [0x1fa78, 0x1fa7c], [0x1fa80, 0x1fa86], [0x1fa90, 0x1faac],
  [0x1fab0, 0x1faba], [0x1fac0, 0x1fac5], [0x1fad0, 0x1fad9],
  [0x1fae0, 0x1fae7], [0x1faf0, 0x1faf6], [0x20000, 0x2fffd],
  [0x30000, 0x3fffd], [0xe0100, 0xe01ef], [0xf0000, 0xffffd],
  [0x100000, 0x10fffd],
];

// Sorted list of non-overlapping intervals of East Asian Unambiguous characters
// generated by the `./ranges.py` helper.
lib.wc.unambiguous = [
  [0x1100, 0x115f], [0x231a, 0x231b], [0x2329, 0x232a],
  [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
  [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653],
  [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1],
  [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5],
  [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea],
  [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa],
  [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b],
  [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e],
  [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50], [0x2b55, 0x2b55], [0x2e80, 0x2fdf],
  [0x2ff0, 0x303e], [0x3040, 0x3247], [0x3250, 0x4dbf],
  [0x4e00, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe10, 0xfe19], [0xfe30, 0xfe6f],
  [0xff01, 0xff60], [0xffe0, 0xffe6], [0x16fe0, 0x16fe4],
  [0x16ff0, 0x16ff1], [0x17000, 0x18cd5], [0x18d00, 0x18d08],
  [0x1aff0, 0x1aff3], [0x1aff5, 0x1affb], [0x1affd, 0x1affe],
  [0x1b000, 0x1b12f], [0x1b150, 0x1b152], [0x1b164, 0x1b167],
  [0x1b170, 0x1b2ff], [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e], [0x1f191, 0x1f19a], [0x1f200, 0x1f202],
  [0x1f210, 0x1f23b], [0x1f240, 0x1f248], [0x1f250, 0x1f251],
  [0x1f260, 0x1f265], [0x1f300, 0x1f320], [0x1f32d, 0x1f335],
  [0x1f337, 0x1f37c], [0x1f37e, 0x1f393], [0x1f3a0, 0x1f3ca],
  [0x1f3cf, 0x1f3d3], [0x1f3e0, 0x1f3f0], [0x1f3f4, 0x1f3f4],
  [0x1f3f8, 0x1f43e], [0x1f440, 0x1f440], [0x1f442, 0x1f4fc],
  [0x1f4ff, 0x1f53d], [0x1f54b, 0x1f54e], [0x1f550, 0x1f567],
  [0x1f57a, 0x1f57a], [0x1f595, 0x1f596], [0x1f5a4, 0x1f5a4],
  [0x1f5fb, 0x1f64f], [0x1f680, 0x1f6c5], [0x1f6cc, 0x1f6cc],
  [0x1f6d0, 0x1f6d2], [0x1f6d5, 0x1f6d7], [0x1f6dd, 0x1f6df],
  [0x1f6eb, 0x1f6ec], [0x1f6f4, 0x1f6fc], [0x1f7e0, 0x1f7eb],
  [0x1f7f0, 0x1f7f0], [0x1f90c, 0x1f93a], [0x1f93c, 0x1f945],
  [0x1f947, 0x1f9ff], [0x1fa70, 0x1fa74], [0x1fa78, 0x1fa7c],
  [0x1fa80, 0x1fa86], [0x1fa90, 0x1faac], [0x1fab0, 0x1faba],
  [0x1fac0, 0x1fac5], [0x1fad0, 0x1fad9], [0x1fae0, 0x1fae7],
  [0x1faf0, 0x1faf6], [0x20000, 0x2fffd], [0x30000, 0x3fffd],
];

/**
 * Binary search to check if the given unicode character is in the table.
 *
 * @param {number} ucs A unicode character code.
 * @param {!Array<!Array<number>>} table A sorted list of internals to match
 *     against.
 * @return {boolean} True if the given character is in the table.
 */
lib.wc.binaryTableSearch_ = function(ucs, table) {
  let min = 0;
  let max = table.length - 1;
  let mid;

  if (ucs < table[min][0] || ucs > table[max][1]) {
    return false;
  }
  while (max >= min) {
    mid = Math.floor((min + max) / 2);
    if (ucs > table[mid][1]) {
      min = mid + 1;
    } else if (ucs < table[mid][0]) {
      max = mid - 1;
    } else {
      return true;
    }
  }

  return false;
};

/**
 * Binary search to check if the given unicode character is a space character.
 *
 * @param {number} ucs A unicode character code.
 * @return {boolean} True if the given character is a space character; false
 *     otherwise.
 */
lib.wc.isSpace = function(ucs) {
  return lib.wc.binaryTableSearch_(ucs, lib.wc.combining);
};

/**
 * Auxiliary function for checking if the given unicode character is a East
 * Asian Ambiguous character.
 *
 * @param {number} ucs A unicode character code.
 * @return {boolean} True if the given character is a East Asian Ambiguous
 *     character.
 */
lib.wc.isCjkAmbiguous = function(ucs) {
  return lib.wc.binaryTableSearch_(ucs, lib.wc.ambiguous);
};

/**
 * Determine the column width of the given character.
 *
 * @param {number} ucs A unicode character code.
 * @return {number} The column width of the given character.
 */
lib.wc.charWidth = function(ucs) {
  if (lib.wc.regardCjkAmbiguous) {
    return lib.wc.charWidthRegardAmbiguous(ucs);
  } else {
    return lib.wc.charWidthDisregardAmbiguous(ucs);
  }
};

/**
 * Determine the column width of the given character without considering East
 * Asian Ambiguous characters.
 *
 * @param {number} ucs A unicode character code.
 * @return {number} The column width of the given character.
 */
lib.wc.charWidthDisregardAmbiguous = function(ucs) {
  // Optimize for ASCII characters.
  if (ucs < 0x7f) {
    if (ucs >= 0x20) {
      return 1;
    } else if (ucs == 0) {
      return lib.wc.nulWidth;
    } else /* if (ucs < 0x20) */ {
      return lib.wc.controlWidth;
    }
  }

  // Test for 8-bit control characters.
  if (ucs < 0xa0) {
    return lib.wc.controlWidth;
  }

  // Binary search in table of non-spacing characters.
  if (lib.wc.isSpace(ucs)) {
    return 0;
  }

  // Binary search in table of wide characters.
  return lib.wc.binaryTableSearch_(ucs, lib.wc.unambiguous) ? 2 : 1;
};

/**
 * Determine the column width of the given character considering East Asian
 * Ambiguous characters.
 *
 * @param {number} ucs A unicode character code.
 * @return {number} The column width of the given character.
 */
lib.wc.charWidthRegardAmbiguous = function(ucs) {
  if (lib.wc.isCjkAmbiguous(ucs)) {
    return lib.wc.cjkAmbiguousWidth;
  }

  return lib.wc.charWidthDisregardAmbiguous(ucs);
};

/**
 * Determine the column width of the given string.
 *
 * @param {string} str A string.
 * @return {number} The column width of the given string.
 */
lib.wc.strWidth = function(str) {
  let rv = 0;

  for (let i = 0; i < str.length;) {
    const codePoint = str.codePointAt(i);
    const width = lib.wc.charWidth(codePoint);
    if (width < 0) {
      return -1;
    }
    rv += width;
    i += (codePoint <= 0xffff) ? 1 : 2;
  }

  return rv;
};

/**
 * Get the substring at the given column offset of the given column width.
 *
 * @param {string} str The string to get substring from.
 * @param {number} start The starting column offset to get substring.
 * @param {number=} subwidth The column width of the substring.
 * @return {string} The substring.
 */
lib.wc.substr = function(str, start, subwidth = undefined) {
  let startIndex = 0;

  // Fun edge case: Normally we associate zero width codepoints (like combining
  // characters) with the previous codepoint, so we skip any leading ones while
  // including trailing ones.  However, if there are zero width codepoints at
  // the start of the string, and the substring starts at 0, lets include them
  // in the result.  This also makes for a simple optimization for a common
  // request.
  if (start) {
    for (let width = 0; startIndex < str.length;) {
      const codePoint = str.codePointAt(startIndex);
      width += lib.wc.charWidth(codePoint);
      if (width > start) {
        break;
      }
      startIndex += (codePoint <= 0xffff) ? 1 : 2;
    }
  }

  if (subwidth !== undefined) {
    let endIndex = startIndex;
    for (let width = 0; endIndex < str.length;) {
      const codePoint = str.codePointAt(endIndex);
      width += lib.wc.charWidth(codePoint);
      if (width > subwidth) {
        break;
      }
      endIndex += (codePoint <= 0xffff) ? 1 : 2;
    }
    return str.substring(startIndex, endIndex);
  }

  return str.substr(startIndex);
};

/**
 * Get substring at the given start and end column offset.
 *
 * @param {string} str The string to get substring from.
 * @param {number} start The starting column offset.
 * @param {number} end The ending column offset.
 * @return {string} The substring.
 */
lib.wc.substring = function(str, start, end) {
  return lib.wc.substr(str, start, end - start);
};
lib.resource.add('libdot/changelog/version', 'text/plain',
'9.0.0'
);

lib.resource.add('libdot/changelog/date', 'text/plain',
'2022-02-24'
);

// SOURCE FILE: hterm/js/hterm.js
// Copyright (c) 2012 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @fileoverview Declares the hterm.* namespace and some basic shared utilities
 * that are too small to deserve dedicated files.
 */
const hterm = {};

/**
 * The type of window hosting hterm.
 *
 * This is set as part of hterm.init().  The value is invalid until
 * initialization completes.
 */
hterm.windowType = null;

/**
 * The OS we're running under.
 *
 * Used when setting up OS-specific behaviors.
 *
 * This is set as part of hterm.init().  The value is invalid until
 * initialization completes.
 */
hterm.os = null;

/**
 * Text shown in a desktop notification for the terminal
 * bell.  \u226a is a unicode EIGHTH NOTE, %(title) will
 * be replaced by the terminal title.
 */
hterm.desktopNotificationTitle = '\u266A %(title) \u266A';

lib.registerInit(
    'hterm',
    /**
     * The hterm init function, registered with lib.registerInit().
     *
     * This is called during lib.init().
     *
     * @return {!Promise<void>}
     */
    async () => {
      function initMessageManager() {
        return lib.i18n.getAcceptLanguages()
          .then((languages) => {
          })
          .then(() => {
            // If OS detection fails, then we'll still set the value to
            // something.  The OS logic in hterm tends to be best effort
            // anyways.
            const initOs = (os) => { hterm.os = os; };
            return lib.f.getOs().then(initOs).catch(initOs);
          });
      }

      function onWindow(window) {
        hterm.windowType = window.type;
        return initMessageManager();
      }

      function onTab(tab = undefined) {
        if (tab && window.chrome) {
          return new Promise((resolve) => {
            chrome.windows.get(tab.windowId, null, (win) => {
              onWindow(win).then(resolve);
            });
          });
        } else {
          // TODO(rginda): This is where we end up for a v1 app's background
          // page. Maybe windowType = 'none' would be more appropriate, or
          // something.
          hterm.windowType = 'normal';
          return initMessageManager();
        }
      }

      return new Promise((resolve) => {
        if (window.chrome && chrome.tabs) {
          // The getCurrent method gets the tab that is "currently running",
          // not the topmost or focused tab.
          chrome.tabs.getCurrent((tab) => onTab(tab).then(resolve));
        } else {
          onWindow({type: 'normal'}).then(resolve);
        }
      });
    });

/**
 * Sanitizes the given HTML source into a TrustedHTML, or a string if the
 * Trusted Types API is not available.
 *
 * For now, we wrap the given HTML into a TrustedHTML without modifying it.
 *
 * @param {string} html
 * @return {!TrustedHTML|string}
 */
hterm.sanitizeHtml = function(html) {
  if (window?.trustedTypes?.createPolicy) {
    if (!hterm.sanitizeHtml.policy) {
      hterm.sanitizeHtml.policy = trustedTypes.createPolicy('default', {
        createHTML: (source) => source,
      });
    }
    return hterm.sanitizeHtml.policy.createHTML(html);
  }

  return html;
};

function dpifud(s) { return `calc(var(--hterm-dpi-fudge) * ${s}px)`; }

/**
 * Copy the specified text to the system clipboard.
 *
 * We'll create selections on demand based on the content to copy.
 *
 * @param {!Document} document The document with the selection to copy.
 * @param {string} str The string data to copy out.
 * @return {!Promise<void>}
 */
hterm.copySelectionToClipboard = function(document, str) {
  // Request permission if need be.
  const requestPermission = () => {
    // Use the Permissions API if available.
    if (navigator.permissions && navigator.permissions.query) {
      return navigator.permissions.query({name: 'clipboard-write'})
        .then((status) => {
          const checkState = (resolve, reject) => {
            switch (status.state) {
              case 'granted':
                return resolve();
              case 'denied':
                return reject();
              default:
                // Wait for the user to approve/disprove.
                return new Promise((resolve, reject) => {
                  status.onchange = () => checkState(resolve, reject);
                });
            }
          };

          return new Promise(checkState);
        })
        // If the platform doesn't support "clipboard-write", or is denied,
        // we move on to the copying step anyways.
        .catch(() => Promise.resolve());
    } else {
      // No permissions API, so resolve right away.
      return Promise.resolve();
    }
  };

  // Write to the clipboard.
  const writeClipboard = () => {
    // Use the Clipboard API if available.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      // If this fails (perhaps due to focus changing windows), fallback to the
      // legacy copy method.
      return navigator.clipboard.writeText(str)
        .catch(execCommand);
    } else {
      // No Clipboard API, so use the old execCommand style.
      return execCommand();
    }
  };

  // Write to the clipboard using the legacy execCommand method.
  // TODO: Once we can rely on the Clipboard API everywhere, we can simplify
  // this a lot by deleting the custom selection logic.
  const execCommand = () => {
    const copySource = document.createElement('pre');
    copySource.id = 'hterm:copy-to-clipboard-source';
    copySource.textContent = str;
    copySource.style.cssText = (
        'user-select: text;' +
        'position: absolute;' +
        'top: ' + dpifud(-99));

    document.body.appendChild(copySource);

    const selection = document.getSelection();
    const anchorNode = selection.anchorNode;
    const anchorOffset = selection.anchorOffset;
    const focusNode = selection.focusNode;
    const focusOffset = selection.focusOffset;

    // FF sometimes throws NS_ERROR_FAILURE exceptions when we make this call.
    // Catch it because a failure here leaks the copySource node.
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1178676
    try {
      selection.selectAllChildren(copySource);
    } catch (ex) {
      // FF workaround.
    }

    try {
      document.execCommand('copy');
    } catch (firefoxException) {
      // Ignore this. FF throws an exception if there was an error, even
      // though the spec says just return false.
    }

    // IE doesn't support selection.extend.  This means that the selection won't
    // return on IE.
    if (selection.extend) {
      // When running in the test harness, we won't have any related nodes.
      if (anchorNode) {
        selection.collapse(anchorNode, anchorOffset);
      }
      if (focusNode) {
        selection.extend(focusNode, focusOffset);
      }
    }

    copySource.remove();

    // Since execCommand is synchronous, resolve right away.
    return Promise.resolve();
  };

  // Kick it all off!
  return requestPermission().then(writeClipboard);
};

/**
 * Return a formatted message in the current locale.
 *
 * @param {string} name The name of the message to return.
 * @param {!Array<string>=} args The message arguments, if required.
 * @param {string=} string The default message text.
 * @return {string} The localized message.
 */
hterm.msg = function(name, args = [], string = '') {
  return lib.i18n.replaceReferences(string, args);
};

/**
 * Create a new notification.
 *
 * @param {{title:(string|undefined), body:(string|undefined)}=} params Various
 *     parameters for the notification.
 *     title The title (defaults to the window's title).
 *     body The message body (main text).
 * @return {!Notification}
 */
hterm.notify = function(params) {
  const def = (curr, fallback) => curr !== undefined ? curr : fallback;
  if (params === undefined || params === null) {
    params = {};
  }

  // Merge the user's choices with the default settings.  We don't take it
  // directly in case it was stuffed with excess junk.
  const options = {
      'body': params.body,
      'icon': def(params.icon, lib.resource.getDataUrl('hterm/images/icon-96')),
  };

  let title = def(params.title, window.document.title);
  if (!title) {
    title = 'hterm';
  }
  title = lib.f.replaceVars(hterm.desktopNotificationTitle, {'title': title});

  const n = new Notification(title, options);
  n.onclick = function() {
    window.focus();
    n.close();
  };
  return n;
};

/**
 * Launches url in a new tab.
 *
 * @param {string} url URL to launch in a new tab.
 */
hterm.openUrl = function(url) {
  if (window.chrome && chrome.browser && chrome.browser.openTab) {
    // For Chrome v2 apps, we need to use this API to properly open windows.
    chrome.browser.openTab({'url': url});
  } else {
    const win = lib.f.openWindow(url, '_blank');
    if (win) {
      win.focus();
    }
  }
};

/**
 * Constructor for a hterm.RowCol record.
 *
 * Instances of this class have public read/write members for row and column.
 *
 * This class includes an 'overflow' bit which is use to indicate that an
 * attempt has been made to move the cursor column passed the end of the
 * screen.  When this happens we leave the cursor column set to the last column
 * of the screen but set the overflow bit.  In this state cursor movement
 * happens normally, but any attempt to print new characters causes a cr/lf
 * first.
 *
 */
hterm.RowCol = class {
  /**
   * @param {number} row The row of this record.
   * @param {number} column The column of this record.
   * @param {boolean=} overflow Optional boolean indicating that the RowCol
   *     has overflowed.
   */
  constructor(row, column, overflow = false) {
    this.row = row;
    this.column = column;
    this.overflow = !!overflow;
  }

  /**
   * Adjust the row and column of this record.
   *
   * @param {number} row The new row of this record.
   * @param {number} column The new column of this record.
   * @param {boolean=} overflow Optional boolean indicating that the RowCol
   *     has overflowed.
   */
  move(row, column, overflow = false) {
    this.row = row;
    this.column = column;
    this.overflow = !!overflow;
  }

  /**
   * Return a copy of this record.
   *
   * @return {!hterm.RowCol} A new hterm.RowCol instance with the same row and
   *     column.
   */
  clone() {
    return new this.constructor(this.row, this.column, this.overflow);
  }

  /**
   * Set the row and column of this instance based on another hterm.RowCol.
   *
   * @param {!hterm.RowCol} that The object to copy from.
   */
  setTo(that) {
    this.row = that.row;
    this.column = that.column;
    this.overflow = that.overflow;
  }

  /**
   * Test if another hterm.RowCol instance is equal to this one.
   *
   * @param {!hterm.RowCol} that The other hterm.RowCol instance.
   * @return {boolean} True if both instances have the same row/column, false
   *     otherwise.
   */
  equals(that) {
    return (this.row == that.row && this.column == that.column &&
            this.overflow == that.overflow);
  }

  /**
   * Return a string representation of this instance.
   *
   * @return {string} A string that identifies the row and column of this
   *     instance.
   * @override
   */
  toString() {
    return `[hterm.RowCol: ${this.row}, ${this.column}, ${this.overflow}]`;
  }
};
// SOURCE FILE: hterm/js/hterm_accessibility_reader.js
// Copyright 2018 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * AccessibilityReader responsible for rendering command output for AT.
 *
 * Renders command output for Assistive Technology using a live region. We don't
 * use the visible rows of the terminal for rendering command output to the
 * screen reader because the rendered content may be different from what we want
 * read out by a screen reader. For example, we may not actually render every
 * row of a large piece of output to the screen as it wouldn't be performant.
 * But we want the screen reader to read it all out in order.
 *
 * @param {!Element} div The div element where the live region should be
 *     added.
 * @constructor
 */
hterm.AccessibilityReader = function(div) {
  this.document_ = div.ownerDocument;

  // The live region element to add text to.
  const liveRegion = this.document_.createElement('div');
  liveRegion.id = 'hterm:accessibility-live-region';
  liveRegion.style.cssText = `position: absolute;
                              width: 0; height: 0;
                              overflow: hidden;
                              left: -1000px; top: -1000px;`;
  div.appendChild(liveRegion);

  // Whether command output should be rendered for Assistive Technology.
  // This isn't always enabled because it has an impact on performance.
  this.accessibilityEnabled = false;

  // This live element is used for command output.
  this.liveElement_ = this.document_.createElement('p');
  this.liveElement_.setAttribute('aria-live', 'polite');
  liveRegion.appendChild(this.liveElement_);

  // This live element is used for speaking out the current screen when
  // navigating through the scrollback buffer. It will interrupt existing
  // announcements.
  this.assertiveLiveElement_ = this.document_.createElement('p');
  this.assertiveLiveElement_.setAttribute('aria-live', 'assertive');
  liveRegion.appendChild(this.assertiveLiveElement_);

  // A queue of updates to announce.
  this.queue_ = [];

  // A timer which tracks when next to add items to the live region. null when
  // not running. This is used to combine updates that occur in a small window,
  // as well as to avoid too much output being added to the live region in one
  // go which can cause the renderer to hang.
  this.nextReadTimer_ = null;

  // This is set to true if the cursor is about to update position on the
  // screen. i.e. beforeCursorChange has been called but not afterCursorChange.
  this.cursorIsChanging_ = false;

  // This tracks changes that would be added to queue_ while the cursor is
  // changing. This is done so that we can decide to discard these changes if
  // we announce something as a result of the cursor change.
  this.cursorChangeQueue_ = [];

  // The string of text on the row that the cursor was last on. Only valid while
  // cursorIsChanging_ is true.
  this.lastCursorRowString_ = null;

  // The row that the cursor was last on. Only valid while cursorIsChanging_ is
  // true.
  this.lastCursorRow_ = null;

  // The column that the cursor was last on. Only valid while cursorIsChanging_
  // is true.
  this.lastCursorColumn_ = null;

  // True if a keypress has been performed since the last cursor change.
  this.hasUserGesture = false;
};

/**
 * Delay in ms to use for merging strings to output.
 *
 * We merge strings together to avoid hanging the terminal and to ensure that
 * aria updates make it to the screen reader. We want this to be short so
 * there's not a big delay between typing/executing commands and hearing output.
 *
 * @const
 * @type {number}
 */
hterm.AccessibilityReader.DELAY = 50;

/**
 * Enable accessibility-friendly features that have a performance impact.
 *
 * @param {boolean} enabled Whether to enable accessibility-friendly features.
 */
hterm.AccessibilityReader.prototype.setAccessibilityEnabled =
    function(enabled) {
  if (!enabled) {
    this.clear();
  }

  this.accessibilityEnabled = enabled;
};

/**
 * Decorate the document where the terminal <x-screen> resides. This is needed
 * for listening to keystrokes on the screen.
 *
 * @param {!Document} doc The document where the <x-screen> resides.
 */
hterm.AccessibilityReader.prototype.decorate = function(doc) {
  const handlers = ['keydown', 'keypress', 'keyup', 'textInput'];
  handlers.forEach((handler) => {
    doc.addEventListener(handler, () => { this.hasUserGesture = true; });
  });
};

/**
 * This should be called before the cursor on the screen is about to get
 * updated. This allows cursor changes to be tracked and related notifications
 * to be announced.
 *
 * @param {string} cursorRowString The text in the row that the cursor is
 *     currently on.
 * @param {number} cursorRow The index of the row that the cursor is currently
 *     on, including rows in the scrollback buffer.
 * @param {number} cursorColumn The index of the column that the cursor is
 *     currently on.
 */
hterm.AccessibilityReader.prototype.beforeCursorChange =
    function(cursorRowString, cursorRow, cursorColumn) {
  // If accessibility is enabled we don't announce selection changes as these
  // can have a performance impact.
  if (!this.accessibilityEnabled) {
    return;
  }

  // If there is no user gesture that can be tied to the cursor change, we
  // don't want to announce anything.
  if (!this.hasUserGesture || this.cursorIsChanging_) {
    return;
  }

  this.cursorIsChanging_ = true;
  this.lastCursorRowString_ = cursorRowString;
  this.lastCursorRow_ = cursorRow;
  this.lastCursorColumn_ = cursorColumn;
};

/**
 * This should be called after the cursor on the screen has been updated. Note
 * that several updates to the cursor may have happened between
 * beforeCursorChange and afterCursorChange.
 *
 * This allows cursor changes to be tracked and related notifications to be
 * announced.
 *
 * @param {string} cursorRowString The text in the row that the cursor is
 *     currently on.
 * @param {number} cursorRow The index of the row that the cursor is currently
 *     on, including rows in the scrollback buffer.
 * @param {number} cursorColumn The index of the column that the cursor is
 *     currently on.
 */
hterm.AccessibilityReader.prototype.afterCursorChange =
    function(cursorRowString, cursorRow, cursorColumn) {
  // This can happen if clear() is called midway through a cursor change.
  if (!this.cursorIsChanging_) {
    return;
  }
  this.cursorIsChanging_ = false;

  if (!this.announceAction_(cursorRowString, cursorRow, cursorColumn)) {
    // If we don't announce a special action, we re-queue all the output that
    // was queued during the selection change.
    for (let i = 0; i < this.cursorChangeQueue_.length; ++i) {
      this.announce(this.cursorChangeQueue_[i]);
    }
  }

  this.cursorChangeQueue_ = [];
  this.lastCursorRowString_ = null;
  this.lastCursorRow_ = null;
  this.lastCursorColumn_ = null;
  this.hasUserGesture = false;
};

/**
 * Announce the command output.
 *
 * @param {string} str The string to announce using a live region.
 */
hterm.AccessibilityReader.prototype.announce = function(str) {
  if (!this.accessibilityEnabled) {
    return;
  }

  // If the cursor is in the middle of changing, we queue up the output
  // separately as we may not want it to be announced if it's part of a cursor
  // change announcement.
  if (this.cursorIsChanging_) {
    this.cursorChangeQueue_.push(str);
    return;
  }

  // Don't append newlines to the queue if the queue is empty. It won't have any
  // impact.
  if (str == '\n' && this.queue_.length > 0) {
    this.queue_.push('');
    // We don't need to trigger an announcement on newlines because they won't
    // change the existing content that's output.
    return;
  }

  if (this.queue_.length == 0) {
    this.queue_.push(str);
  } else {
    // We put a space between strings that appear on the same line.
    // TODO(raymes): We should check the location on the row and not add a space
    // if the strings are joined together.
    let padding = '';
    if (this.queue_[this.queue_.length - 1].length != 0) {
      padding = ' ';
    }
    this.queue_[this.queue_.length - 1] += padding + str;
  }

  // If we've already scheduled text being added to the live region, wait for it
  // to happen.
  if (this.nextReadTimer_) {
    return;
  }

  // If there's only one item in the queue, we may get other text being added
  // very soon after. In that case, wait a small delay so we can merge the
  // related strings.
  if (this.queue_.length == 1) {
    this.nextReadTimer_ = setTimeout(this.addToLiveRegion_.bind(this),
                                     hterm.AccessibilityReader.DELAY);
  } else {
    throw new Error(
        'Expected only one item in queue_ or nextReadTimer_ to be running.');
  }
};

/**
 * Voice an announcement that will interrupt other announcements.
 *
 * @param {string} str The string to announce using a live region.
 */
hterm.AccessibilityReader.prototype.assertiveAnnounce = function(str) {
  if (this.hasUserGesture && str == ' ') {
    str = hterm.msg('SPACE_CHARACTER', [], 'Space');
  }

  // If the same string is announced twice, an attribute change won't be
  // registered and the screen reader won't know that the string has changed.
  // So we slightly change the string to ensure that the attribute change gets
  // registered.
  str = str.trim();
  if (str == this.assertiveLiveElement_.innerText) {
    str = '\n' + str;
  }

  this.clear();
  this.assertiveLiveElement_.innerText = str;
};

/**
 * Add a newline to the text that will be announced to the live region.
 */
hterm.AccessibilityReader.prototype.newLine = function() {
  this.announce('\n');
};

/**
 * Clear the live region and any in-flight announcements.
 */
hterm.AccessibilityReader.prototype.clear = function() {
  this.liveElement_.innerText = '';
  this.assertiveLiveElement_.innerText = '';
  clearTimeout(this.nextReadTimer_);
  this.nextReadTimer_ = null;
  this.queue_ = [];

  this.cursorIsChanging_ = false;
  this.cursorChangeQueue_ = [];
  this.lastCursorRowString_ = null;
  this.lastCursorRow_ = null;
  this.lastCursorColumn_ = null;
  this.hasUserGesture = false;
};

/**
 * This will announce an action that is related to a cursor change, for example
 * when the user deletes a character we want the character deleted to be
 * announced. Similarly, when the user moves the cursor along the line, we want
 * the characters selected to be announced.
 *
 * Note that this function is a heuristic. Because of the nature of terminal
 * emulators, we can't distinguish input and output, which means we don't really
 * know what output is the result of a keypress and what isn't. Also in some
 * terminal applications certain announcements may make sense whereas others may
 * not. This function should try to account for the most common cases.
 *
 * @param {string} cursorRowString The text in the row that the cursor is
 *     currently on.
 * @param {number} cursorRow The index of the row that the cursor is currently
 *     on, including rows in the scrollback buffer.
 * @param {number} cursorColumn The index of the column that the cursor is
 *     currently on.
 * @return {boolean} Whether anything was announced.
 */
hterm.AccessibilityReader.prototype.announceAction_ =
    function(cursorRowString, cursorRow, cursorColumn) {
  // If the cursor changes rows, we don't announce anything at present.
  if (this.lastCursorRow_ != cursorRow) {
    return false;
  }

  // The case when the row of text hasn't changed at all.
  if (lib.notNull(this.lastCursorRowString_) === cursorRowString) {
    // Moving the cursor along the line. We check that no significant changes
    // have been queued. If they have, it may not just be a cursor movement and
    // it may be better to read those out.
    if (lib.notNull(this.lastCursorColumn_) !== cursorColumn &&
        this.cursorChangeQueue_.join('').trim() == '') {
      // Announce the text between the old cursor position and the new one.
      const start = Math.min(this.lastCursorColumn_, cursorColumn);
      const len = Math.abs(cursorColumn - this.lastCursorColumn_);
      this.assertiveAnnounce(
          lib.wc.substr(this.lastCursorRowString_, start, len));
      return true;
    }
    return false;
  }

  // The case when the row of text has changed.
  if (this.lastCursorRowString_ != cursorRowString) {
    // Spacebar. We manually announce this character since the screen reader may
    // not announce the whitespace in a live region.
    if (this.lastCursorColumn_ + 1 == cursorColumn) {
      if (lib.wc.substr(cursorRowString, cursorColumn - 1, 1) == ' ' &&
          this.cursorChangeQueue_.length > 0 &&
          this.cursorChangeQueue_[0] == ' ') {
        this.assertiveAnnounce(' ');
        return true;
      }
    }

    // Backspace and deletion.
    // The position of the characters deleted is right after the current
    // position of the cursor in the case of backspace and delete.
    const cursorDeleted = cursorColumn;
    // Check that the current row string is shorter than the previous. Also
    // check that the start of the strings (up to the cursor) match.
    if (lib.wc.strWidth(cursorRowString) <=
        lib.wc.strWidth(this.lastCursorRowString_) &&
        lib.wc.substr(this.lastCursorRowString_, 0, cursorDeleted) ==
        lib.wc.substr(cursorRowString, 0, cursorDeleted)) {
      // Find the length of the current row string ignoring space characters.
      // These may be inserted at the end of the string when deleting characters
      // so they should be ignored.
      let lengthOfCurrentRow = lib.wc.strWidth(cursorRowString);
      for (; lengthOfCurrentRow > 0; --lengthOfCurrentRow) {
        if (lengthOfCurrentRow == cursorDeleted ||
            lib.wc.substr(cursorRowString, lengthOfCurrentRow - 1, 1) != ' ') {
          break;
        }
      }

      const numCharsDeleted =
          lib.wc.strWidth(this.lastCursorRowString_) - lengthOfCurrentRow;

      // Check that the end of the strings match.
      const lengthOfEndOfString = lengthOfCurrentRow - cursorDeleted;
      const endOfLastRowString = lib.wc.substr(
          this.lastCursorRowString_, cursorDeleted + numCharsDeleted,
          lengthOfEndOfString);
      const endOfCurrentRowString =
          lib.wc.substr(cursorRowString, cursorDeleted, lengthOfEndOfString);
      if (endOfLastRowString == endOfCurrentRowString) {
        const deleted = lib.wc.substr(
            this.lastCursorRowString_, cursorDeleted, numCharsDeleted);
        if (deleted != '') {
          this.assertiveAnnounce(deleted);
          return true;
        }
      }
    }
    return false;
  }

  return false;
};

/**
 * Add text from queue_ to the live region.
 *
 */
hterm.AccessibilityReader.prototype.addToLiveRegion_ = function() {
  this.nextReadTimer_ = null;

  let str = this.queue_.join('\n').trim();

  // If the same string is announced twice, an attribute change won't be
  // registered and the screen reader won't know that the string has changed.
  // So we slightly change the string to ensure that the attribute change gets
  // registered.
  if (str == this.liveElement_.innerText) {
    str = '\n' + str;
  }

  this.liveElement_.innerText = str;
  this.queue_ = [];
};
// SOURCE FILE: hterm/js/hterm_notifications.js
// Copyright 2020 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @fileoverview A UI for managing user notifications.  It's a distinct UI space
 *     from the terminal itself to help users clearly distinguish between remote
 *     output.  This makes it hard for the remote to spoof the user.
 */

/**
 * Class that controls everything about the notification center.
 */
hterm.NotificationCenter = class {
  /**
   * @param {!Element} parent The node that we will display inside.
   * @param {?hterm.AccessibilityReader=} reader Helper for reading content.
   */
  constructor(parent, reader = undefined) {
    this.parent_ = parent;
    this.reader_ = reader;
    this.container_ = this.newContainer_();
    /** @type {?number} Id for automatic hiding timeout. */
    this.timeout_ = null;
    /** @type {number} Fadeout delay (for tests to control). */
    this.fadeout_ = 200;
  }

  /** @return {!Element} */
  newContainer_() {
    const ele = this.parent_.ownerDocument.createElement('div');
    ele.setAttribute('role', 'dialog');
    ele.style.cssText =
        'color: rgb(var(--hterm-background-color));' +
        'background-color: rgb(var(--hterm-foreground-color));' +
        `border-radius: ${dpifud(12)};` +
        'font: 500 var(--hterm-font-size) "Noto Sans", sans-serif;' +
        'opacity: 0.75;' +
        'padding: 0.923em 1.846em;' +
        'position: absolute;' +
        'user-select: none;' +
        'transition: opacity 180ms ease-in;';

    // Prevent the dialog from gaining focus.
    ele.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopPropagation();
    }, true);

    return ele;
  }

  /**
   * Show a notification for the specified duration.
   *
   * The notification appears in inverse video, centered over the terminal.
   *
   * @param {string|!Node} msg The message to display.
   * @param {{
   *     timeout: (?number|undefined),
   * }=} options
   *     timeout: How long (millisec) to wait before hiding the notification.
   *         Pass null to never autohide.
   */
  show(msg, {timeout = 1500} = {}) {
    const node = typeof msg === 'string' ? new Text(msg) : msg;

    // Hacky heuristic: if we're currently showing a notification w/out a
    // timeout, and the new one includes a timeout, leave the existing one
    // alone.  We should rework this stack a bit to give more power to the
    // callers, but for now, this should be OK.
    if (this.container_.parentNode && this.timeout_ === null &&
        timeout !== null) {
      return;
    }

    // Remove all children first.
    this.container_.textContent = '';
    this.container_.appendChild(node);
    this.container_.style.opacity = '0.75';

    // Display on the page if it isn't already.
    if (!this.container_.parentNode) {
      this.parent_.appendChild(this.container_);
    }

    // Keep the notification centered.
    const size = this.container_.getBoundingClientRect();
    this.container_.style.top = `calc(50% - ${size.height / 2}px)`;
    this.container_.style.left = `calc(50% - ${size.width / 2}px)`;

    if (this.reader_) {
      this.reader_.assertiveAnnounce(this.container_.textContent);
    }

    // Handle automatic hiding of the UI.
    if (this.timeout_) {
      clearTimeout(this.timeout_);
      this.timeout_ = null;
    }
    if (timeout === null) {
      return;
    }
    this.timeout_ = setTimeout(() => {
      this.container_.style.opacity = '0';
      this.timeout_ = setTimeout(() => this.hide(), this.fadeout_);
    }, timeout);
  }

  /**
   * Hide the active notification immediately.
   *
   * Useful when we show a message for an event with an unknown end time.
   */
  hide() {
    if (this.timeout_) {
      clearTimeout(this.timeout_);
      this.timeout_ = null;
    }

    this.container_.remove();
    // Remove all children in case there was sensitive content shown that we
    // don't want to leave laying around.
    this.container_.textContent = '';
  }
};
// SOURCE FILE: hterm/js/hterm_options.js
// Copyright (c) 2012 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * @fileoverview This file implements the hterm.Options class,
 * which stores current operating conditions for the terminal.  This object is
 * used instead of a series of parameters to allow saving/restoring of cursor
 * conditions easily, and to provide an easy place for common configuration
 * options.
 *
 * Original code by Cory Maccarrone.
 */

/**
 * Constructor for the hterm.Options class, optionally acting as a copy
 * constructor.
 *
 * The defaults are as defined in http://www.vt100.net/docs/vt510-rm/DECSTR
 * except that we enable autowrap (wraparound) by default since that seems to
 * be what xterm does.
 *
 * @param {!hterm.Options=} copy Optional instance to copy.
 * @constructor
 */
hterm.Options = function(copy = undefined) {
  // All attributes in this class are public to allow easy access by the
  // terminal.

  this.wraparound = copy ? copy.wraparound : true;
  this.reverseWraparound = copy ? copy.reverseWraparound : false;
  this.originMode = copy ? copy.originMode : false;
  this.autoCarriageReturn = copy ? copy.autoCarriageReturn : false;
  this.cursorBlink = copy ? copy.cursorBlink : false;
  this.insertMode = copy ? copy.insertMode : false;
  this.reverseVideo = copy ? copy.reverseVideo : false;
  this.bracketedPaste = copy ? copy.bracketedPaste : false;
};
// SOURCE FILE: hterm/js/hterm_preference_manager.js
// Copyright (c) 2012 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * PreferenceManager subclass managing global NaSSH preferences.
 *
 * This is currently just an ordered list of known connection profiles.
 *
 * @param {!lib.Storage} storage Where to store preferences.
 * @param {string=} profileId Uses 'default' if not specified.
 * @extends {lib.PreferenceManager}
 * @constructor
 */
hterm.PreferenceManager = function(
    storage, profileId = hterm.Terminal.DEFAULT_PROFILE_ID) {
  lib.PreferenceManager.call(this, storage,
                             hterm.PreferenceManager.prefix_ + profileId);
  Object.entries(hterm.PreferenceManager.defaultPreferences).forEach(
      ([key, entry]) => {
        this.definePreference(key, entry['default']);
      });
};

/**
 * The storage key prefix to namespace the preferences.
 */
hterm.PreferenceManager.prefix_ = '/hterm/profiles/';

/**
 * List all the defined profiles.
 *
 * @param {!lib.Storage} storage Where to look for profiles.
 * @param {function(!Array<string>)} callback Called with the list of profiles.
 */
hterm.PreferenceManager.listProfiles = function(storage, callback) {
  storage.getItems(null).then((items) => {
    const profiles = {};
    for (const key of Object.keys(items)) {
      if (key.startsWith(hterm.PreferenceManager.prefix_)) {
        // Turn "/hterm/profiles/foo/bar/cow" to "foo/bar/cow".
        const subKey = key.slice(hterm.PreferenceManager.prefix_.length);
        // Turn "foo/bar/cow" into "foo".
        profiles[subKey.split('/', 1)[0]] = true;
      }
    }
    callback(Object.keys(profiles));
  });
};

/** @enum {string} */
hterm.PreferenceManager.Categories = {
  Keyboard: 'Keyboard',
  Appearance: 'Appearance',
  CopyPaste: 'CopyPaste',
  Sounds: 'Sounds',
  Scrolling: 'Scrolling',
  Encoding: 'Encoding',
  Extensions: 'Extensions',
  Miscellaneous: 'Miscellaneous',
};

/**
 * List of categories, ordered by display order (top to bottom)
 */
hterm.PreferenceManager.categoryDefinitions = [
  {id: hterm.PreferenceManager.Categories.Appearance,
    text: 'Appearance (fonts, colors, images)'},
  {id: hterm.PreferenceManager.Categories.CopyPaste,
    text: 'Copy & Paste'},
  {id: hterm.PreferenceManager.Categories.Encoding,
    text: 'Encoding'},
  {id: hterm.PreferenceManager.Categories.Keyboard,
    text: 'Keyboard'},
  {id: hterm.PreferenceManager.Categories.Scrolling,
    text: 'Scrolling'},
  {id: hterm.PreferenceManager.Categories.Sounds,
    text: 'Sounds'},
  {id: hterm.PreferenceManager.Categories.Extensions,
    text: 'Extensions'},
  {id: hterm.PreferenceManager.Categories.Miscellaneous,
    text: 'Miscellaneous'},
];

/**
 * Internal helper to create a default preference object.
 *
 * @param {string} name The user readable name/title.
 * @param {!hterm.PreferenceManager.Categories} category The pref category.
 * @param {boolean|number|string|?Object} defaultValue The default pref value.
 * @param {string|!Array<string|null>} type The type for this pref (or an array
 *     for enums).
 * @param {string} help The user readable help text.
 * @return {!Object} The default pref object.
 */
hterm.PreferenceManager.definePref_ = function(
    name, category, defaultValue, type, help) {
  return {
    'name': name,
    'category': category,
    'default': defaultValue,
    'type': type,
    'help': help,
  };
};

hterm.PreferenceManager.defaultPreferences = {
  'desktop-notification-bell': hterm.PreferenceManager.definePref_(
      'Create desktop notifications for alert bells',
      hterm.PreferenceManager.Categories.Sounds,
      false, 'bool',
      `If true, terminal bells in the background will create a Web ` +
      `Notification. https://www.w3.org/TR/notifications/\n` +
      `\n` +
      `Displaying notifications requires permission from the user. When this ` +
      `option is set to true, hterm will attempt to ask the user for ` +
      `permission if necessary. Browsers might not show this permission ` +
      `request if it was not triggered by a user action.\n` +
      `\n` +
      `Chrome extensions with the "notifications" permission have permission ` +
      `to display notifications.`,
  ),

  'background-color': hterm.PreferenceManager.definePref_(
      'Background color',
      hterm.PreferenceManager.Categories.Appearance,
      'rgb(26, 26, 26)', 'color',
      `The background color for text with no other color attributes.`,
  ),

  'background-size': hterm.PreferenceManager.definePref_(
      'Background image size',
      hterm.PreferenceManager.Categories.Appearance,
      '', 'string',
      `CSS value of the background image size.`,
  ),

  'background-position': hterm.PreferenceManager.definePref_(
      'Background image position',
      hterm.PreferenceManager.Categories.Appearance,
      '', 'string',
      `CSS value of the background image position.\n` +
      `\n` +
      `For example:\n` +
      `  10% 10%\n` +
      `  center`,
  ),

  'character-map-overrides': hterm.PreferenceManager.definePref_(
      'Character map overrides',
      hterm.PreferenceManager.Categories.Appearance,
      null, 'value',
      `This is specified as an object. It is a sparse array, where each ` +
      `property is the character set code and the value is an object that is ` +
      `a sparse array itself. In that sparse array, each property is the ` +
      `received character and the value is the displayed character.\n` +
      `\n` +
      `For example:\n` +
      `{ "0": {\n` +
      `  "+": "\\u2192",\n` +
      `  ",": "\\u2190",\n` +
      `  "-": "\\u2191",\n` +
      `  ".": "\\u2193",\n` +
      `  "0": "\\u2588"\n} }`,
  ),

  'color-palette-overrides': hterm.PreferenceManager.definePref_(
      'Initial color palette',
      hterm.PreferenceManager.Categories.Appearance,
      null, 'value',
      `Override colors in the default palette.\n` +
      `\n` +
      `This can be specified as an array or an object. If specified as an ` +
      `object it is assumed to be a sparse array, where each property ` +
      `is a numeric index into the color palette.\n` +
      `\n` +
      `Values can be specified as almost any CSS color value. This ` +
      `includes #RGB, #RRGGBB, rgb(...), rgba(...), and any color names ` +
      `that are also part of the standard X11 rgb.txt file.\n` +
      `\n` +
      `You can use 'null' to specify that the default value should be not ` +
      `be changed. This is useful for skipping a small number of indices ` +
      `when the value is specified as an array.\n` +
      `\n` +
      `For example, these both set color index 1 to blue:\n` +
      `  {1: "#0000ff"}\n` +
      `  [null, "#0000ff"]`,
  ),

  'copy-on-select': hterm.PreferenceManager.definePref_(
      'Automatically copy selected content',
      hterm.PreferenceManager.Categories.CopyPaste,
      true, 'bool',
      `Automatically copy mouse selection to the clipboard.`,
  ),

  'use-default-window-copy': hterm.PreferenceManager.definePref_(
      'Let the browser handle text copying',
      hterm.PreferenceManager.Categories.CopyPaste,
      false, 'bool',
      `Whether to use the default browser/OS's copy behavior.\n` +
      `\n` +
      `Allow the browser/OS to handle the copy event directly which might ` +
      `improve compatibility with some systems (where copying doesn't work ` +
      `at all), but makes the text selection less robust.\n` +
      `\n` +
      `For example, long lines that were automatically line wrapped will ` +
      `be copied with the newlines still in them.`,
  ),

  'clear-selection-after-copy': hterm.PreferenceManager.definePref_(
      'Automatically clear text selection',
      hterm.PreferenceManager.Categories.CopyPaste,
      true, 'bool',
      `Whether to clear the selection after copying.`,
  ),

  'east-asian-ambiguous-as-two-column': hterm.PreferenceManager.definePref_(
      'East Asian Ambiguous use two columns',
      hterm.PreferenceManager.Categories.Keyboard,
      false, 'bool',
      `Whether East Asian Ambiguous characters have two column width.`,
  ),

  'enable-8-bit-control': hterm.PreferenceManager.definePref_(
      'Support non-UTF-8 C1 control characters',
      hterm.PreferenceManager.Categories.Keyboard,
      false, 'bool',
      `True to enable 8-bit control characters, false to ignore them.\n` +
      `\n` +
      `We'll respect the two-byte versions of these control characters ` +
      `regardless of this setting.`,
  ),

  'enable-bold': hterm.PreferenceManager.definePref_(
      'Bold text behavior',
      hterm.PreferenceManager.Categories.Appearance,
      false, 'tristate',
      `If true, use bold weight font for text with the bold/bright ` +
      `attribute. False to use the normal weight font. Null to autodetect.`,
  ),

  'enable-bold-as-bright': hterm.PreferenceManager.definePref_(
      'Use bright colors with bold text',
      hterm.PreferenceManager.Categories.Appearance,
      true, 'bool',
      `If true, use bright colors (8-15 on a 16 color palette) for any text ` +
      `with the bold attribute. False otherwise.`,
  ),

  'enable-blink': hterm.PreferenceManager.definePref_(
      'Enable blinking text',
      hterm.PreferenceManager.Categories.Appearance,
      true, 'bool',
      `If true, respect the blink attribute. False to ignore it.`,
  ),

  'enable-clipboard-notice': hterm.PreferenceManager.definePref_(
      'Show notification when copying content',
      hterm.PreferenceManager.Categories.CopyPaste,
      true, 'bool',
      `Whether to show a message in the terminal when the host writes to the ` +
      `clipboard.`,
  ),

  'enable-csi-j-3': hterm.PreferenceManager.definePref_(
      'Allow clearing of scrollback buffer (CSI-J-3)',
      hterm.PreferenceManager.Categories.Miscellaneous,
      true, 'bool',
      `Whether the Erase Saved Lines function (mode 3) of the Erase Display ` +
      `command (CSI-J) may clear the terminal scrollback buffer.\n` +
      `\n` +
      `Enabling this by default is safe.`,
  ),

  'foreground-color': hterm.PreferenceManager.definePref_(
      'Text color',
      hterm.PreferenceManager.Categories.Appearance,
      'rgb(230, 230, 230)', 'color',
      `The foreground color for text with no other color attributes.`,
  ),

  'enable-resize-status': hterm.PreferenceManager.definePref_(
      'Show terminal dimensions when resized',
      hterm.PreferenceManager.Categories.Appearance,
      false, 'bool',
      `Whether to show terminal dimensions when the terminal changes size.`,
  ),

  'hide-mouse-while-typing': hterm.PreferenceManager.definePref_(
      'Hide mouse cursor while typing',
      hterm.PreferenceManager.Categories.Keyboard,
      null, 'tristate',
      `Whether to automatically hide the mouse cursor when typing. ` +
      `By default, autodetect whether the platform/OS handles this.\n` +
      `\n` +
      `Note: Your operating system might override this setting and thus you ` +
      `might not be able to always disable it.`,
  ),

  'screen-padding-size': hterm.PreferenceManager.definePref_(
      'Screen padding size',
      hterm.PreferenceManager.Categories.Appearance,
      3, 'int',
      `The padding size in pixels around the border of the terminal screen.\n` +
      `\n` +
      `This controls the size of the border around the terminal screen so ` +
      `the user can add some visible padding to the edges of the screen.`,
  ),

  'screen-border-size': hterm.PreferenceManager.definePref_(
      'Screen border size',
      hterm.PreferenceManager.Categories.Appearance,
      1, 'int',
      `The border size in pixels around the terminal screen.\n` +
      `\n` +
      `This controls the size of the border around the terminal screen to ` +
      `create a visible line at the edges of the screen.`,
  ),

  'screen-border-color': hterm.PreferenceManager.definePref_(
      'Screen border color',
      hterm.PreferenceManager.Categories.Appearance,
      'rgb(0, 64, 64)', 'color',
      `The color for the border around the terminal screen.\n` +
      `\n` +
      `This controls the color of the border around the terminal screen to ` +
      `create a visible line at the edges of the screen.`,
  ),

  'word-break-match-left': hterm.PreferenceManager.definePref_(
      'Automatic selection halting (to the left)',
      hterm.PreferenceManager.Categories.CopyPaste,
      // TODO(vapier): Switch \u back to ‘“‹« once builders are fixed.
      '[^\\s[\\](){}<>"\'^!@#$%&*,;:`\u{2018}\u{201c}\u{2039}\u{ab}]', 'string',
      `Regular expression to halt matching to the left (start) of a ` +
      `selection.\n` +
      `\n` +
      `Normally this is a character class to reject specific characters.\n` +
      `We allow "~" and "." by default as paths frequently start with those.`,
  ),

  'word-break-match-right': hterm.PreferenceManager.definePref_(
      'Automatic selection halting (to the right)',
      hterm.PreferenceManager.Categories.CopyPaste,
      // TODO(vapier): Switch \u back to ’”›» once builders are fixed.
      '[^\\s[\\](){}<>"\'^!@#$%&*,;:~.`\u{2019}\u{201d}\u{203a}\u{bb}]',
      'string',
      `Regular expression to halt matching to the right (end) of a ` +
      `selection.\n` +
      `\n` +
      `Normally this is a character class to reject specific characters.`,
  ),

  'word-break-match-middle': hterm.PreferenceManager.definePref_(
      'Word break characters',
      hterm.PreferenceManager.Categories.CopyPaste,
      '[^\\s[\\](){}<>"\'^]*', 'string',
      `Regular expression to match all the characters in the middle.\n` +
      `\n` +
      `Normally this is a character class to reject specific characters.\n` +
      `\n` +
      `Used to expand the selection surrounding the starting point.`,
  ),

  'scroll-wheel-may-send-arrow-keys': hterm.PreferenceManager.definePref_(
      'Emulate arrow keys with scroll wheel',
      hterm.PreferenceManager.Categories.Scrolling,
      false, 'bool',
      `When using the alternative screen buffer, and DECCKM (Application ` +
      `Cursor Keys) is active, mouse scroll wheel events will emulate arrow ` +
      `keys.\n` +
      `\n` +
      `It can be temporarily disabled by holding the Shift key.\n` +
      `\n` +
      `This frequently comes up when using pagers (less) or reading man ` +
      `pages or text editors (vi/nano) or using screen/tmux.`,
  ),

  'scroll-wheel-move-multiplier': hterm.PreferenceManager.definePref_(
      'Mouse scroll wheel multiplier',
      hterm.PreferenceManager.Categories.Scrolling,
      1, 'int',
      `The multiplier for mouse scroll wheel events when measured in ` +
      `pixels.\n` +
      `\n` +
      `Alters how fast the page scrolls.`,
  ),

  'terminal-encoding': hterm.PreferenceManager.definePref_(
      'Terminal encoding',
      hterm.PreferenceManager.Categories.Encoding,
      'utf-8', ['iso-2022', 'utf-8', 'utf-8-locked'],
      `The default terminal encoding (DOCS).\n` +
      `\n` +
      `ISO-2022 enables character map translations (like graphics maps).\n` +
      `UTF-8 disables support for those.\n` +
      `\n` +
      `The locked variant means the encoding cannot be changed at runtime ` +
      `via terminal escape sequences.\n` +
      `\n` +
      `You should stick with UTF-8 unless you notice broken rendering with ` +
      `legacy applications.`,
  ),

  'allow-images-inline': hterm.PreferenceManager.definePref_(
      'Allow inline image display',
      hterm.PreferenceManager.Categories.Extensions,
      null, 'tristate',
      `Whether to allow the remote host to display images in the terminal.\n` +
      `\n` +
      `By default, we prompt until a choice is made.`,
  ),
};

hterm.PreferenceManager.prototype =
    Object.create(lib.PreferenceManager.prototype);
/** @override */
hterm.PreferenceManager.constructor = hterm.PreferenceManager;

/**
 * Changes profile and notifies all listeners with updated values.
 *
 * @param {string} profileId New profile to use.
 * @param {function()=} callback Optional function to invoke when completed.
 */
hterm.PreferenceManager.prototype.setProfile = function(profileId, callback) {
  lib.PreferenceManager.prototype.setPrefix.call(
      this, hterm.PreferenceManager.prefix_ + profileId, callback);
};
// SOURCE FILE: hterm/js/hterm_pubsub.js
// Copyright (c) 2012 The Chromium OS Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Utility class used to add publish/subscribe/unsubscribe functionality to
 * an existing object.
 *
 * @constructor
 */
hterm.PubSub = function() {
  this.observers_ = {};
};

/**
 * Add publish, subscribe, and unsubscribe methods to an existing object.
 *
 * No other properties of the object are touched, so there is no need to
 * worry about clashing private properties.
 *
 * @param {!Object} obj The object to add this behavior to.
 */
hterm.PubSub.addBehavior = function(obj) {
  const pubsub = new hterm.PubSub();
  for (const m in hterm.PubSub.prototype) {
    obj[m] = hterm.PubSub.prototype[m].bind(pubsub);
  }
};

/**
 * Subscribe to be notified of messages about a subject.
 *
 * @param {string} subject The subject to subscribe to.
 * @param {function(...)} callback The function to invoke for notifications.
 */
hterm.PubSub.prototype.subscribe = function(subject, callback) {
  if (!(subject in this.observers_)) {
    this.observers_[subject] = [];
  }

  this.observers_[subject].push(callback);
};

/**
 * Unsubscribe from a subject.
 *
 * @param {string} subject The subject to unsubscribe from.
 * @param {function(...)} callback A callback previously registered via
 *     subscribe().
 */
hterm.PubSub.prototype.unsubscribe = function(subject, callback) {
  const list = this.observers_[subject];
  if (!list) {
    throw new Error(`Invalid subject: ${subject}`);
  }

  const i = list.indexOf(callback);
  if (i < 0) {
    throw new Error(`Not subscribed: ${subject}`);
  }

  list.splice(i, 1);
};

/**
 * Publish a message about a subject.
 *
 * Subscribers (and the optional final callback) are invoked asynchronously.
 * This method will return before anyone is actually notified.
 *
 * @param {string} subject The subject to publish about.
 * @param {?Object=} e An arbitrary object associated with this notification.
 * @param {function(!Object)=} lastCallback An optional function to call
 *     after all subscribers have been notified.
 */
hterm.PubSub.prototype.publish = function(
    subject, e, lastCallback = undefined) {
  function notifyList(i) {
    // Set this timeout before invoking the callback, so we don't have to
    // concern ourselves with exceptions.
    if (i < list.length - 1) {
      setTimeout(notifyList, 0, i + 1);
    }

    list[i](e);
  }

  let list = this.observers_[subject];
  if (list) {
    // Copy the list, in case it changes while we're notifying.
    list = [].concat(list);
  }

  if (lastCallback) {
    if (list) {
      list.push(lastCallback);
    } else {
      list = [lastCallback];
    }
  }

  if (list) {
    setTimeout(notifyList, 0, 0);
  }
};
