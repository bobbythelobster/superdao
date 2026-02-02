const DOT_COUNT = 5;

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// Fragment shader — render dots with dynamic background/dot colors from CSS
const DOT_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec3 u_bgColor;
uniform vec3 u_dotColor;

uniform vec3 u_dotCenter[${DOT_COUNT}];  // xy = center (0-1), z = orbitRadius (0-1)
uniform vec4 u_dotParams[${DOT_COUNT}];  // x = startAngle, y = speed, z = opacity, w = dotRadius (0-1)

void main() {
  vec2 fragPos = v_uv * u_resolution;
  float minDim = min(u_resolution.x, u_resolution.y);

  // Start with background color from CSS
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

    // Alpha blend each dot over the result using dot color from CSS
    result = mix(result, u_dotColor, alpha);
  }

  fragColor = vec4(result, 1.0);
}
`;

// Parse CSS color (hex or rgb) to normalized RGB values
function parseCSSColor(color: string): [number, number, number] {
  // Handle hex colors
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    return [r, g, b];
  }
  // Handle rgb/rgba colors
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    return [
      parseInt(match[1]) / 255,
      parseInt(match[2]) / 255,
      parseInt(match[3]) / 255,
    ];
  }
  // Fallback to white
  return [1, 1, 1];
}

// Read CSS custom property colors from computed styles
function getThemeColors(): { bg: [number, number, number]; dot: [number, number, number] } {
  const styles = getComputedStyle(document.documentElement);
  const bgColor = styles.getPropertyValue("--color-bg").trim() || "#ffffff";
  const dotColor = styles.getPropertyValue("--color-dot").trim() || "#555555";
  return {
    bg: parseCSSColor(bgColor),
    dot: parseCSSColor(dotColor),
  };
}

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

// Final output shader with aesthetic film grain noise
const OUTPUT_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_texture;
uniform float u_time;

// PCG-based random - high quality, no visible patterns
uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

// Convert pixel coords + frame to random float [0,1]
float rand(vec2 co, float frame) {
  uint x = uint(co.x);
  uint y = uint(co.y);
  uint f = uint(frame);
  uint seed = (x * 1973u + y * 9277u + f * 26699u) | 1u;
  return float(pcg(seed)) / 4294967295.0;
}

void main() {
  vec3 color = texture(u_texture, v_uv).rgb;
  
  // Frame number for flickering grain (changes every frame)
  float frame = floor(u_time * 60.0);
  
  // Per-pixel random values that change each frame
  float noiseR = rand(gl_FragCoord.xy, frame) - 0.5;
  float noiseG = rand(gl_FragCoord.xy, frame + 1000.0) - 0.5;
  float noiseB = rand(gl_FragCoord.xy, frame + 2000.0) - 0.5;
  
  // Mostly monochrome with subtle color variation
  float mono = noiseG;
  vec3 grain = vec3(
    mix(mono, noiseR, 0.2),
    mono,
    mix(mono, noiseB, 0.2)
  );
  
  // Intensity based on luminance (more visible in midtones)
  float luma = dot(color, vec3(0.299, 0.587, 0.114));
  float intensity = 0.18 * (1.0 - abs(luma - 0.5) * 0.4);
  
  color += grain * intensity;
  
  fragColor = vec4(color, 1.0);
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
  const outputProgram = linkProgram(gl, VERTEX_SHADER, OUTPUT_FRAGMENT_SHADER);

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

  // Track current theme colors (read from CSS custom properties)
  let themeColors = getThemeColors();

  // Listen for system theme changes
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handleThemeChange = () => {
    // Small delay to allow CSS to update
    requestAnimationFrame(() => {
      themeColors = getThemeColors();
    });
  };
  mediaQuery.addEventListener("change", handleThemeChange);

  const blurU = {
    texture: gl.getUniformLocation(blurProgram, "u_texture"),
    direction: gl.getUniformLocation(blurProgram, "u_direction"),
    resolution: gl.getUniformLocation(blurProgram, "u_resolution"),
  };

  const outputU = {
    texture: gl.getUniformLocation(outputProgram, "u_texture"),
    time: gl.getUniformLocation(outputProgram, "u_time"),
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

    // Pass 1: Render dots (dynamic bg + colored dots) to fbA
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbA.framebuffer);
    gl!.viewport(0, 0, width, height);
    gl!.useProgram(dotProgram);
    gl!.uniform1f(dotU.time, time);
    gl!.uniform2f(dotU.resolution, width, height);
    gl!.uniform3f(dotU.bgColor, themeColors.bg[0], themeColors.bg[1], themeColors.bg[2]);
    gl!.uniform3f(dotU.dotColor, themeColors.dot[0], themeColors.dot[1], themeColors.dot[2]);

    for (let i = 0; i < DOT_COUNT; i++) {
      gl!.uniform3f(dotU.dotCenter[i], dots[i].centerX, dots[i].centerY, dots[i].orbitRadius);
      gl!.uniform4f(dotU.dotParams[i], dots[i].startAngle, dots[i].speed, dots[i].opacity, dots[i].dotRadius);
    }
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);

    // Pass 2: Add noise to dots (fbA → fbB)
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbB.framebuffer);
    gl!.viewport(0, 0, width, height);
    gl!.useProgram(outputProgram);
    gl!.uniform1i(outputU.texture, 0);
    gl!.uniform1f(outputU.time, time);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, fbA.texture);
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);

    // Pass 3: Multi-pass Gaussian blur on noisy image
    gl!.useProgram(blurProgram);
    gl!.uniform1i(blurU.texture, 0);
    gl!.uniform2f(blurU.resolution, width, height);

    // Source for first blur pass is the noisy render (fbB)
    let readTex = fbB.texture;

    for (let p = 0; p < BLUR_PASSES; p++) {
      // Horizontal pass → fbC
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbC.framebuffer);
      gl!.viewport(0, 0, width, height);
      gl!.bindTexture(gl!.TEXTURE_2D, readTex);
      gl!.uniform2f(blurU.direction, 1.0, 0.0);
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);

      // Vertical pass → fbA (reuse) or screen on last pass
      const isLast = p === BLUR_PASSES - 1;
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, isLast ? null : fbA.framebuffer);
      gl!.viewport(0, 0, width, height);
      gl!.bindTexture(gl!.TEXTURE_2D, fbC.texture);
      gl!.uniform2f(blurU.direction, 0.0, 1.0);
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);

      // Next iteration reads from fbA
      readTex = fbA.texture;
    }

    animationId = requestAnimationFrame(render);
  }

  animationId = requestAnimationFrame(render);

  return () => {
    cancelAnimationFrame(animationId);
    mediaQuery.removeEventListener("change", handleThemeChange);
  };
}
