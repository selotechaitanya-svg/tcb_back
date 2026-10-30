/**
 * Balatro Interactive Background Shader
 * Ported from Balatro's iconic psychedelic swirling liquid GLSL shader.
 * Colors: #DE443B (Spider Red), #006BB4 (Cobalt Blue), #162325 (Dark Slate)
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.initBalatroBackground = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function hexToRgb(hex) {
    hex = hex.replace('#', '').trim();
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const num = parseInt(hex, 16);
    return [
      ((num >> 16) & 255) / 255,
      ((num >> 8) & 255) / 255,
      (num & 255) / 255
    ];
  }

  const VERTEX_SHADER = `
    attribute vec2 aPosition;
    void main() {
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const FRAGMENT_SHADER = `
    precision highp float;
    uniform vec2 iResolution;
    uniform float iTime;
    uniform vec2 iMouse;
    uniform vec3 uColor1;
    uniform vec3 uColor2;
    uniform vec3 uColor3;
    uniform float uSwirl;
    uniform float uPixelSize;

    #define SPIN_EASE 1.0

    void main() {
      vec2 screenSize = iResolution.xy;
      vec2 screen_coords = gl_FragCoord.xy;
      
      float spin_rotation_speed = 1.6;
      float move_speed = 4.5;
      
      // Mouse dynamic stirring
      vec2 mouseOffset = (iMouse.xy / screenSize - 0.5) * 0.12;
      vec2 offset = mouseOffset;
      
      float contrast = 3.5;
      float lighting = 0.40;
      float spin_amount = uSwirl;
      float pixel_filter = 740.0 / max(0.5, uPixelSize);
      
      // Pixelation / retro scaling effect
      float pixel_size = max(1.0, length(screenSize) / pixel_filter);
      vec2 uv = (floor(screen_coords * (1.0 / pixel_size)) * pixel_size - 0.5 * screenSize) / length(screenSize) - offset;
      
      float uv_len = length(uv);
      
      // Swirl math
      float speed = (spin_rotation_speed * SPIN_EASE * 0.2);
      speed = iTime * speed + 302.2;
      
      float new_pixel_angle = atan(uv.y, uv.x) + speed - SPIN_EASE * 20.0 * (spin_amount * uv_len + (1.0 - spin_amount));
      vec2 mid = (screenSize / length(screenSize)) / 2.0;
      uv = vec2((uv_len * cos(new_pixel_angle) + mid.x), (uv_len * sin(new_pixel_angle) + mid.y)) - mid;
      
      // Iterative UV paint warping
      uv *= 28.0;
      float t_speed = iTime * move_speed;
      vec2 uv2 = vec2(uv.x + uv.y);
      
      for(int i = 0; i < 5; i++) {
        uv2 += sin(max(uv.x, uv.y)) + uv;
        uv += 0.5 * vec2(cos(5.1123314 + 0.353 * uv2.y + t_speed * 0.131121), sin(uv2.x - 0.113 * t_speed));
        uv -= 1.0 * cos(uv.x + uv.y) - 1.0 * sin(uv.x * 0.711 - uv.y);
      }
      
      // Color mixing with custom triad
      float contrast_mod = (0.25 * contrast + 0.5 * spin_amount + 1.2);
      float paint_res = min(2.0, max(0.0, length(uv) * 0.035 * contrast_mod));
      
      float c1p = max(0.0, 1.0 - contrast_mod * abs(1.0 - paint_res));
      float c2p = max(0.0, 1.0 - contrast_mod * abs(paint_res));
      float c3p = max(0.0, 1.0 - contrast_mod * abs(2.0 - paint_res));
      
      vec3 ret_col = (uColor1 * c1p + uColor2 * c2p + uColor3 * c3p) / lighting;
      
      // Deep dark vignette for readable superhero contrast
      vec2 q = screen_coords / screenSize;
      float vig = 16.0 * q.x * q.y * (1.0 - q.x) * (1.0 - q.y);
      ret_col *= clamp(pow(vig, 0.28), 0.0, 1.0) * 0.82;

      gl_FragColor = vec4(ret_col, 1.0);
    }
  `;

  return function initBalatroBackground(options = {}) {
    const color1 = hexToRgb(options.color1 || '#DE443B');
    const color2 = hexToRgb(options.color2 || '#006BB4');
    const color3 = hexToRgb(options.color3 || '#162325');
    const swirl = options.swirl !== undefined ? options.swirl : 0.25;
    const pixelSize = options.pixelSize !== undefined ? options.pixelSize : 1.5;
    const enableMouse = options.mouseInteraction !== undefined ? options.mouseInteraction : true;

    let canvas = document.getElementById(options.canvasId || 'balatro-bg-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = options.canvasId || 'balatro-bg-canvas';
      canvas.style.position = 'fixed';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.width = '100vw';
      canvas.style.height = '100vh';
      canvas.style.zIndex = '-1';
      canvas.style.pointerEvents = 'none';
      canvas.style.opacity = options.opacity || '0.68';
      canvas.style.transform = 'translate3d(0, 0, 0)';
      document.body.prepend(canvas);
    }

    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'high-performance' }) ||
               canvas.getContext('experimental-webgl');

    if (!gl) {
      console.warn('[Balatro] WebGL not available on this client.');
      return null;
    }

    function createShader(type, source) {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('[Balatro] Shader error:', gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
      }
      return s;
    }

    const vs = createShader(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = createShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) return null;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[Balatro] Program link error:', gl.getProgramInfoLog(program));
      return null;
    }

    gl.useProgram(program);

    // Full screen quad buffer
    const quad = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1
    ]);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uResolution = gl.getUniformLocation(program, 'iResolution');
    const uTime = gl.getUniformLocation(program, 'iTime');
    const uMouse = gl.getUniformLocation(program, 'iMouse');
    const uColor1Loc = gl.getUniformLocation(program, 'uColor1');
    const uColor2Loc = gl.getUniformLocation(program, 'uColor2');
    const uColor3Loc = gl.getUniformLocation(program, 'uColor3');
    const uSwirlLoc = gl.getUniformLocation(program, 'uSwirl');
    const uPixelSizeLoc = gl.getUniformLocation(program, 'uPixelSize');

    gl.uniform3f(uColor1Loc, color1[0], color1[1], color1[2]);
    gl.uniform3f(uColor2Loc, color2[0], color2[1], color2[2]);
    gl.uniform3f(uColor3Loc, color3[0], color3[1], color3[2]);
    gl.uniform1f(uSwirlLoc, swirl);
    gl.uniform1f(uPixelSizeLoc, pixelSize);

    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let targetMouseX = mouseX;
    let targetMouseY = mouseY;

    if (enableMouse) {
      window.addEventListener('pointermove', function (e) {
        targetMouseX = e.clientX;
        targetMouseY = window.innerHeight - e.clientY;
      }, { passive: true });
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5); // cap at 1.5 DPR for smooth 60fps GPU
      const w = Math.floor(window.innerWidth * dpr);
      const h = Math.floor(window.innerHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
        gl.uniform2f(uResolution, w, h);
      }
    }

    window.addEventListener('resize', resize, { passive: true });
    resize();

    let startTime = performance.now();
    let animId = null;

    function render(now) {
      const elapsed = (now - startTime) / 1000;
      gl.uniform1f(uTime, elapsed);

      // Smooth mouse lerp
      mouseX += (targetMouseX - mouseX) * 0.05;
      mouseY += (targetMouseY - mouseY) * 0.05;
      gl.uniform2f(uMouse, mouseX, mouseY);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      animId = requestAnimationFrame(render);
    }

    animId = requestAnimationFrame(render);

    return {
      destroy: function () {
        if (animId) cancelAnimationFrame(animId);
        window.removeEventListener('resize', resize);
        if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      }
    };
  };
});
