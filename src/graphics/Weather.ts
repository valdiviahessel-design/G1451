import * as THREE from 'three';
import type { Weather as WeatherKind } from '../gameplay/maps';

/** Particle volume that travels with the camera; must divide the floating-origin step (1200 m) along z. */
const BOX = new THREE.Vector3(64, 16, 120);

const WRAP = /* glsl */ `
uniform vec3 uCam;
uniform vec3 uBox;
uniform vec3 uVel;
uniform float uTime;
/** World position of a particle: drifts with uVel and wraps inside a box centred ahead of the camera. */
vec3 particle(vec3 seed) {
  vec3 centre = uCam + vec3(0.0, uBox.y * 0.5 - 3.0, -uBox.z * 0.32);
  vec3 p = seed * uBox + uVel * uTime;
  return centre + mod(p - centre, uBox) - uBox * 0.5;
}`;

function seeds(n: number, perParticle: number): Float32Array {
  const a = new Float32Array(n * perParticle * 3);
  for (let i = 0; i < n; i++) {
    const x = Math.random();
    const y = Math.random();
    const z = Math.random();
    for (let k = 0; k < perParticle; k++) a.set([x, y, z], (i * perParticle + k) * 3);
  }
  return a;
}

/**
 * Rain streaks and drifting sakura petals, simulated entirely in the vertex
 * shader: one draw call each and no per-frame CPU work beyond three uniforms.
 */
export class Weather {
  private readonly rain: THREE.LineSegments;
  private readonly petals: THREE.Points;
  private readonly uniforms = {
    uCam: { value: new THREE.Vector3() },
    uBox: { value: BOX },
    uTime: { value: 0 },
  };
  private readonly rainVel = { value: new THREE.Vector3(1.5, -11, 0) };
  private readonly rainStreak = { value: new THREE.Vector3() };
  private readonly petalVel = { value: new THREE.Vector3(0.9, -0.85, 0.3) };
  private kind: WeatherKind = 'clear';

  constructor(scene: THREE.Scene, mobile: boolean) {
    const nRain = mobile ? 900 : 2200;
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(seeds(nRain, 2), 3));
    const ends = new Float32Array(nRain * 2);
    for (let i = 0; i < nRain; i++) ends[i * 2 + 1] = 1;
    rainGeo.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    this.rain = new THREE.LineSegments(
      rainGeo,
      new THREE.ShaderMaterial({
        uniforms: { ...this.uniforms, uVel: this.rainVel, uStreak: this.rainStreak },
        vertexShader: /* glsl */ `
          ${WRAP}
          uniform vec3 uStreak;
          attribute float aEnd;
          varying float vAlpha;
          void main() {
            vec3 p = particle(position) + uStreak * aEnd;
            vec4 mv = viewMatrix * vec4(p, 1.0);
            vAlpha = (1.0 - aEnd * 0.8) * smoothstep(70.0, 20.0, -mv.z) * smoothstep(0.5, 3.0, -mv.z);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          varying float vAlpha;
          void main() { gl_FragColor = vec4(vec3(0.75, 0.82, 0.95) * vAlpha * 0.55, 1.0); }`,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );

    const nPetals = mobile ? 350 : 800;
    const petalGeo = new THREE.BufferGeometry();
    petalGeo.setAttribute('position', new THREE.BufferAttribute(seeds(nPetals, 1), 3));
    this.petals = new THREE.Points(
      petalGeo,
      new THREE.ShaderMaterial({
        uniforms: { ...this.uniforms, uVel: this.petalVel, uScale: { value: 600 } },
        vertexShader: /* glsl */ `
          ${WRAP}
          uniform float uScale;
          varying float vSpin;
          varying float vFade;
          varying float vTone;
          void main() {
            float id = fract(position.x * 91.7 + position.z * 37.3);
            vec3 p = particle(position);
            // Flutter: each petal sways on its own phase as it falls.
            p.x += sin(uTime * 1.7 + id * 40.0) * 0.5;
            p.y += sin(uTime * 2.3 + id * 23.0) * 0.18;
            vec4 mv = viewMatrix * vec4(p, 1.0);
            vSpin = uTime * (1.5 + id * 3.0) + id * 6.28;
            vFade = smoothstep(60.0, 30.0, -mv.z) * smoothstep(0.6, 2.5, -mv.z);
            vTone = id;
            gl_PointSize = clamp(uScale * (0.05 + id * 0.05) / -mv.z, 1.0, 26.0);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          varying float vSpin;
          varying float vFade;
          varying float vTone;
          void main() {
            vec2 q = gl_PointCoord - 0.5;
            float c = cos(vSpin), s = sin(vSpin);
            q = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
            // A tumbling petal: an ellipse whose short axis breathes as it turns.
            float squash = 0.45 + 0.4 * abs(sin(vSpin * 0.7));
            float d = length(vec2(q.x, q.y / squash));
            float a = smoothstep(0.5, 0.38, d) * vFade;
            if (a < 0.02) discard;
            vec3 col = mix(vec3(1.0, 0.62, 0.76), vec3(1.0, 0.92, 0.95), vTone);
            gl_FragColor = vec4(col * 1.15, a * 0.9);
          }`,
        transparent: true,
        depthWrite: false,
      }),
    );

    for (const o of [this.rain, this.petals]) {
      o.frustumCulled = false;
      o.visible = false;
      o.renderOrder = 6;
      scene.add(o);
    }
  }

  set(kind: WeatherKind, enabled = true): void {
    this.kind = kind;
    this.rain.visible = enabled && kind === 'rain';
    this.petals.visible = enabled && kind === 'petals';
  }

  get raining(): boolean {
    return this.kind === 'rain';
  }

  /** `speed` is the car's forward speed (m/s): rain streaks lean into it. */
  update(time: number, camera: THREE.PerspectiveCamera, speed: number, viewportHeight: number): void {
    if (!this.rain.visible && !this.petals.visible) return;
    this.uniforms.uCam.value.copy(camera.position);
    this.uniforms.uTime.value = time;
    // Streak = drop velocity relative to the car over a short exposure.
    this.rainStreak.value.set(this.rainVel.value.x, this.rainVel.value.y, speed).multiplyScalar(0.035);
    (this.petals.material as THREE.ShaderMaterial).uniforms.uScale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }
}
