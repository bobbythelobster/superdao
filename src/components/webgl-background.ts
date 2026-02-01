const DOT_COUNT = 5;

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// Fragment shader — render dots on white background with circular orbits
const DOT_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;

uniform vec3 u_dotCenter[${DOT_COUNT}];  // xy = center (0-1), z = orbitRadius (0-1)
uniform vec4 u_dotParams[${DOT_COUNT}];  // x = startAngle, y = speed, z = opacity, w = dotRadius (0-1)
uniform vec3 u_bgColor;
uniform vec3 u_dotColor;

void main() {
  vec2 fragPos = v_uv * u_resolution;
  float minDim = min(u_resolution.x, u_resolution.y);

  vec3 dotColor = u_dotColor;
  vec3 result = u_bgColor;

  for (int i = 0; i < ${DOT_COUNT}; i++) {
    float angle = u_dotParams[i].x + u_time * u_dotParams[i].y;
    vec2 center = vec2(
      u_dotCenter[i].x + cos(angle) * u_dotCenter[i].z,
      u_dotCenter[i].y + sin(angle) * u_dotCenter[i].z
    );

    vec2 dotPos = center * u_resolution;
    float dist = length(fragPos - dotPos);

    float dotRadius = u_dotParams[i].w * minDim;
    float gradient = 1.0 - smoothstep(0.0, dotRadius, dist);
    float alpha = gradient * u_dotParams[i].z;

    // Alpha blend each dot over the result
    result = mix(result, dotColor, alpha);
  }

  fragColor = vec4(result, 1.0);
}
`;

// Separable Gaussian blur shader
const BLUR_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform vec2 u_direction;
uniform vec2 u_resolution;

void main() {
  vec2 texelSize = 1.0 / u_resolution;
  vec3 result = vec3(0.0);

  // 9-tap Gaussian kernel, sigma ~= 3.5
  // Uses bilinear filtering trick: 5 texture lookups instead of 9
  float weights[5] = float[](0.227027, 0.194596, 0.121622, 0.054054, 0.016216);
  float offsets[5] = float[](0.0, 1.3846153846, 3.2307692308, 5.0769230769, 6.9230769231);

  for (int i = 0; i < 5; i++) {
    vec2 off = u_direction * offsets[i] * texelSize;
    result += texture(u_texture, v_uv + off).rgb * weights[i];
    if (i > 0) {
      result += texture(u_texture, v_uv - off).rgb * weights[i];
    }
  }

  fragColor = vec4(result, 1.0);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram()!;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);

  // Force a_position to location 0 for all programs
  gl.bindAttribLocation(program, 0, "a_position");

  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${info}`);
  }
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  return program;
}

function createFB(gl: WebGL2RenderingContext, w: number, h: number) {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

  return { framebuffer: fb, texture: tex };
}

function destroyFB(gl: WebGL2RenderingContext, fb: { framebuffer: WebGLFramebuffer; texture: WebGLTexture }) {
  gl.deleteTexture(fb.texture);
  gl.deleteFramebuffer(fb.framebuffer);
}

export function initWebGLBackground(canvas: HTMLCanvasElement): (() => void) | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    premultipliedAlpha: false,
  });
  if (!gl) {
    console.error("WebGL2 not supported");
    return null;
  }

  // Generate random dot parameters
  const dots = Array.from({ length: DOT_COUNT }, () => {
    const orbitRadius = 0.2 + Math.random() * 0.8;
    // Clamp center so the orbit stays within viewport (0..1)
    const margin = orbitRadius;
    return {
      centerX: margin + Math.random() * Math.max(0, 1 - 2 * margin),
      centerY: margin + Math.random() * Math.max(0, 1 - 2 * margin),
      orbitRadius,
      startAngle: Math.random() * Math.PI * 2,
      speed: 0.3 + Math.random() * 0.7,
      opacity: 0.1 + Math.random() * 0.4,
      dotRadius: 0.5, // 100% of viewport (radius = 50% of minDim, diameter = 100%)
    };
  });

  // Compile programs (a_position forced to location 0 in all)
  const dotProgram = linkProgram(gl, VERTEX_SHADER, DOT_FRAGMENT_SHADER);
  const blurProgram = linkProgram(gl, VERTEX_SHADER, BLUR_FRAGMENT_SHADER);

  // Shared fullscreen quad VAO at attribute location 0
  const quadVao = gl.createVertexArray()!;
  gl.bindVertexArray(quadVao);
  const quadBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // Cache uniform locations
  const dotU = {
    time: gl.getUniformLocation(dotProgram, "u_time"),
    resolution: gl.getUniformLocation(dotProgram, "u_resolution"),
    bgColor: gl.getUniformLocation(dotProgram, "u_bgColor"),
    dotColor: gl.getUniformLocation(dotProgram, "u_dotColor"),
    dotCenter: Array.from({ length: DOT_COUNT }, (_, i) =>
      gl.getUniformLocation(dotProgram, `u_dotCenter[${i}]`)
    ),
    dotParams: Array.from({ length: DOT_COUNT }, (_, i) =>
      gl.getUniformLocation(dotProgram, `u_dotParams[${i}]`)
    ),
  };

  // Parse a CSS color string (hex or rgb()) into normalized [r, g, b]
  function parseCSSColor(raw: string): [number, number, number] {
    const s = raw.trim();
    console.log('[WebGL] Parsing color:', s);
    
    // Match #RGB, #RRGGBB (with optional whitespace before #)
    const hex = s.match(/^\s*#([0-9a-f]{3,6})\s*$/i);
    if (hex) {
      let h = hex[1];
      if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
      const result = [
        parseInt(h.slice(0, 2), 16) / 255,
        parseInt(h.slice(2, 4), 16) / 255,
        parseInt(h.slice(4, 6), 16) / 255,
      ];
      console.log('[WebGL] Parsed hex:', h, '->', result);
      return result as [number, number, number];
    }
    
    // Match rgb(r, g, b) or rgba(r, g, b, a)
    const rgb = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgb) {
      const result = [parseInt(rgb[1]) / 255, parseInt(rgb[2]) / 255, parseInt(rgb[3]) / 255];
      console.log('[WebGL] Parsed rgb:', result);
      return result as [number, number, number];
    }
    
    console.warn('[WebGL] Failed to parse color, falling back to white:', s);
    return [1, 1, 1]; // fallback white
  }

  function getThemeColors() {
    const style = getComputedStyle(document.documentElement);
    const bg = parseCSSColor(style.getPropertyValue("--color-bg"));
    const dot = parseCSSColor(style.getPropertyValue("--color-dot"));
    return { bgR: bg[0], bgG: bg[1], bgB: bg[2], dotR: dot[0], dotG: dot[1], dotB: dot[2] };
  }

  let themeColors = getThemeColors();

  // Listen for color scheme changes and re-read CSS variables
  const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const onColorSchemeChange = () => {
    // Defer to next frame so browser has applied new CSS values
    requestAnimationFrame(() => {
      themeColors = getThemeColors();
    });
  };
  colorSchemeQuery.addEventListener("change", onColorSchemeChange);

  const blurU = {
    texture: gl.getUniformLocation(blurProgram, "u_texture"),
    direction: gl.getUniformLocation(blurProgram, "u_direction"),
    resolution: gl.getUniformLocation(blurProgram, "u_resolution"),
  };

  // Framebuffers — initialized lazily on first resize
  // fbA = dot render target, fbB/fbC = blur ping-pong
  let width = 0;
  let height = 0;
  let fbA: ReturnType<typeof createFB>;
  let fbB: ReturnType<typeof createFB>;
  let fbC: ReturnType<typeof createFB>;

  const BLUR_PASSES = 6; // Number of H+V blur iterations for a wide, soft blur

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (w === width && h === height) return;

    canvas.width = w;
    canvas.height = h;
    width = w;
    height = h;

    // Recreate framebuffers
    if (fbA) destroyFB(gl!, fbA);
    if (fbB) destroyFB(gl!, fbB);
    if (fbC) destroyFB(gl!, fbC);
    fbA = createFB(gl!, width, height);
    fbB = createFB(gl!, width, height);
    fbC = createFB(gl!, width, height);
  }

  let animationId: number;
  const t0 = performance.now() / 1000;

  function render() {
    resize();
    const time = performance.now() / 1000 - t0;

    gl!.bindVertexArray(quadVao);

    // Pass 1: Render dots (white bg + colored dots) to fbA
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbA.framebuffer);
    gl!.viewport(0, 0, width, height);
    gl!.useProgram(dotProgram);
    gl!.uniform1f(dotU.time, time);
    gl!.uniform2f(dotU.resolution, width, height);
    gl!.uniform3f(dotU.bgColor, themeColors.bgR, themeColors.bgG, themeColors.bgB);
    gl!.uniform3f(dotU.dotColor, themeColors.dotR, themeColors.dotG, themeColors.dotB);

    for (let i = 0; i < DOT_COUNT; i++) {
      gl!.uniform3f(dotU.dotCenter[i], dots[i].centerX, dots[i].centerY, dots[i].orbitRadius);
      gl!.uniform4f(dotU.dotParams[i], dots[i].startAngle, dots[i].speed, dots[i].opacity, dots[i].dotRadius);
    }
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);

    // Multi-pass Gaussian blur: ping-pong between fbB and fbC
    gl!.useProgram(blurProgram);
    gl!.uniform1i(blurU.texture, 0);
    gl!.uniform2f(blurU.resolution, width, height);
    gl!.activeTexture(gl!.TEXTURE0);

    // Source for first blur pass is the dot render (fbA)
    let readTex = fbA.texture;

    for (let p = 0; p < BLUR_PASSES; p++) {
      // Horizontal pass → fbB
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbB.framebuffer);
      gl!.viewport(0, 0, width, height);
      gl!.bindTexture(gl!.TEXTURE_2D, readTex);
      gl!.uniform2f(blurU.direction, 1.0, 0.0);
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);

      // Vertical pass → fbC (or screen on last pass)
      const isLast = p === BLUR_PASSES - 1;
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, isLast ? null : fbC.framebuffer);
      gl!.viewport(0, 0, width, height);
      gl!.bindTexture(gl!.TEXTURE_2D, fbB.texture);
      gl!.uniform2f(blurU.direction, 0.0, 1.0);
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);

      // Next iteration reads from fbC
      readTex = fbC.texture;
    }

    animationId = requestAnimationFrame(render);
  }

  animationId = requestAnimationFrame(render);

  return () => {
    cancelAnimationFrame(animationId);
    colorSchemeQuery.removeEventListener("change", onColorSchemeChange);
  };
}
