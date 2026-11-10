// Home-page intro: a glass ring floats over the name and bends it.
// Scrolling flies the camera through the ring and lands on the statement.
//
// Drawn with plain WebGL and no library, so there is nothing large to download
// before the ring can appear. <html> gets .gl from a small inline script as soon
// as the page starts loading (pinned layout, plain name); .gl-ready is added here
// once the first frame is drawn. If WebGL is unavailable, both are removed and
// the plain intro stays.

const root = document.documentElement;
const intro = document.querySelector('.intro');
const stage = document.querySelector('.intro-stage');
const canvas = document.querySelector('.intro-canvas');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const CAMERA_Z = 6;
const FOV = 35;
const RING_RADIUS = 1.15;
const TUBE_RADIUS = 0.27;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const range = (v, a, b) => clamp01((v - a) / (b - a));
const ease = (t) => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;

// ── Shaders ──────────────────────────────────────────────────────────────
// The wall: the painted name, stretched over the whole canvas.
const WALL_VERTEX = `
attribute vec2 aCorner;
varying vec2 vUv;
void main() {
  vUv = aCorner * 0.5 + 0.5;
  gl_Position = vec4(aCorner, 0.0, 1.0);
}`;

const WALL_FRAGMENT = `
precision mediump float;
uniform sampler2D uPaper;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uPaper, vUv);
}`;

// The ring: each pixel looks up the wall where a ray bent by the glass would land.
const RING_VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
uniform mat4 uModel;
uniform mat4 uViewProjection;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uViewProjection * world;
}`;

const RING_FRAGMENT = `
precision highp float;
uniform sampler2D uPaper;
uniform mat4 uViewProjection;
uniform vec3 uCamera;
uniform float uThickness;
varying vec3 vWorld;
varying vec3 vNormal;

// Where on the wall a ray lands after bending through glass of the given density.
vec2 bend(vec3 view, vec3 normal, float density) {
  vec3 direction = refract(-view, normal, 1.0 / density);
  vec4 clip = uViewProjection * vec4(vWorld + direction * uThickness, 1.0);
  return clip.xy / clip.w * 0.5 + 0.5;
}

// A soft studio: one large light overhead, a strip to the side, a dim floor.
vec3 studio(vec3 r) {
  float overhead = smoothstep(0.35, 0.95, r.y);
  float strip = smoothstep(0.72, 0.96, r.x) * smoothstep(-0.4, 0.3, r.y);
  float floorGlow = smoothstep(-0.2, -0.9, r.y) * 0.35;
  return vec3(0.60, 0.56, 0.53) + vec3(1.0, 0.98, 0.95) * (overhead * 0.75 + strip * 0.6) + vec3(0.9, 0.8, 0.72) * floorGlow;
}

void main() {
  vec3 normal = normalize(vNormal);
  vec3 view = normalize(uCamera - vWorld);
  float facing = max(dot(normal, view), 0.0);

  // Red, green and blue bend by slightly different amounts, which gives the colour fringes.
  vec3 through = vec3(
    texture2D(uPaper, bend(view, normal, 1.385)).r,
    texture2D(uPaper, bend(view, normal, 1.42)).g,
    texture2D(uPaper, bend(view, normal, 1.46)).b
  );
  through = mix(through, vec3(1.0, 0.975, 0.955), 0.03);

  float fresnel = 0.03 + 0.97 * pow(1.0 - facing, 5.0);
  vec3 reflected = studio(reflect(-view, normal));
  vec3 colour = mix(through, reflected, fresnel * 0.7);

  // Sharp highlights from two lights.
  vec3 keyHalf = normalize(normalize(vec3(0.45, 0.75, 0.6)) + view);
  vec3 fillHalf = normalize(normalize(vec3(-0.6, -0.35, 0.7)) + view);
  colour += vec3(1.0) * pow(max(dot(normal, keyHalf), 0.0), 140.0) * 0.9;
  colour += vec3(1.0, 0.96, 0.92) * pow(max(dot(normal, fillHalf), 0.0), 60.0) * 0.22;

  gl_FragColor = vec4(colour, 1.0);
}`;

// ── Small matrix helpers (column-major, like WebGL) ──────────────────────
function perspective(fovDegrees, aspect, near, far) {
  const f = 1 / Math.tan((fovDegrees * Math.PI) / 360);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

function multiply(a, b) {
  const m = new Float32Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
      m[column * 4 + row] = sum;
    }
  }
  return m;
}

function translation(x, y, z) {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

// Position, rotation (x, then y, then z) and uniform scale in one matrix.
function placement(px, py, pz, rx, ry, rz, scale) {
  const a = Math.cos(rx), b = Math.sin(rx);
  const c = Math.cos(ry), d = Math.sin(ry);
  const e = Math.cos(rz), f = Math.sin(rz);
  const m = new Float32Array(16);
  m[0] = c * e * scale;
  m[1] = (a * f + b * e * d) * scale;
  m[2] = (b * f - a * e * d) * scale;
  m[4] = -c * f * scale;
  m[5] = (a * e - b * f * d) * scale;
  m[6] = (b * e + a * f * d) * scale;
  m[8] = d * scale;
  m[9] = -b * c * scale;
  m[10] = a * c * scale;
  m[12] = px;
  m[13] = py;
  m[14] = pz;
  m[15] = 1;
  return m;
}

function buildRing(radius, tube, aroundSegments, tubeSegments) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let j = 0; j <= tubeSegments; j++) {
    const v = (j / tubeSegments) * Math.PI * 2;
    for (let i = 0; i <= aroundSegments; i++) {
      const u = (i / aroundSegments) * Math.PI * 2;
      const nx = Math.cos(v) * Math.cos(u);
      const ny = Math.cos(v) * Math.sin(u);
      const nz = Math.sin(v);
      positions.push(radius * Math.cos(u) + tube * nx, radius * Math.sin(u) + tube * ny, tube * nz);
      normals.push(nx, ny, nz);
    }
  }
  const row = aroundSegments + 1;
  for (let j = 0; j < tubeSegments; j++) {
    for (let i = 0; i < aroundSegments; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  };
}

function buildProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  return program;
}

// ── Scene ────────────────────────────────────────────────────────────────
function start() {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL is not available');
  root.classList.add('gl');

  const wallProgram = buildProgram(gl, WALL_VERTEX, WALL_FRAGMENT);
  const ringProgram = buildProgram(gl, RING_VERTEX, RING_FRAGMENT);

  const corners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  const ring = buildRing(RING_RADIUS, TUBE_RADIUS, 200, 64);
  const ringPositions = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, ringPositions);
  gl.bufferData(gl.ARRAY_BUFFER, ring.positions, gl.STATIC_DRAW);
  const ringNormals = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, ringNormals);
  gl.bufferData(gl.ARRAY_BUFFER, ring.normals, gl.STATIC_DRAW);
  const ringIndices = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ringIndices);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ring.indices, gl.STATIC_DRAW);

  const where = {
    wallCorner: gl.getAttribLocation(wallProgram, 'aCorner'),
    wallPaper: gl.getUniformLocation(wallProgram, 'uPaper'),
    ringPosition: gl.getAttribLocation(ringProgram, 'aPosition'),
    ringNormal: gl.getAttribLocation(ringProgram, 'aNormal'),
    ringModel: gl.getUniformLocation(ringProgram, 'uModel'),
    ringViewProjection: gl.getUniformLocation(ringProgram, 'uViewProjection'),
    ringCamera: gl.getUniformLocation(ringProgram, 'uCamera'),
    ringThickness: gl.getUniformLocation(ringProgram, 'uThickness'),
    ringPaper: gl.getUniformLocation(ringProgram, 'uPaper'),
  };

  // The name is painted on a 2D canvas and used as the wall behind the glass.
  const paper = document.createElement('canvas');
  const paperTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, paperTexture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  function paintPaper() {
    const W = paper.width;
    const H = paper.height;
    const ctx = paper.getContext('2d');
    const css = getComputedStyle(root);

    ctx.fillStyle = css.getPropertyValue('--bg').trim() || '#fdf8f2';
    ctx.fillRect(0, 0, W, H);

    // Soft colour patches so the glass has something to bend besides the letters.
    const patches = [
      [0.16, 0.2, 'rgba(200, 86, 56, 0.30)'],
      [0.84, 0.74, 'rgba(77, 124, 111, 0.28)'],
      [0.8, 0.14, 'rgba(240, 190, 90, 0.32)'],
      [0.2, 0.84, 'rgba(140, 110, 210, 0.22)'],
    ];
    const reach = Math.max(W, H) * 0.5;
    for (const [x, y, colour] of patches) {
      const g = ctx.createRadialGradient(x * W, y * H, 0, x * W, y * H, reach);
      g.addColorStop(0, colour);
      g.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // Size the name to fill most of the width, whatever the screen shape.
    let size = Math.min(W * 0.3, H * 0.3);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = css.getPropertyValue('--text').trim() || '#1a1210';
    ctx.font = `400 ${size}px "Playfair Display", serif`;
    const widest = W * 0.8;
    const measured = ctx.measureText('Kelsey').width;
    if (measured > widest) size *= widest / measured;
    ctx.font = `400 ${size}px "Playfair Display", serif`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${-size * 0.03}px`;
    ctx.fillText('Kelsey', W / 2, H * 0.5 + size * 0.22);

    const small = Math.max(size * 0.13, H * 0.018);
    ctx.fillStyle = css.getPropertyValue('--coral').trim() || '#c85638';
    ctx.font = `italic 400 ${small}px "Playfair Display", "Songti SC", serif`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${small * 0.5}px`;
    ctx.fillText('王佳宜', W / 2 + small * 0.25, H * 0.5 + size * 0.22 + small * 2.3);

    gl.bindTexture(gl.TEXTURE_2D, paperTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paper);
  }

  const view = translation(0, 0, -CAMERA_Z);
  let viewProjection = view;
  let ringScale = 1;
  let lastWidth = 0;
  let lastHeight = 0;

  function resize() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    // Phone browsers fire resize whenever the address bar slides; skip if nothing changed.
    if (!width || !height || (width === lastWidth && height === lastHeight)) return;
    lastWidth = width;
    lastHeight = height;

    // Phones have dense screens and weaker graphics chips, so draw fewer pixels there.
    const density = Math.min(window.devicePixelRatio || 1, width <= 700 ? 1.5 : 2);
    canvas.width = Math.round(width * density);
    canvas.height = Math.round(height * density);
    gl.viewport(0, 0, canvas.width, canvas.height);

    const aspect = width / height;
    viewProjection = multiply(perspective(FOV, aspect, 0.05, 50), view);
    ringScale = Math.min(1, Math.max(0.42, aspect * 0.62));

    const paperScale = Math.min(2, window.devicePixelRatio || 1) * Math.min(1, 2048 / width);
    paper.width = Math.round(width * paperScale);
    paper.height = Math.round(height * paperScale);
    paintPaper();
  }

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener('pointermove', (event) => {
    pointer.tx = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (event.clientY / window.innerHeight) * 2 - 1;
  });

  let progress = 0;
  let elapsed = 0;
  let last = performance.now();
  let visible = true;
  let alive = true;
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(intro);

  function draw() {
    const now = performance.now();
    const rawDt = (now - last) / 1000;
    const dt = Math.min(rawDt, 0.1);
    last = now;

    // Smooth by elapsed time, not by frame count, so slow devices keep up with the scroll.
    const track = intro.offsetHeight - window.innerHeight;
    const target = clamp01(window.scrollY / Math.max(1, track));
    progress += (target - progress) * (1 - Math.exp(-rawDt * 7));
    if (Math.abs(target - progress) < 0.0005) progress = target;

    pointer.x += (pointer.tx - pointer.x) * (1 - Math.exp(-dt * 3));
    pointer.y += (pointer.ty - pointer.y) * (1 - Math.exp(-dt * 3));

    elapsed += dt;
    const t = reducedMotion ? 0 : elapsed;
    const fly = ease(range(progress, 0.08, 0.66));

    // Idle: the ring tumbles slowly and leans toward the pointer.
    const idleX = 0.55 + Math.sin(t * 0.37) * 0.3 + pointer.y * 0.35;
    const idleY = -0.5 + t * 0.22 + pointer.x * 0.5;
    // Fly-through: it squares up to the camera and passes around it.
    const turn = Math.round(idleY / Math.PI) * Math.PI;
    const scale = ringScale * mix(1, 1.25, fly);
    const model = placement(
      mix(0.28 + pointer.x * 0.25, 0, fly) * ringScale,
      mix(Math.sin(t * 0.5) * 0.08 - pointer.y * 0.15, 0, fly),
      mix(0, CAMERA_Z + 0.9, ease(range(progress, 0.12, 0.7))),
      mix(idleX, 0, fly),
      mix(idleY, turn, fly),
      Math.sin(t * 0.2) * 0.1 * (1 - fly),
      scale
    );

    stage.style.setProperty('--chrome-opacity', (1 - range(progress, 0, 0.12)).toFixed(3));
    stage.style.setProperty('--canvas-opacity', (1 - range(progress, 0.62, 0.78)).toFixed(3));
    stage.style.setProperty('--statement-opacity', ease(range(progress, 0.68, 0.86)).toFixed(3));

    if (progress >= 0.8) return;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, paperTexture);

    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(wallProgram);
    gl.uniform1i(where.wallPaper, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.enableVertexAttribArray(where.wallCorner);
    gl.vertexAttribPointer(where.wallCorner, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(ringProgram);
    gl.uniform1i(where.ringPaper, 0);
    gl.uniformMatrix4fv(where.ringModel, false, model);
    gl.uniformMatrix4fv(where.ringViewProjection, false, viewProjection);
    gl.uniform3f(where.ringCamera, 0, 0, CAMERA_Z);
    gl.uniform1f(where.ringThickness, 0.9 * scale);
    gl.bindBuffer(gl.ARRAY_BUFFER, ringPositions);
    gl.enableVertexAttribArray(where.ringPosition);
    gl.vertexAttribPointer(where.ringPosition, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, ringNormals);
    gl.enableVertexAttribArray(where.ringNormal);
    gl.vertexAttribPointer(where.ringNormal, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ringIndices);
    gl.drawElements(gl.TRIANGLES, ring.indices.length, gl.UNSIGNED_SHORT, 0);
  }

  function frame() {
    if (!alive) return;
    requestAnimationFrame(frame);
    if (visible) draw();
  }

  // If the phone reclaims graphics memory, fall back to the plain intro.
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    alive = false;
    root.classList.remove('gl', 'gl-ready');
  });

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  // Catches size changes that arrive without a window resize event, such as rotation.
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(stage);

  // The web font may arrive after the first paint; repaint the name when it does.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { if (alive && paper.width) paintPaper(); });
  }

  resize();
  draw();
  root.classList.add('gl-ready');
  frame();
}

function begin() {
  try {
    start();
  } catch (error) {
    root.classList.remove('gl', 'gl-ready');
    console.warn('Intro scene unavailable, showing the plain intro.', error);
  }
}

if (intro && canvas) {
  // Give the display font a brief head start so the name is painted in the right
  // typeface, but never hold the ring back for it.
  const fonts = document.fonts
    ? Promise.all([
        document.fonts.load('400 100px "Playfair Display"'),
        document.fonts.load('italic 400 40px "Playfair Display"'),
      ]).catch(() => {})
    : Promise.resolve();
  const briefWait = new Promise((resolve) => setTimeout(resolve, 400));
  Promise.race([fonts, briefWait]).then(begin);
}
