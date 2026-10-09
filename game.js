import * as THREE from './vendor/three.module.min.js';

// ---------------- constants ----------------
const IMG_W = 800, IMG_H = 1328;
const H0 = 3.0;                 // base height of the woman (m) — player eye is 0.85m
const K = H0 / IMG_H;           // world units per texture pixel
const BELLY = { x0: 40, y0: 320, w: 730, h: 650, bottomPx: 950 };
const FACE = { x: 360, y: 30, w: 96, h: 80 };
const EYE_H = 0.85;
const PLAYER_SPEED = 5.2;
const WORLD_HALF = 125;
const TAPS_TO_ESCAPE = 12;
const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;

const $ = id => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = arr => arr[(Math.random() * arr.length) | 0];

// ---------------- renderer / scene ----------------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.6 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfe3ff);
scene.fog = new THREE.Fog(0xcfe8ff, 60, 210);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 600);
scene.add(new THREE.HemisphereLight(0xffffff, 0x88aa77, 1.6));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.6); sun.position.set(40, 80, 20); scene.add(sun);

// sky dome gradient
{
  const g = new THREE.SphereGeometry(500, 24, 12);
  const m = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vp; void main(){ vp=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'varying vec3 vp; void main(){ float h=normalize(vp).y; vec3 c=mix(vec3(0.80,0.92,1.0),vec3(0.30,0.60,0.98),clamp(h*1.5,0.,1.)); gl_FragColor=vec4(c,1.); }' });
  scene.add(new THREE.Mesh(g, m));
}

// ---------------- textures ----------------
const loader = new THREE.TextureLoader();
function loadTex(url) {
  return new Promise((res, rej) => loader.load(url, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; res(t); }, undefined, rej));
}
function loadImg(url) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); }

const FACE_NAMES = ['normal', 'smile', 'happy', 'pout', 'angry', 'tapped', 'surprised', 'smile_talk', 'pout_talk', 'normal_talk', 'normal_blink', 'smile_blink', 'pout_blink', 'angry_blink'];

// ---------------- materials with vertex animation ----------------
function makeBodyMaterial(tex) {
  const u = { uPhase: { value: 0 }, uSkirt: { value: 0 }, uLift: { value: 0 }, uTilt: { value: 0 } };
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, alphaTest: 0.02, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'uniform float uPhase,uSkirt,uLift,uTilt;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      vec3 transformed = vec3(position);
      float vv = 1.0 - uv.y; float uu = uv.x;
      float t = clamp((vv-0.70)/0.30,0.,1.); float t2 = t*t;
      float s = sin(uPhase);
      float L = smoothstep(0.58,0.22,uu), R = smoothstep(0.42,0.78,uu);
      float stepL = max(0.,s), stepR = max(0.,-s);
      transformed.x += s*uSkirt*t2*${(IMG_W * K).toFixed(4)};
      transformed.y += (stepL*L + stepR*R)*uLift*t2*${(IMG_H * K).toFixed(4)};
      transformed.x += (-stepL*L + stepR*R)*uLift*0.45*t2*${(IMG_W * K).toFixed(4)};
      float up = clamp((0.36-vv)/0.36,0.,1.);
      transformed.x += s*uTilt*up*${(IMG_W * K).toFixed(4)};
    `);
  };
  return { m, u };
}
function makeBellyMaterial(tex, H) {
  const u = { uSquash: { value: 0 }, uSway: { value: 0 }, uTime: { value: 0 }, uWob: { value: 0 }, uTap: { value: new THREE.Vector2(0, -H * 0.6) }, uTapAmt: { value: 0 }, uTapR: { value: H * 0.25 }, uH: { value: H } };
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, alphaTest: 0.02, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'uniform float uSquash,uSway,uTime,uWob,uTapAmt,uTapR,uH; uniform vec2 uTap; varying float vDent;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      vec3 transformed = vec3(position);
      float w = clamp(-position.y/uH,0.,1.);
      float wf = smoothstep(0.0,1.0,w);
      float c = 1.0 - abs(position.x)/(uH*0.6);
      transformed.y *= (1.0 - uSquash*wf*0.85);
      transformed.x *= (1.0 + uSquash*0.55*wf);
      transformed.x += uSway*wf*wf*uH;
      transformed.y += sin(uTime*10.0 - w*3.2)*uWob*uH*wf*clamp(c,0.3,1.0);
      transformed.x += sin(uTime*8.0 - w*2.5)*uWob*0.5*uH*wf*sign(position.x)*0.6;
      vec2 d = position.xy - uTap; float r2 = dot(d,d)/(uTapR*uTapR);
      float f = exp(-r2)*uTapAmt;
      transformed.xy -= d*f*0.18;
      vDent = f;
    `);
    sh.fragmentShader = 'varying float vDent;\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb *= (1.0 - vDent*0.16);');
  };
  return { m, u };
}

// ---------------- the stalker ----------------
const her = {
  group: new THREE.Group(), pos: new THREE.Vector3(0, 0, -35), phase: 0, speed: 0,
  stage: 0, stageVis: 0, stageVel: 0, frustration: 0,
  jig: { sq: 0, sqV: 0, sw: 0, swV: 0, wob: 0 }, dash: 0, dashCd: 6, stun: 0,
  face: 'smile', faceShown: 'smile', faceT: 1, blinkT: 3, blinking: 0, surprised: 0, pout: 0, tapped: 0,
  R: 1, bx: 1, by: 1, S: 1, lift: 0,
};
let bodyMat, bellyMat, faceA, faceB, faceTex = {}, bodyMesh, bellyMesh, faceMeshA, faceMeshB, shadow;
let restrain = null; // restraint scene objects
let bodyImg, faceImgs = {};

async function buildHer() {
  const [bodyT, bellyT] = await Promise.all([loadTex('assets/body.png'), loadTex('assets/belly.png')]);
  bodyImg = await loadImg('assets/body.png');
  await Promise.all(FACE_NAMES.map(async n => { faceTex[n] = await loadTex(`assets/face_${n}.png`); faceImgs[n] = await loadImg(`assets/face_${n}.png`); }));
  const W = IMG_W * K, H = IMG_H * K;
  const bg = new THREE.PlaneGeometry(W, H, 20, 40); bg.translate(0, H / 2, 0);
  const bm = makeBodyMaterial(bodyT); bodyMat = bm;
  bodyMesh = new THREE.Mesh(bg, bm.m); bodyMesh.renderOrder = 10;
  // belly
  const bw = BELLY.w * K, bh = BELLY.h * K;
  const gg = new THREE.PlaneGeometry(bw, bh, 28, 28); gg.translate(0, -bh / 2, 0);
  bellyMat = makeBellyMaterial(bellyT, bh);
  bellyMesh = new THREE.Mesh(gg, bellyMat.m); bellyMesh.renderOrder = 12;
  bellyMesh.position.set((BELLY.x0 + BELLY.w / 2 - IMG_W / 2) * K, (IMG_H - BELLY.y0) * K, 0.03);
  // face (two stacked planes for crossfade)
  const fg = new THREE.PlaneGeometry(FACE.w * K, FACE.h * K);
  const fx = (FACE.x + FACE.w / 2 - IMG_W / 2) * K, fy = (IMG_H - FACE.y - FACE.h / 2) * K;
  faceA = new THREE.MeshBasicMaterial({ map: faceTex.smile, transparent: true, depthWrite: false });
  faceB = new THREE.MeshBasicMaterial({ map: faceTex.smile, transparent: true, depthWrite: false, opacity: 0 });
  faceMeshA = new THREE.Mesh(fg, faceA); faceMeshA.position.set(fx, fy, 0.01); faceMeshA.renderOrder = 11;
  faceMeshB = new THREE.Mesh(fg, faceB); faceMeshB.position.set(fx, fy, 0.015); faceMeshB.renderOrder = 11.5;
  faceMeshA.userData.x0 = fx; faceMeshB.userData.x0 = fx; bellyMesh.userData.x0 = bellyMesh.position.x;
  her.inner = new THREE.Group();
  her.inner.add(bodyMesh, faceMeshA, faceMeshB, bellyMesh);
  her.group.add(her.inner);
  scene.add(her.group);
  // soft ground shadow
  const sc = document.createElement('canvas'); sc.width = sc.height = 128;
  const sx = sc.getContext('2d'); const gr = sx.createRadialGradient(64, 64, 4, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); sx.fillStyle = gr; sx.fillRect(0, 0, 128, 128);
  shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.03; scene.add(shadow);
  buildRestrain(bellyT, bodyT);
}

function setFace(name) {
  if (name === her.faceShown && her.faceT >= 1) return;
  if (name === her.face) return;
  her.face = name;
  faceA.map = faceTex[her.faceShown]; faceA.needsUpdate = true;
  faceB.map = faceTex[name]; faceB.opacity = 0; faceB.needsUpdate = true;
  her.faceT = 0;
}
function setFaceInstant(name) {
  her.face = her.faceShown = name; her.faceT = 1;
  faceA.map = faceTex[name]; faceB.opacity = 0;
}

// ---------------- town ----------------
const buildings = [];
const solid = []; // collision AABBs (intact)
function windowTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 64);
  x.fillStyle = '#8fb6d9'; x.fillRect(16, 14, 32, 30);
  x.fillStyle = '#d8ecff'; x.fillRect(18, 16, 13, 12);
  x.strokeStyle = '#ffffff'; x.lineWidth = 3; x.strokeRect(16, 14, 32, 30); x.beginPath(); x.moveTo(32, 14); x.lineTo(32, 44); x.stroke();
  x.fillStyle = 'rgba(0,0,0,.06)'; x.fillRect(0, 58, 64, 6);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const winTex = windowTexture();
const WALL_COLORS = [0xfff1e0, 0xffe0e6, 0xe6f2ff, 0xf3ffe0, 0xfff7c2, 0xe9e1ff, 0xffd9b8, 0xdff7f1];
const ROOF_COLORS = [0xd9534f, 0x8e5a3c, 0x4f6fb0, 0x5e8f4a, 0x9b4f8e];
const wallMats = WALL_COLORS.map(c => new THREE.MeshLambertMaterial({ color: c, map: winTex }));
const roofMats = ROOF_COLORS.map(c => new THREE.MeshLambertMaterial({ color: c }));
const roofGeo = new THREE.ConeGeometry(1, 1, 4, 1); roofGeo.rotateY(Math.PI / 4); roofGeo.translate(0, 0.5, 0);

function boxWithUV(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    const sx = nx > 0.5 ? d : w, sy = ny > 0.5 ? d : h;
    uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(sx / 3)), ny > 0.5 ? 0.1 : uv.getY(i) * Math.max(1, Math.round(sy / 3)));
  }
  return g;
}
function addBuilding(x, z, w, d, h, house) {
  const g = new THREE.Group();
  const wi = (Math.random() * wallMats.length) | 0;
  const body = new THREE.Mesh(boxWithUV(w, h, d), wallMats[wi]); body.position.y = h / 2; g.add(body);
  let rh = 0, ri = 0;
  if (house) {
    rh = Math.min(w, d) * 0.45; ri = (Math.random() * roofMats.length) | 0;
    const r = new THREE.Mesh(roofGeo, roofMats[ri]); r.scale.set(w * 0.75, rh, d * 0.75); r.position.y = h; g.add(r);
  }
  g.position.set(x, 0, z); scene.add(g);
  const b = { g, x, z, w, d, h: h + rh, alive: true, deadT: 0, wallColor: WALL_COLORS[wi], roofColor: house ? ROOF_COLORS[ri] : WALL_COLORS[wi], grow: 1 };
  buildings.push(b);
}
function buildTown() {
  // ground
  const gc = document.createElement('canvas'); gc.width = gc.height = 256; const gx = gc.getContext('2d');
  gx.fillStyle = '#8fcf6e'; gx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) { gx.fillStyle = Math.random() < .5 ? 'rgba(60,120,40,.18)' : 'rgba(200,255,170,.18)'; gx.fillRect(Math.random() * 256, Math.random() * 256, 2, 5); }
  const gt = new THREE.CanvasTexture(gc); gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(80, 80); gt.colorSpace = THREE.SRGBColorSpace; gt.anisotropy = 8;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshLambertMaterial({ map: gt }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x8a8d96 });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xfafafa });
  const BLOCK = 34, ROAD = 8;
  for (let i = -4; i <= 4; i++) {
    const p = i * BLOCK;
    for (const horiz of [0, 1]) {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(horiz ? 2 * WORLD_HALF + 20 : ROAD, horiz ? ROAD : 2 * WORLD_HALF + 20), roadMat);
      r.rotation.x = -Math.PI / 2; r.position.set(horiz ? 0 : p, 0.01 + horiz * 0.002, horiz ? p : 0); scene.add(r);
      const l = new THREE.Mesh(new THREE.PlaneGeometry(horiz ? 2 * WORLD_HALF + 20 : 0.25, horiz ? 0.25 : 2 * WORLD_HALF + 20), lineMat);
      l.rotation.x = -Math.PI / 2; l.position.set(horiz ? 0 : p, 0.02, horiz ? p : 0); scene.add(l);
    }
  }
  // buildings inside blocks
  for (let bx = -4; bx < 4; bx++) for (let bz = -4; bz < 4; bz++) {
    const cx = bx * BLOCK + BLOCK / 2, cz = bz * BLOCK + BLOCK / 2;
    if (Math.hypot(cx, cz) < 20) continue; // open plaza at spawn
    const inner = BLOCK - ROAD - 2;
    const n = Math.random() < 0.3 ? 1 : 4;
    if (n === 1) {
      const tall = Math.random() < 0.5;
      addBuilding(cx, cz, rand(10, 15), rand(10, 15), tall ? rand(14, 26) : rand(7, 10), !tall);
    } else {
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        if (Math.random() < 0.15) continue;
        const w = rand(6, 9), d = rand(6, 9);
        addBuilding(cx + ox * inner / 4, cz + oz * inner / 4, w, d, rand(3.5, 6.5), Math.random() < 0.8);
      }
    }
  }
  // trees along edge (decor, non-solid)
  const trunkG = new THREE.CylinderGeometry(0.25, 0.35, 2, 6), leafG = new THREE.IcosahedronGeometry(1.6, 0);
  const trunkM = new THREE.MeshLambertMaterial({ color: 0x7a5434 }), leafM = new THREE.MeshLambertMaterial({ color: 0x4f9e4a, flatShading: true });
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2, r = WORLD_HALF + rand(4, 12);
    const t = new THREE.Mesh(trunkG, trunkM); t.position.set(Math.cos(a) * r, 1, Math.sin(a) * r);
    const l = new THREE.Mesh(leafG, leafM); l.position.set(t.position.x, 3, t.position.z); l.scale.setScalar(rand(0.9, 1.5));
    scene.add(t, l);
  }
}

// ---------------- debris (instanced) ----------------
const DEBRIS_MAX = 700;
const debrisMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), DEBRIS_MAX);
debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); debrisMesh.frustumCulled = false; scene.add(debrisMesh);
const debris = []; let debrisNext = 0;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler(), _col = new THREE.Color();
for (let i = 0; i < DEBRIS_MAX; i++) { debris.push({ life: 0 }); debrisMesh.setMatrixAt(i, _m.makeScale(0, 0, 0)); debrisMesh.setColorAt(i, _col.set(0xffffff)); }
const dustTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 2, 32, 32, 32); g.addColorStop(0, 'rgba(235,225,210,.9)'); g.addColorStop(1, 'rgba(235,225,210,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const dusts = [];
for (let i = 0; i < 40; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTex, transparent: true, depthWrite: false, opacity: 0 })); s.visible = false; scene.add(s); dusts.push({ s, life: 0 }); }

function breakBuilding(b, fromX, fromZ, power) {
  b.alive = false; b.deadT = 0; b.g.visible = false;
  const n = clamp(Math.round(b.w * b.d * b.h / 12), 18, 70);
  for (let i = 0; i < n; i++) {
    const p = debris[debrisNext]; const idx = debrisNext; debrisNext = (debrisNext + 1) % DEBRIS_MAX;
    const sz = rand(0.5, 1.0) * Math.min(1.8, Math.cbrt(b.w * b.d * b.h / n) * 0.7);
    p.idx = idx; p.life = rand(6, 9); p.sz = sz;
    p.x = b.x + rand(-b.w / 2, b.w / 2); p.y = rand(0.3, b.h); p.z = b.z + rand(-b.d / 2, b.d / 2);
    const dx = p.x - fromX, dz = p.z - fromZ, dl = Math.hypot(dx, dz) || 1;
    const sp = rand(4, 11) * power;
    p.vx = dx / dl * sp + rand(-2, 2); p.vz = dz / dl * sp + rand(-2, 2); p.vy = rand(3, 10) * Math.min(power, 1.6);
    p.rx = rand(0, 6); p.ry = rand(0, 6); p.rz = rand(0, 6); p.ax = rand(-6, 6); p.ay = rand(-6, 6); p.az = rand(-6, 6);
    p.sx = sz * rand(0.6, 1.4); p.sy = sz * rand(0.5, 1.2); p.sz2 = sz * rand(0.6, 1.4);
    debrisMesh.setColorAt(idx, _col.set(p.y > b.h * 0.85 && Math.random() < 0.6 ? b.roofColor : b.wallColor));
  }
  debrisMesh.instanceColor.needsUpdate = true;
  for (let i = 0; i < 6; i++) {
    const d = dusts.find(d => d.life <= 0); if (!d) break;
    d.life = d.max = rand(1.6, 2.6); d.s.visible = true;
    d.s.position.set(b.x + rand(-b.w / 2, b.w / 2), rand(0.5, b.h * 0.5), b.z + rand(-b.d / 2, b.d / 2));
    d.base = Math.max(b.w, b.h) * rand(0.5, 0.9);
  }
}
function updateDebris(dt) {
  for (const p of debris) {
    if (p.life <= 0) continue;
    p.life -= dt;
    p.vy -= 20 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    const floor = p.sy * 0.5;
    if (p.y < floor) { p.y = floor; p.vy *= -0.3; p.vx *= 0.7; p.vz *= 0.7; p.ax *= 0.7; p.ay *= 0.7; p.az *= 0.7; }
    p.rx += p.ax * dt; p.ry += p.ay * dt; p.rz += p.az * dt;
    const k = p.life < 1 ? Math.max(p.life, 0) : 1;
    _q.setFromEuler(_e.set(p.rx, p.ry, p.rz)); _s.set(p.sx * k, p.sy * k, p.sz2 * k); _p.set(p.x, p.y, p.z);
    debrisMesh.setMatrixAt(p.idx, _m.compose(_p, _q, _s));
  }
  debrisMesh.instanceMatrix.needsUpdate = true;
  for (const d of dusts) {
    if (d.life <= 0) continue;
    d.life -= dt; const t = 1 - d.life / d.max;
    d.s.scale.setScalar(d.base * (0.6 + t * 1.4)); d.s.position.y += dt * 1.2;
    d.s.material.opacity = 0.75 * (1 - t);
    if (d.life <= 0) d.s.visible = false;
  }
}

// ---------------- audio ----------------
let actx = null, master = null, voices = {}, voiceMeta = {}, voiceBusy = 0, lastVoice = '', analyser = null, anaBuf = null, voiceSrc = null;
async function initAudio() {
  actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') await actx.resume();
  master = actx.createGain(); master.gain.value = 0.9; master.connect(actx.destination);
  analyser = actx.createAnalyser(); analyser.fftSize = 256; anaBuf = new Uint8Array(analyser.fftSize);
}
async function loadVoices(progress) {
  voiceMeta = await (await fetch('assets/voice/voices.json')).json();
  const all = [];
  for (const [cat, list] of Object.entries(voiceMeta)) for (const v of list) all.push([cat, v]);
  let done = 0;
  await Promise.all(all.map(async ([cat, v]) => {
    try {
      const ab = await (await fetch('assets/voice/' + v.f)).arrayBuffer();
      const buf = await new Promise((res, rej) => actx.decodeAudioData(ab, res, rej));
      (voices[cat] = voices[cat] || []).push({ buf, t: v.t, f: v.f });
    } catch (e) { console.warn('voice', v.f, e); }
    progress && progress(++done / all.length);
  }));
}
function herAudioParams() {
  if (state === 'caught') return { gain: 1, pan: 0 };
  const dx = her.pos.x - player.x, dz = her.pos.z - player.z, d = Math.hypot(dx, dz);
  const ang = Math.atan2(dx, -dz) - (-player.yaw);
  const rel = Math.atan2(Math.sin(ang), Math.cos(ang));
  return { gain: clamp(1.15 - d / 70, 0.28, 1), pan: clamp(Math.sin(rel) * 0.8, -0.8, 0.8) };
}
function playVoice(cat, force = false) {
  if (!actx || !voices[cat] || !voices[cat].length) return null;
  const now = actx.currentTime;
  if (!force && now < voiceBusy) return null;
  if (force && voiceSrc) { try { voiceSrc.stop(); } catch (e) { } }
  let v = pick(voices[cat]); if (voices[cat].length > 1) while (v.f === lastVoice) v = pick(voices[cat]);
  lastVoice = v.f;
  const src = actx.createBufferSource(); src.buffer = v.buf;
  const g = actx.createGain(); const p = actx.createStereoPanner ? actx.createStereoPanner() : null;
  const ap = herAudioParams(); g.gain.value = ap.gain * 1.25; if (p) p.pan.value = ap.pan;
  src.connect(g); if (p) { g.connect(p); p.connect(master); } else g.connect(master);
  src.connect(analyser);
  src.start(); voiceSrc = src; voiceGain = g; voicePan = p;
  voiceBusy = now + v.buf.duration + 0.15;
  showBubble(v.t);
  return v;
}
let voiceGain = null, voicePan = null;
function voiceLevel() {
  if (!analyser || !actx || actx.currentTime > voiceBusy) return 0;
  analyser.getByteTimeDomainData(anaBuf); let s = 0;
  for (let i = 0; i < anaBuf.length; i++) { const v = (anaBuf[i] - 128) / 128; s += v * v; }
  return Math.sqrt(s / anaBuf.length);
}
function env(g, t0, a, peak, dcy) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dcy); }
function sfxBoing(strength = 1) {
  if (!actx) return; const t = actx.currentTime;
  const o = actx.createOscillator(), g = actx.createGain(); o.type = 'sine';
  const f0 = rand(150, 190);
  o.frequency.setValueAtTime(f0 * 1.6, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.25);
  const lfo = actx.createOscillator(), lg = actx.createGain(); lfo.frequency.value = 18; lg.gain.value = 12; lfo.connect(lg); lg.connect(o.frequency);
  env(g, t, 0.008, 0.55 * strength, 0.35); o.connect(g); g.connect(master); o.start(t); lfo.start(t); o.stop(t + 0.45); lfo.stop(t + 0.45);
  // soft pat
  noiseBurst(0.06, 900, 0.25 * strength);
}
let noiseBuf = null;
function noiseBurst(dur, freq, vol, q = 0.8) {
  if (!actx) return; const t = actx.currentTime;
  if (!noiseBuf) { noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const s = actx.createBufferSource(); s.buffer = noiseBuf; const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = q;
  const g = actx.createGain(); env(g, t, 0.005, vol, dur); s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.1);
}
function sfxStep(vol) {
  if (!actx || vol < 0.03) return; const t = actx.currentTime;
  const o = actx.createOscillator(), g = actx.createGain(); o.frequency.setValueAtTime(75, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.18);
  env(g, t, 0.01, 0.6 * vol, 0.25); o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.3);
  noiseBurst(0.12, 300, 0.25 * vol);
}
function sfxCrash(vol) {
  if (!actx) return; noiseBurst(1.2, 700, 0.7 * vol, 0.5); noiseBurst(0.5, 2500, 0.25 * vol);
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain(); o.frequency.setValueAtTime(55, t); o.frequency.exponentialRampToValueAtTime(25, t + 1);
  env(g, t, 0.02, 0.6 * vol, 1.0); o.connect(g); g.connect(master); o.start(t); o.stop(t + 1.2);
}
function sfxGrow() {
  if (!actx) return; const t = actx.currentTime;
  for (let k = 0; k < 3; k++) {
    const o = actx.createOscillator(), g = actx.createGain(); o.type = 'sine';
    const s = t + k * 0.22; o.frequency.setValueAtTime(70 + k * 10, s); o.frequency.exponentialRampToValueAtTime(160 + k * 30, s + 0.3);
    env(g, s, 0.04, 0.5, 0.35); o.connect(g); g.connect(master); o.start(s); o.stop(s + 0.45);
  }
}
function sfxHeart(vol) {
  if (!actx) return; const t = actx.currentTime;
  for (const off of [0, 0.16]) { const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 52; env(g, t + off, 0.01, 0.5 * vol, 0.14); o.connect(g); g.connect(master); o.start(t + off); o.stop(t + off + 0.25); }
}
function sfxWhoosh() { noiseBurst(0.5, 1800, 0.35, 2); }

// ---------------- input ----------------
const input = { mx: 0, my: 0, lx: 0, ly: 0, keys: {}, lookIdle: 99 };
function setupStick(zone, stickEl, kind) {
  const knob = stickEl.querySelector('.k'); const R = 52;
  let id = null, cx = 0, cy = 0;
  const home = () => {
    const w = innerWidth, h = innerHeight;
    const x = kind === 'move' ? Math.max(90, w * 0.16) : w - Math.max(90, w * 0.16), y = h - Math.max(110, h * 0.17);
    stickEl.style.left = x + 'px'; stickEl.style.top = y + 'px'; knob.style.transform = 'translate(0,0)';
  };
  home(); addEventListener('resize', home);
  const set = (x, y) => {
    let dx = x - cx, dy = y - cy; const l = Math.hypot(dx, dy); if (l > R) { dx *= R / l; dy *= R / l; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    if (kind === 'move') { input.mx = dx / R; input.my = dy / R; } else { input.lx = dx / R; input.ly = dy / R; }
  };
  zone.addEventListener('pointerdown', e => {
    if (id !== null || state !== 'play') return; id = e.pointerId; zone.setPointerCapture(id);
    cx = e.clientX; cy = e.clientY; stickEl.style.left = cx + 'px'; stickEl.style.top = cy + 'px'; set(cx, cy); e.preventDefault();
  });
  zone.addEventListener('pointermove', e => { if (e.pointerId !== id) return; set(e.clientX, e.clientY); e.preventDefault(); });
  const up = e => { if (e.pointerId !== id) return; id = null; if (kind === 'move') { input.mx = input.my = 0; } else { input.lx = input.ly = 0; } home(); };
  zone.addEventListener('pointerup', up); zone.addEventListener('pointercancel', up);
  return { reset: () => { id = null; input.mx = input.my = input.lx = input.ly = 0; home(); } };
}
let stickL, stickR;
addEventListener('keydown', e => { input.keys[e.code] = true; });
addEventListener('keyup', e => { input.keys[e.code] = false; });
// desktop mouse drag look (on right zone it is a stick; also allow drag anywhere with mouse button 2/left on canvas)
let mouseDrag = null;
addEventListener('mousedown', e => { if (state === 'play' && !isTouch && e.target === canvas) mouseDrag = { x: e.clientX, y: e.clientY }; });
addEventListener('mousemove', e => { if (!mouseDrag) return; player.yaw -= (e.clientX - mouseDrag.x) * 0.005; player.pitch = clamp(player.pitch - (e.clientY - mouseDrag.y) * 0.004, -0.7, 1.35); mouseDrag = { x: e.clientX, y: e.clientY }; input.lookIdle = 0; });
addEventListener('mouseup', () => mouseDrag = null);

// ---------------- player & state ----------------
const player = { x: 0, z: 8, yaw: Math.PI, pitch: 0.12, inv: 0, bob: 0, shake: 0 };
let state = 'title', tAlive = 0, caughtCount = 0, tapCount = 0, caughtT = 0, nextLine = 4, heartT = 0, breakVoiceCd = 0;

function collidePlayer() {
  const r = 0.4;
  for (const b of buildings) {
    if (!b.alive) continue;
    const hx = b.w / 2, hz = b.d / 2;
    const cx = clamp(player.x, b.x - hx, b.x + hx), cz = clamp(player.z, b.z - hz, b.z + hz);
    let dx = player.x - cx, dz = player.z - cz; const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-6) { const d = Math.sqrt(d2); player.x = cx + dx / d * r; player.z = cz + dz / d * r; }
      else { // inside: push out along min axis
        const ox = hx - Math.abs(player.x - b.x), oz = hz - Math.abs(player.z - b.z);
        if (ox < oz) player.x = b.x + Math.sign(player.x - b.x) * (hx + r); else player.z = b.z + Math.sign(player.z - b.z) * (hz + r);
      }
    }
  }
  player.x = clamp(player.x, -WORLD_HALF, WORLD_HALF); player.z = clamp(player.z, -WORLD_HALF, WORLD_HALF);
}

// ---------------- HUD helpers ----------------
let toastT = 0;
function toast(msg, dur = 1.8) { const t = $('toast'); t.textContent = msg; t.style.opacity = 1; toastT = dur; }
let bubbleT = 0;
function showBubble(text) { if (state !== 'caught') return; const b = $('bubble'); b.textContent = text; b.style.opacity = 1; bubbleT = 1.4; }
function fmt(t) { const m = Math.floor(t / 60), s = t - m * 60; return String(m).padStart(2, '0') + ':' + s.toFixed(1).padStart(4, '0'); }

// ---------------- restraint scene ----------------
function buildRestrain(bellyT, bodyT) {
  const rs = new THREE.Scene(); rs.background = new THREE.Color(0x2a1830);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  const bh = BELLY.h * K, bw = BELLY.w * K;
  const g = new THREE.PlaneGeometry(bw, bh, 36, 36); g.translate(0, -bh / 2, 0);
  const mat = makeBellyMaterial(bellyT, bh);
  const mesh = new THREE.Mesh(g, mat.m); mesh.renderOrder = 2; rs.add(mesh);
  const bodyM = new THREE.Mesh(new THREE.PlaneGeometry(IMG_W * K, IMG_H * K), new THREE.MeshBasicMaterial({ map: bodyT, transparent: true, depthWrite: false }));
  bodyM.renderOrder = 1; rs.add(bodyM);
  // skirt / body hint behind (use body texture lower region blurred by distance) - simple gradient backdrop
  const bgc = document.createElement('canvas'); bgc.width = 4; bgc.height = 256; const bx = bgc.getContext('2d');
  const gr = bx.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#cfe3f7'); gr.addColorStop(1, '#9fbad6'); bx.fillStyle = gr; bx.fillRect(0, 0, 4, 256);
  const bgTex = new THREE.CanvasTexture(bgc); bgTex.colorSpace = THREE.SRGBColorSpace;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: bgTex })); back.position.z = -1; rs.add(back);
  restrain = { scene: rs, cam, mesh, mat, bw, bh, back, bodyM, jig: { sq: 0, sqV: 0, sw: 0, swV: 0, wob: 0, tap: 0 } };
}
function layoutRestrain() {
  if (!restrain) return;
  const a = innerWidth / innerHeight; const r = restrain;
  // close-up framed on the belly: belly fills most of the view, chest above / skirt below as context
  const viewH = (a < 1 ? 900 : 640) * K; const viewW = viewH * a;
  r.cam.left = -viewW / 2; r.cam.right = viewW / 2; r.cam.top = viewH / 2; r.cam.bottom = -viewH / 2; r.cam.updateProjectionMatrix();
  // body image centred so that belly centre (px y~640) is slightly below screen centre
  const cy = (a < 1 ? 600 : 625);
  r.bodyM.position.set(-(405 - IMG_W / 2) * K, (cy - IMG_H / 2) * K, 0);
  r.mesh.scale.set(1, 1, 1);
  r.mesh.position.set(r.bodyM.position.x + (BELLY.x0 + BELLY.w / 2 - IMG_W / 2) * K, r.bodyM.position.y + (IMG_H / 2 - BELLY.y0) * K, 0.01);
  r.back.scale.set(viewW * 1.2, viewH * 1.2, 1);
}
function screenToBellyLocal(cx, cy) {
  const r = restrain; const nx = cx / innerWidth * 2 - 1, ny = -(cy / innerHeight * 2 - 1);
  const z = r.cam.zoom || 1; const wx = (r.cam.left + (nx + 1) / 2 * (r.cam.right - r.cam.left)) / z, wy = (r.cam.bottom + (ny + 1) / 2 * (r.cam.top - r.cam.bottom)) / z;
  return new THREE.Vector2((wx - r.mesh.position.x) / r.mesh.scale.x, (wy - r.mesh.position.y) / r.mesh.scale.y);
}
function drawFaceBox() {
  const cv = $('faceCv'), x = cv.getContext('2d'); if (!bodyImg) return;
  const sx = 318, sy = 0, sw = 180, sh = 180;
  x.clearRect(0, 0, 220, 220); x.fillStyle = '#fde8f0'; x.fillRect(0, 0, 220, 220);
  const k = 220 / sw; x.imageSmoothingQuality = 'high';
  x.drawImage(bodyImg, sx, sy, sw, sh, 0, 0, 220, 220);
  const f = faceImgs[her.faceShown] || faceImgs.happy;
  x.drawImage(f, (FACE.x - sx) * k, (FACE.y - sy) * k, FACE.w * k, FACE.h * k);
}
function enterCaught() {
  state = 'caught'; caughtCount++; tapCount = 0; caughtT = 0; restrainTap = 0;
  $('flash').style.opacity = 0.9; setTimeout(() => $('flash').style.opacity = 0, 120);
  $('caught').style.display = 'flex'; $('cBar').style.width = '0%'; $('hud').style.display = 'none';
  $('moveStick').style.display = 'none'; $('lookStick').style.display = 'none'; $('arrow').style.display = 'none';
  stickL.reset(); stickR.reset(); mouseDrag = null;
  layoutRestrain();
  her.frustration = Math.max(0, her.frustration - 45);
  setFaceInstant('happy'); drawFaceBox();
  restrain.jig.sqV = -2.5;
  playVoice('catch', true);
  $('cMsg').textContent = 'つかまった！お腹を連打！';
}
let restrainTap = 0;
$('caught').addEventListener('pointerdown', e => {
  if (state !== 'caught' || caughtT < 0.35) return; e.preventDefault();
  tapCount++; restrainTap = 1;
  const r = restrain; const lp = screenToBellyLocal(e.clientX, e.clientY);
  r.mat.u.uTap.value.copy(lp); r.jig.tap = 1;
  r.jig.sqV += rand(2.2, 3.2); r.jig.swV += (lp.x > 0 ? -1 : 1) * rand(0.6, 1.0); r.jig.wob = Math.min(0.05, r.jig.wob + 0.02);
  sfxBoing(1);
  her.tapped = 0.35; setFaceInstant('tapped'); drawFaceBox();
  if (Math.random() < 0.55 || tapCount === 1) playVoice('tap');
  const s = document.createElement('div'); s.className = 'slap'; s.textContent = pick(['ぽよん', 'ぼよん', 'ぷるん', 'ぱちん']); s.style.left = e.clientX + 'px'; s.style.top = e.clientY + 'px'; document.body.appendChild(s); setTimeout(() => s.remove(), 520);
  const rg = document.createElement('div'); rg.className = 'ring'; rg.style.left = e.clientX + 'px'; rg.style.top = e.clientY + 'px'; document.body.appendChild(rg); setTimeout(() => rg.remove(), 470);
  $('cBar').style.width = Math.min(100, tapCount / TAPS_TO_ESCAPE * 100) + '%';
  if (navigator.vibrate) navigator.vibrate(15);
  if (tapCount >= TAPS_TO_ESCAPE) exitCaught();
});
function exitCaught() {
  state = 'play';
  $('caught').style.display = 'none'; $('bubble').style.opacity = 0; $('hud').style.display = 'flex';
  if (isTouch) { $('moveStick').style.display = ''; $('lookStick').style.display = ''; }
  // knockback: push player away from her
  const dx = player.x - her.pos.x, dz = player.z - her.pos.z, d = Math.hypot(dx, dz) || 1;
  const push = her.R + 7;
  player.x = her.pos.x + dx / d * push; player.z = her.pos.z + dz / d * push; collidePlayer();
  player.yaw = Math.atan2(-(her.pos.x - player.x), -(her.pos.z - player.z)) ; // look at her
  player.inv = 2.6; her.stun = 1.4; her.pout = 2.5; her.jig.sqV -= 3;
  setFace('pout');
  playVoice('escape', true); sfxWhoosh();
  toast('脱出成功！逃げて！', 1.4);
}

// ---------------- main update ----------------
const tmpV = new THREE.Vector3();
function updateHerScale(dt) {
  // spring towards stage
  const k = 30, c = 7;
  her.stageVel += ((her.stage - her.stageVis) * k - her.stageVel * c) * dt;
  her.stageVis += her.stageVel * dt;
  const sv = Math.max(0, her.stageVis);
  her.S = 1 + 0.13 * sv;
  her.bx = 1 + 0.24 * sv;
  her.by = her.bx;
  // when the belly would reach below the ground, lift the whole body so the belly rests on the ground
  // (the skirt/legs are fully hidden behind the belly at that size)
  her.lift = Math.max(0, (BELLY.bottomPx - BELLY.y0) * her.by - (IMG_H - BELLY.y0) + 6) * K;
  her.group.scale.setScalar(her.S);
  bellyMesh.scale.set(her.bx, her.by, 1);
  her.R = (BELLY.w * K / 2) * her.bx * her.S * 0.9;
}
function update(dt, t) {
  // ---- player movement ----
  if (state === 'play') {
    tAlive += dt;
    let mx = input.mx, my = input.my;
    const kb = input.keys;
    if (kb.KeyW || kb.ArrowUp) my -= 1; if (kb.KeyS || kb.ArrowDown) my += 1;
    if (kb.KeyA) mx -= 1; if (kb.KeyD) mx += 1;
    if (kb.ArrowLeft || kb.KeyQ) { player.yaw += 2.2 * dt; input.lookIdle = 0; }
    if (kb.ArrowRight || kb.KeyE) { player.yaw -= 2.2 * dt; input.lookIdle = 0; }
    const ml = Math.hypot(mx, my); if (ml > 1) { mx /= ml; my /= ml; }
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw), rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
    const sp = PLAYER_SPEED * Math.min(1, ml);
    player.x += (fx * -my + rx * mx) * PLAYER_SPEED * dt; player.z += (fz * -my + rz * mx) * PLAYER_SPEED * dt;
    collidePlayer();
    player.bob += sp * dt * 2.4;
    // look stick
    if (Math.abs(input.lx) > 0.05 || Math.abs(input.ly) > 0.05) {
      const ax = Math.sign(input.lx) * Math.pow(Math.abs(input.lx), 1.6), ay = Math.sign(input.ly) * Math.pow(Math.abs(input.ly), 1.6);
      player.yaw -= ax * 3.0 * dt; player.pitch = clamp(player.pitch - ay * 1.8 * dt, -0.7, 1.35); input.lookIdle = 0;
    } else input.lookIdle += dt;
    player.inv = Math.max(0, player.inv - dt);
  }

  // ---- her AI ----
  const dx = player.x - her.pos.x, dz = player.z - her.pos.z, dist = Math.hypot(dx, dz);
  if (state === 'play') {
    her.frustration += dt * (6.2 + (dist > 30 ? 2.5 : 0));
    if (her.frustration >= 100) {
      her.frustration = 0; her.stage++; her.stageVel += 2.2; her.jig.sqV -= 4; her.jig.wob = 0.05;
      her.surprised = 1.4; setFace('surprised');
      playVoice('grow', true); sfxGrow(); toast(`お腹が大きくなった！ Lv.${her.stage + 1}`);
      player.shake = Math.max(player.shake, 0.6);
    }
    her.stun = Math.max(0, her.stun - dt);
    her.dashCd -= dt;
    if (her.dashCd <= 0 && dist < 16 && dist > 4) { her.dash = 1.3; her.dashCd = rand(6, 10); playVoice(pick(['chase', 'chase', 'frust1'])); }
    her.dash = Math.max(0, her.dash - dt);
    const base = Math.min(2.7 + 0.2 * her.stage, 4.5);
    const target = her.stun > 0 ? 0 : base * (her.dash > 0 ? 1.65 : 1);
    her.speed += (target - her.speed) * Math.min(1, dt * 3);
    if (dist > 0.01) { her.pos.x += dx / dist * her.speed * dt; her.pos.z += dz / dist * her.speed * dt; }
    her.pos.x = clamp(her.pos.x, -WORLD_HALF - 20, WORLD_HALF + 20); her.pos.z = clamp(her.pos.z, -WORLD_HALF - 20, WORLD_HALF + 20);
    // catch
    if (player.inv <= 0 && dist < her.R * 0.95 + 0.9) enterCaught();
    // voice lines
    nextLine -= dt;
    if (nextLine <= 0) {
      const f = her.frustration / 100, s = her.stage;
      let cat = 'chase';
      if (s >= 4 && f > 0.3) cat = Math.random() < 0.7 ? 'frust3' : 'frust2';
      else if (s >= 2 && f > 0.25) cat = Math.random() < 0.6 ? 'frust2' : 'frust1';
      else if (s >= 1 || f > 0.5) cat = Math.random() < 0.55 ? 'frust1' : 'chase';
      if (playVoice(cat)) nextLine = rand(3.5, 6.5); else nextLine = 0.5;
    }
    // building destruction
    breakVoiceCd -= dt;
    const bcx = her.pos.x + (dist > 0.01 ? dx / dist : 0) * her.R * 0.3, bcz = her.pos.z + (dist > 0.01 ? dz / dist : 0) * her.R * 0.3;
    for (const b of buildings) {
      if (!b.alive) continue;
      const cx = clamp(bcx, b.x - b.w / 2, b.x + b.w / 2), cz = clamp(bcz, b.z - b.d / 2, b.z + b.d / 2);
      if ((bcx - cx) ** 2 + (bcz - cz) ** 2 < (her.R * 1.05) ** 2) {
        breakBuilding(b, her.pos.x, her.pos.z, 0.9 + her.S * 0.25);
        const pd = Math.hypot(b.x - player.x, b.z - player.z);
        sfxCrash(clamp(1.2 - pd / 80, 0.15, 1)); player.shake = Math.max(player.shake, clamp(0.9 - pd / 60, 0, 0.8));
        her.jig.sqV -= 2.5; her.jig.swV += rand(-1, 1);
        if (breakVoiceCd <= 0 && Math.random() < 0.6) { if (playVoice('break')) { breakVoiceCd = 9; her.surprised = 0.8; } }
      }
    }
    // respawn
    for (const b of buildings) {
      if (b.alive) continue; b.deadT += dt;
      if (b.deadT > 45 && Math.hypot(b.x - her.pos.x, b.z - her.pos.z) > her.R + Math.max(b.w, b.d) + 15 && Math.hypot(b.x - player.x, b.z - player.z) > Math.max(b.w, b.d) / 2 + 3) {
        b.alive = true; b.g.visible = true; b.grow = 0;
      }
    }
    // heartbeat when near
    heartT -= dt;
    const near = dist - her.R;
    if (near < 14 && heartT <= 0) { sfxHeart(clamp(1 - near / 14, 0.15, 1)); heartT = clamp(0.45 + near * 0.06, 0.45, 1.2); }
  }
  for (const b of buildings) if (b.grow < 1) { b.grow = Math.min(1, b.grow + dt * 1.5); b.g.scale.set(1, Math.max(0.01, b.grow), 1); }

  // ---- her animation ----
  updateHerScale(dt);
  const stride = 1.15 * her.S;
  const prevPhase = her.phase;
  her.phase += (her.speed * dt / stride) * Math.PI;
  const walk = clamp(her.speed / 2.5, 0, 1.2);
  if (Math.floor(prevPhase / Math.PI) !== Math.floor(her.phase / Math.PI) && walk > 0.2) {
    her.jig.sqV -= 1.6 * walk; her.jig.swV += (Math.sin(her.phase) > 0 ? 1 : -1) * 0.25 * walk;
    const d = Math.max(0, dist - her.R);
    sfxStep(clamp((1 - d / 45) * (0.5 + her.S * 0.25), 0, 1.2));
    if (d < 25) player.shake = Math.max(player.shake, clamp((1 - d / 25) * 0.12 * her.S, 0, 0.5));
  }
  // jiggle springs (belly only)
  const J = her.jig;
  J.sqV += (-J.sq * 140 - J.sqV * 7) * dt; J.sq += J.sqV * dt;
  J.swV += (-J.sw * 90 - J.swV * 5) * dt; J.sw += J.swV * dt;
  J.sq = clamp(J.sq, -0.12, 0.12); J.wob = Math.max(0.006 * walk, J.wob - dt * 0.03);
  bellyMat.u.uSquash.value = J.sq; bellyMat.u.uSway.value = J.sw * 0.08; bellyMat.u.uTime.value = t; bellyMat.u.uWob.value = J.wob;
  // walking skirt/legs
  const s = Math.sin(her.phase);
  bodyMat.u.uPhase.value = her.phase; bodyMat.u.uSkirt.value = 0.035 * walk; bodyMat.u.uLift.value = 0.022 * walk; bodyMat.u.uTilt.value = 0.008 * walk;
  const W = IMG_W * K;
  faceMeshA.position.x = faceMeshA.userData.x0 + s * 0.008 * walk * 0.86 * W; faceMeshB.position.x = faceMeshA.position.x;
  bellyMesh.position.x = bellyMesh.userData.x0 + s * 0.008 * walk * 0.3 * W;
  her.inner.position.y = her.lift + Math.abs(Math.cos(her.phase)) * 0.035 * walk * H0 - 0.01;
  her.inner.rotation.z = s * 0.012 * walk;
  // billboard toward camera (yaw only)
  her.group.position.set(her.pos.x, 0, her.pos.z);
  her.group.rotation.y = Math.atan2(player.x - her.pos.x, player.z - her.pos.z);
  shadow.position.set(her.pos.x, 0.03, her.pos.z); shadow.scale.set(her.R * 2.6, her.R * 2.0, 1);
  // ---- face logic ----
  her.surprised = Math.max(0, her.surprised - dt); her.pout = Math.max(0, her.pout - dt); her.tapped = Math.max(0, her.tapped - dt);
  let want;
  if (state === 'caught') want = her.tapped > 0 ? 'tapped' : 'happy';
  else if (her.surprised > 0) want = 'surprised';
  else if (her.pout > 0) want = 'pout';
  else { const f = her.frustration; want = (her.stage >= 2 && f > 65) || (her.stage >= 5 && f > 30) ? 'angry' : (f > 50 || (her.stage >= 1 && f > 25)) ? 'pout' : 'smile'; }
  // blink & talk
  her.blinkT -= dt;
  if (her.blinkT <= 0) { her.blinking = 0.13; her.blinkT = rand(2.2, 5); }
  her.blinking = Math.max(0, her.blinking - dt);
  const lvl = voiceLevel();
  if (lvl > 0.04 && (want === 'smile' || want === 'pout' || want === 'normal')) { if (Math.floor(t * 9) % 2 === 0) want = want + '_talk'; }
  else if (her.blinking > 0 && faceTex[want + '_blink']) want = want + '_blink';
  if (want.endsWith('_blink') || want.endsWith('_talk') || her.face.endsWith('_blink') || her.face.endsWith('_talk')) { if (want !== her.faceShown) setFaceInstant(want); }
  else setFace(want);
  if (her.faceT < 1) {
    her.faceT = Math.min(1, her.faceT + dt / 0.16); faceB.opacity = her.faceT;
    if (her.faceT >= 1) { her.faceShown = her.face; faceA.map = faceTex[her.face]; faceB.opacity = 0; }
  }
  // voice follows her position
  if (voiceGain && state === 'play') { const ap = herAudioParams(); voiceGain.gain.value = ap.gain * 1.25; if (voicePan) voicePan.pan.value = ap.pan; }

  // ---- camera ----
  if (state === 'play' || state === 'title') {
    // assist: gently tilt view toward her when not actively looking
    if (state === 'play' && input.lookIdle > 1.2) {
      const herYaw = Math.atan2(-(her.pos.x - player.x), -(her.pos.z - player.z));
      let dy = herYaw - player.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      if (Math.abs(dy) < 0.9) {
        const focusH = (her.lift + (IMG_H - 500) * K) * her.S; // around belly-top / chest
        const tp = clamp(Math.atan2(focusH - EYE_H, Math.max(dist, 1)), 0.05, 1.0);
        player.pitch += (tp - player.pitch) * Math.min(1, dt * 0.8);
      }
    }
    player.shake = Math.max(0, player.shake - dt * 1.6);
    const sh = player.shake * player.shake;
    camera.position.set(player.x + rand(-1, 1) * sh * 0.15, EYE_H + Math.sin(player.bob) * 0.03 + rand(-1, 1) * sh * 0.12, player.z + rand(-1, 1) * sh * 0.15);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  }

  // ---- restraint scene ----
  if (state === 'caught') {
    caughtT += dt;
    const r = restrain, j = r.jig;
    j.sqV += (-j.sq * 120 - j.sqV * 6) * dt; j.sq += j.sqV * dt; j.sq = clamp(j.sq, -0.14, 0.14);
    j.swV += (-j.sw * 80 - j.swV * 4) * dt; j.sw += j.swV * dt;
    j.wob = Math.max(0.004, j.wob - dt * 0.05); j.tap = Math.max(0, j.tap - dt * 3);
    // idle breathing
    r.mat.u.uSquash.value = j.sq + Math.sin(t * 2.2) * 0.008; r.mat.u.uSway.value = j.sw * 0.05;
    r.mat.u.uTime.value = t; r.mat.u.uWob.value = j.wob; r.mat.u.uTapAmt.value = j.tap * 0.9;
    // she slowly squeezes forward (pressure) if not tapping
    const press = 1 + Math.min(caughtT, 6) * 0.01;
    r.mesh.scale.multiplyScalar(1); r.mesh.position.z = 0;
    r.cam.zoom = press - restrainTap * 0.02; r.cam.updateProjectionMatrix(); restrainTap = Math.max(0, restrainTap - dt * 4);
    if (her.tapped <= 0 && her.faceShown !== 'happy') { setFaceInstant('happy'); drawFaceBox(); }
  }

  // ---- HUD ----
  if (state !== 'title') {
    $('time').textContent = fmt(tAlive);
    $('sub').textContent = `捕まった: ${caughtCount}回`;
    $('lv').textContent = `お腹 Lv.${her.stage + 1}`;
    $('dist').textContent = `距離 ${Math.max(0, dist - her.R).toFixed(0)}m`;
    $('fp').textContent = Math.floor(her.frustration) + '%';
    $('barf').style.width = her.frustration + '%';
    const near = Math.max(0, dist - her.R);
    const v = state === 'play' ? clamp(1 - near / 12, 0, 1) : 0;
    $('vig').style.boxShadow = `inset 0 0 ${60 + v * 80}px ${v * 40}px rgba(255,30,80,${v * 0.6})`;
    if (player.inv > 0 && state === 'play') canvas.style.opacity = (Math.floor(t * 10) % 2) ? 0.75 : 1; else canvas.style.opacity = 1;
    // off-screen arrow
    const ar = $('arrow');
    if (state === 'play') {
      tmpV.set(her.pos.x, (her.lift + (IMG_H - 600) * K) * her.S, her.pos.z).project(camera);
      const herYaw = Math.atan2(-(her.pos.x - player.x), -(her.pos.z - player.z));
      let dyaw = herYaw - player.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      const half = THREE.MathUtils.degToRad(camera.fov) * camera.aspect / 2;
      if (Math.abs(dyaw) > half * 0.95) {
        ar.style.display = 'block';
        const side = dyaw > 0 ? -1 : 1;
        const behind = Math.abs(dyaw) > Math.PI * 0.75;
        const x = behind ? innerWidth / 2 : (side > 0 ? innerWidth - 44 : 44), y = behind ? innerHeight * 0.72 : innerHeight * 0.42;
        ar.style.left = x + 'px'; ar.style.top = y + 'px';
        ar.querySelector('.a').style.transform = `rotate(${behind ? 180 : side * 90}deg)`;
        ar.querySelector('.t').textContent = behind ? `うしろ！ ${near.toFixed(0)}m` : `${near.toFixed(0)}m`;
      } else ar.style.display = 'none';
    }
    if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').style.opacity = 0; }
    if (bubbleT > 0) { bubbleT -= dt; if (bubbleT <= 0) $('bubble').style.opacity = 0; }
  }
  updateDebris(dt);
}

// ---------------- loop ----------------
function resize() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.fov = w < h ? 82 : 70; camera.updateProjectionMatrix();
  layoutRestrain();
}
addEventListener('resize', resize);
let last = performance.now(); let paused = false;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!her.inner) return;
  update(dt, now / 1000);
  if (state === 'caught') renderer.render(restrain.scene, restrain.cam);
  else renderer.render(scene, camera);
}

// title-screen camera: show her approaching from a distance
async function boot() {
  resize();
  buildTown();
  await buildHer();
  her.pos.set(0, 0, -14); player.x = 0; player.z = 0; player.yaw = 0; player.pitch = 0.25; her.speed = 0;
  requestAnimationFrame(frame);
  $('loading').textContent = '';
  if (!isTouch) { $('touchL').style.display = 'none'; $('touchR').style.display = 'none'; }
  stickL = setupStick($('touchL'), $('moveStick'), 'move');
  stickR = setupStick($('touchR'), $('lookStick'), 'look');
  window.__game = { her, player, get state() { return state; }, enterCaught, exitCaught, buildings, setFace, setFaceInstant, input, forceStage: n => { her.stage = n; }, tap: (x, y) => $('caught').dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true })) };
}
$('startBtn').addEventListener('click', async () => {
  $('startBtn').disabled = true; $('loading').textContent = 'ボイス読み込み中… 0%';
  try { await initAudio(); await loadVoices(p => $('loading').textContent = `ボイス読み込み中… ${Math.round(p * 100)}%`); } catch (e) { console.warn(e); }
  $('title').style.display = 'none'; $('hud').style.display = 'flex';
  if (isTouch) { $('moveStick').style.display = ''; $('lookStick').style.display = ''; }
  her.pos.set(rand(-6, 6), 0, -32); player.x = 0; player.z = 4; player.yaw = 0; player.pitch = 0.18;
  state = 'play'; tAlive = 0; nextLine = 1.2;
  playVoice('title', true);
  toast('お姉さんから逃げて！', 2);
  try { if (isTouch && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (e) { }
});
boot().catch(e => { $('loading').textContent = '読み込みエラー: ' + e.message; console.error(e); });
