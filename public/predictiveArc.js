/**
 * Predictive Arc Background — Originkit (vanilla WebGL port)
 * Renders a softly curved band of square dots that drifts over time and
 * bends toward the pointer. Mounted as a fixed, non-interactive layer behind
 * the glass UI.
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const mod = factory();
    root.initPredictiveArc = mod.initPredictiveArc;
    root.PredictiveArc = mod.PredictiveArc;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_DPR = 2;

  const VERT_SRC = `
attribute vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

  const FRAG_SRC = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2  uRes;
uniform float uTime, uDpr, uCell, uDot;
uniform float uPeak, uHeight, uThick, uFall;
uniform vec3  uBg, uBase, uAccent, uHigh;
uniform vec2  uMouse;
uniform float uMouseRadius, uMouseStrength;

void main(){
  float cs = max(uCell, 2.0);
  vec2 ci = floor(gl_FragCoord.xy / cs);
  vec2 cc = (ci + 0.5) * cs;               // cell centre, device px

  // CSS pixels: the source's constants (0.015, 0.02, 140, 80) are all in CSS px
  float x = cc.x / uDpr;
  float y = (uRes.y - cc.y) / uDpr;        // canvas y runs down
  float w = uRes.x / uDpr;
  float h = uRes.y / uDpr;

  float normX = (x - w * 0.5) / (w * 0.75);
  float curveY = h * uPeak + normX * normX * (h * uHeight);

  // pointer bend: pull curveY toward the cursor's y, weighted by how close
  // this column's x is to the cursor's x — a Gaussian falloff, not a hard edge
  float mdx = x - uMouse.x;
  float influence = uMouseStrength * exp(-(mdx * mdx) / (2.0 * uMouseRadius * uMouseRadius + 1.0));
  curveY = mix(curveY, uMouse.y, influence);

  float dist = abs(y - curveY);
  float th = (140.0 + (1.0 - abs(normX)) * 80.0) * uThick;

  vec3 col = uBg;
  if (dist < th) {
    float i = 1.0 - dist / th;
    float waveX = sin(x * 0.015 + uTime);
    float waveY = cos(y * 0.02 + uTime);
    i = i * 0.7 + waveX * waveY * 0.3 * i;
    i *= max(0.0, 1.0 - pow(abs(normX), uFall));

    if (i > 0.02) {
      // square dot, centred in its cell, side carrying the intensity
      float side = uDot * i * uDpr;
      vec2 d = abs(gl_FragCoord.xy - cc);
      float cov = 1.0 - smoothstep(side * 0.5 - 1.0, side * 0.5 + 1.0, max(d.x, d.y));

      vec3 ink = mix(uBase, uAccent, clamp(pow(i, 1.1), 0.0, 1.0));
      ink = mix(ink, uHigh, smoothstep(0.72, 1.0, i));
      col = mix(uBg, ink, cov * clamp(i * 1.6, 0.0, 1.0));
    }
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

  const DEFAULTS = {
    background: '#05070b',
    baseColor: '#DE443B',
    accentColor: '#FF9898',
    highlight: '#FF6B62',
    density: 78,
    dotSize: 102,
    speed: 100,
    arch: { peak: 100, archHeight: 0, thickness: 206, falloff: 600 },
    pointer: { enabled: true, radius: 236, strength: 34 }
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const num = (value, fallback) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

  function parseColor(input, fallback) {
    if (!input) return fallback;
    const str = String(input).trim();
    if (str.charAt(0) === '#') {
      let hex = str.slice(1);
      if (hex.length === 3 || hex.length === 4) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      }
      if (hex.length >= 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
          return [r / 255, g / 255, b / 255];
        }
      }
      return fallback;
    }
    const m = str.match(/[\d.]+/g);
    if (m && m.length >= 3) {
      return [
        Math.min(255, parseFloat(m[0])) / 255,
        Math.min(255, parseFloat(m[1])) / 255,
        Math.min(255, parseFloat(m[2])) / 255
      ];
    }
    return fallback;
  }

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    console.warn('[PredictiveArc] Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }

  function link(gl) {
    const vertex = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vertex || !fragment) {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      return null;
    }

    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      return null;
    }

    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('[PredictiveArc] Program link error:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }

    return program;
  }

  /**
   * Initializes the predictive arc as a fixed full-page background.
   * @param {Object} options Optional overrides for colors, density and geometry.
   * @returns {{destroy: Function}|null}
   */
  function initPredictiveArc(options = {}) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;

    const arch = { ...DEFAULTS.arch, ...(options.arch || {}) };
    const pointerOptions = { ...DEFAULTS.pointer, ...(options.pointer || {}) };

    const settings = {
      background: options.background || DEFAULTS.background,
      base: options.baseColor || DEFAULTS.baseColor,
      accent: options.accentColor || DEFAULTS.accentColor,
      highlight: options.highlight || DEFAULTS.highlight,
      density: Math.round(clamp(num(options.density, DEFAULTS.density), 40, 320)),
      dotSize: clamp(num(options.dotSize, DEFAULTS.dotSize), 20, 400) / 100,
      speed: clamp(num(options.speed, DEFAULTS.speed), 0, 100) / 50,
      peak: clamp(num(arch.peak, DEFAULTS.arch.peak), 0, 100) / 100,
      archHeight: clamp(num(arch.archHeight, DEFAULTS.arch.archHeight), 0, 300) / 100,
      thickness: clamp(num(arch.thickness, DEFAULTS.arch.thickness), 20, 400) / 100,
      falloff: clamp(num(arch.falloff, DEFAULTS.arch.falloff), 50, 600) / 100,
      pointerEnabled: pointerOptions.enabled !== false,
      pointerRadius: clamp(num(pointerOptions.radius, DEFAULTS.pointer.radius), 40, 600),
      pointerStrength: clamp(num(pointerOptions.strength, DEFAULTS.pointer.strength), 0, 100) / 100
    };

    const reduceMotion = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    const finePointer = window.matchMedia
      ? window.matchMedia('(pointer: fine)').matches
      : true;

    const existing = document.getElementById('predictive-arc-bg');
    if (existing && existing !== options.container) {
      if (existing.__predictiveArc) existing.__predictiveArc.destroy();
      else existing.remove();
    }

    let container = options.container;
    let createdContainer = false;

    if (!container) {
      container = document.createElement('div');
      container.id = 'predictive-arc-bg';
      container.className = 'predictive-arc-bg';
      container.setAttribute('aria-hidden', 'true');
      container.style.position = 'fixed';
      container.style.inset = '0';
      container.style.width = '100%';
      container.style.height = '100vh';
      container.style.height = '100dvh';
      container.style.zIndex = '-1';
      container.style.overflow = 'hidden';
      container.style.pointerEvents = 'none';
      container.style.background = settings.background;
      document.body.prepend(container);
      createdContainer = true;
    }

    const canvas = document.createElement('canvas');
    canvas.className = 'predictive-arc-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);

    const fail = () => {
      canvas.remove();
      if (createdContainer && container.parentNode) container.remove();
      return null;
    };

    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance'
    });

    if (!gl) {
      console.warn('[PredictiveArc] WebGL is unavailable in this browser.');
      return fail();
    }

    const program = link(gl);
    if (!program) return fail();

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const position = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const uniforms = Object.create(null);
    const uniform = name => {
      if (!(name in uniforms)) uniforms[name] = gl.getUniformLocation(program, name);
      return uniforms[name];
    };

    const bgFallback = [0.02, 0.027, 0.043];
    const baseFallback = [0.871, 0.267, 0.231];
    const accentFallback = [1, 0.596, 0.596];
    const highFallback = [1, 0.42, 0.384];

    const bgColor = parseColor(settings.background, bgFallback);
    const baseColor = parseColor(settings.base, baseFallback);
    const accentColor = parseColor(settings.accent, accentFallback);
    const highlightColor = parseColor(settings.highlight, highFallback);

    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0, active: 0, targetActive: 0 };
    const interactive = settings.pointerEnabled && finePointer && !reduceMotion;

    let raf = 0;
    let last = 0;
    let clock = 0;

    const syncCanvasSize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const cssWidth = Math.max(1, container.clientWidth || window.innerWidth || 1);
      const cssHeight = Math.max(1, container.clientHeight || window.innerHeight || 1);
      const width = Math.max(1, Math.round(cssWidth * dpr));
      const height = Math.max(1, Math.round(cssHeight * dpr));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      return { dpr, width, height, cssWidth, cssHeight };
    };

    const render = now => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;

      if (!reduceMotion) {
        // The source advances 0.015 per frame at speed 1; expressed per second.
        clock = (clock + dt * 0.9 * settings.speed) % 6283;
      }

      const { dpr, width, height } = syncCanvasSize();

      // Exponential-ish smoothing keeps the bend framerate-stable and fades
      // gently instead of snapping when the pointer leaves.
      const posLerp = Math.min(1, dt * 12);
      const activeLerp = Math.min(1, dt * 6);
      pointer.x += (pointer.targetX - pointer.x) * posLerp;
      pointer.y += (pointer.targetY - pointer.y) * posLerp;
      pointer.active += (pointer.targetActive - pointer.active) * activeLerp;

      // Density is cells down the short edge, so the grain stays put when the
      // frame changes aspect instead of stretching with the width.
      const pitchCss = Math.min(width, height) / dpr / settings.density;

      gl.useProgram(program);
      gl.uniform2f(uniform('uRes'), width, height);
      gl.uniform1f(uniform('uTime'), clock);
      gl.uniform1f(uniform('uDpr'), dpr);
      gl.uniform1f(uniform('uCell'), Math.max(2, pitchCss * dpr));
      gl.uniform1f(uniform('uDot'), pitchCss * 1.2 * settings.dotSize);
      gl.uniform1f(uniform('uPeak'), settings.peak);
      gl.uniform1f(uniform('uHeight'), settings.archHeight);
      gl.uniform1f(uniform('uThick'), settings.thickness);
      gl.uniform1f(uniform('uFall'), settings.falloff);
      gl.uniform2f(uniform('uMouse'), pointer.x, pointer.y);
      gl.uniform1f(uniform('uMouseRadius'), settings.pointerRadius);
      gl.uniform1f(
        uniform('uMouseStrength'),
        interactive ? settings.pointerStrength * pointer.active : 0
      );
      gl.uniform3f(uniform('uBg'), bgColor[0], bgColor[1], bgColor[2]);
      gl.uniform3f(uniform('uBase'), baseColor[0], baseColor[1], baseColor[2]);
      gl.uniform3f(uniform('uAccent'), accentColor[0], accentColor[1], accentColor[2]);
      gl.uniform3f(uniform('uHigh'), highlightColor[0], highlightColor[1], highlightColor[2]);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const frame = now => {
      if (document.hidden) {
        raf = 0;
        return;
      }
      render(now);
      raf = requestAnimationFrame(frame);
    };

    const wake = () => {
      if (reduceMotion) return;
      if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
    };

    const onPointerMove = event => {
      const rect = container.getBoundingClientRect();
      pointer.targetX = event.clientX - rect.left;
      pointer.targetY = rect.height - (event.clientY - rect.top);
      pointer.targetActive = 1;
      wake();
    };

    const onPointerLeave = () => {
      pointer.targetActive = 0;
      wake();
    };

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else {
        last = 0;
        wake();
      }
    };

    const onResize = () => {
      syncCanvasSize();
      if (reduceMotion) render(performance.now());
      wake();
    };

    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
    if (resizeObserver) resizeObserver.observe(container);
    window.addEventListener('resize', onResize, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);

    if (interactive) {
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      document.documentElement.addEventListener('pointerleave', onPointerLeave);
      window.addEventListener('blur', onPointerLeave);
    }

    // Draw the first frame immediately so there is no flash of the flat
    // container background while waiting for RAF.
    render(performance.now());
    if (!reduceMotion) wake();

    const controller = {
      destroy() {
        cancelAnimationFrame(raf);
        if (resizeObserver) resizeObserver.disconnect();
        window.removeEventListener('resize', onResize);
        document.removeEventListener('visibilitychange', onVisibility);
        if (interactive) {
          window.removeEventListener('pointermove', onPointerMove);
          document.documentElement.removeEventListener('pointerleave', onPointerLeave);
          window.removeEventListener('blur', onPointerLeave);
        }
        gl.deleteProgram(program);
        gl.deleteBuffer(buffer);
        canvas.remove();
        if (createdContainer && container.parentNode) container.remove();
        if (container.__predictiveArc === controller) delete container.__predictiveArc;
      }
    };

    container.__predictiveArc = controller;
    return controller;
  }

  return {
    initPredictiveArc,
    PredictiveArc: initPredictiveArc
  };
});
