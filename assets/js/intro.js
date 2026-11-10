// Home-page intro: a glass ring floats over the name and bends it.
// Scrolling flies the camera through the ring and lands on the statement.
// If WebGL or the library is unavailable, nothing here runs and the plain intro stays.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const intro = document.querySelector('.intro');
const stage = document.querySelector('.intro-stage');
const canvas = document.querySelector('.intro-canvas');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const CAMERA_Z = 6;
const PLANE_Z = -2;
const FOV = 35;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const range = (v, a, b) => clamp01((v - a) / (b - a));
const ease = (t) => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;

function start() {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  // Phones have dense screens and weaker graphics chips, so draw fewer pixels there.
  const small = window.matchMedia('(max-width: 700px)').matches;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, small ? 1.5 : 2));

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 50);
  camera.position.z = CAMERA_Z;

  // The name is painted on a 2D canvas and used as the wall behind the glass.
  const paper = document.createElement('canvas');
  const paperTexture = new THREE.CanvasTexture(paper);
  paperTexture.colorSpace = THREE.SRGBColorSpace;
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: paperTexture, toneMapped: false })
  );
  wall.position.z = PLANE_Z;
  scene.add(wall);

  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transmission: 1,
    thickness: 0.9,
    ior: 1.42,
    roughness: 0.03,
    metalness: 0,
    dispersion: 5,
    envMapIntensity: 0.32,
    attenuationColor: new THREE.Color(0xf6dccd),
    attenuationDistance: 6,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.27, 96, 240), glass);
  scene.add(ring);

  const key = new THREE.DirectionalLight(0xfff1e2, 2.2);
  key.position.set(3, 4, 6);
  scene.add(key);

  function paintPaper(width, height) {
    const scale = Math.min(2, window.devicePixelRatio) * Math.min(1, 2048 / width);
    paper.width = Math.round(width * scale);
    paper.height = Math.round(height * scale);
    const ctx = paper.getContext('2d');
    const W = paper.width;
    const H = paper.height;
    const css = getComputedStyle(document.documentElement);

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

    paperTexture.needsUpdate = true;
  }

  let ringScale = 1;
  let lastWidth = 0;
  let lastHeight = 0;
  function resize() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    // Phone browsers fire resize whenever the address bar slides; skip if nothing changed.
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    const depth = CAMERA_Z - PLANE_Z;
    const wallHeight = 2 * depth * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    wall.scale.set(wallHeight * camera.aspect, wallHeight, 1);

    ringScale = Math.min(1, Math.max(0.42, camera.aspect * 0.62));
    paintPaper(width, height);
  }

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener('pointermove', (event) => {
    pointer.tx = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (event.clientY / window.innerHeight) * 2 - 1;
  });

  let progress = 0;
  let visible = true;
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(intro);

  const clock = new THREE.Clock();
  let elapsed = 0;
  function frame() {
    if (!alive) return;
    requestAnimationFrame(frame);
    if (!visible) return;

    const track = intro.offsetHeight - window.innerHeight;
    const target = clamp01(window.scrollY / Math.max(1, track));
    // Smooth by elapsed time, not by frame count, so slow devices keep up with the scroll.
    const rawDt = clock.getDelta();
    const dt = Math.min(rawDt, 0.1);
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
    ring.rotation.x = mix(idleX, 0, fly);
    ring.rotation.y = mix(idleY, turn, fly);
    ring.rotation.z = Math.sin(t * 0.2) * 0.1 * (1 - fly);
    ring.position.x = mix(0.28 + pointer.x * 0.25, 0, fly) * ringScale;
    ring.position.y = mix(Math.sin(t * 0.5) * 0.08 - pointer.y * 0.15, 0, fly);
    ring.position.z = mix(0, CAMERA_Z + 0.9, ease(range(progress, 0.12, 0.7)));
    ring.scale.setScalar(ringScale * mix(1, 1.25, fly));

    stage.style.setProperty('--chrome-opacity', (1 - range(progress, 0, 0.12)).toFixed(3));
    stage.style.setProperty('--canvas-opacity', (1 - range(progress, 0.62, 0.78)).toFixed(3));
    stage.style.setProperty('--statement-opacity', ease(range(progress, 0.68, 0.86)).toFixed(3));

    if (progress < 0.8) renderer.render(scene, camera);
  }

  // If the phone reclaims graphics memory, fall back to the plain intro.
  let alive = true;
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    alive = false;
    document.documentElement.classList.remove('gl-ready');
  });

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  document.documentElement.classList.add('gl-ready');
  resize();
  frame();
}

if (intro && canvas) {
  // Wait for the display font so the name is painted in the right typeface.
  const fonts = [
    document.fonts.load('400 100px "Playfair Display"'),
    document.fonts.load('italic 400 40px "Playfair Display"'),
  ];
  Promise.all(fonts).catch(() => {}).then(() => {
    try {
      start();
    } catch (error) {
      document.documentElement.classList.remove('gl-ready');
      console.warn('Intro scene unavailable, showing the plain intro.', error);
    }
  });
}
