/**
 * The lander: an original, toy-like design. A gold-foil lower stage on four springy legs, a
 * glossy cream cabin with two triangle windows (a friendly face), an antenna dish, small corner
 * thrusters, an engine bell with a soft plume, and a warm engine light for the ground.
 *
 * Origin = centre of mass (the sim position). The footpads sit LEG_DROP below it, at
 * (+-LEG_SPREAD, +-LEG_SPREAD), exactly where the sim checks contact.
 */
import * as THREE from 'three';
import { candyMaterial, roundedBox } from '../kit/scene-helpers';
import { palette } from '../kit/theme';
import { LEG_DROP, LEG_SPREAD } from '../sim/constants';
import { makeFoilNormal } from './textures';

const UP = new THREE.Vector3(0, 1, 0);

function strut(a: THREE.Vector3, b: THREE.Vector3, radius: number, mat: THREE.Material): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 10), mat);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
  return mesh;
}

export class LanderModel {
  readonly root = new THREE.Group();
  /** Everything above the legs; it dips a little on touchdown (springy legs). */
  readonly body = new THREE.Group();
  readonly engineLight: THREE.PointLight;
  private readonly plumeOuter: THREE.Mesh;
  private readonly plumeInner: THREE.Mesh;
  private readonly plumeMat: THREE.MeshBasicMaterial;
  private readonly plumeInnerMat: THREE.MeshBasicMaterial;
  private readonly nozzleGlow: THREE.MeshBasicMaterial;
  private readonly windows: THREE.MeshPhysicalMaterial;

  constructor(seed: number) {
    this.root.name = 'lander';
    const foil = new THREE.MeshPhysicalMaterial({
      color: '#e2a93c',
      metalness: 0.85,
      roughness: 0.38,
      clearcoat: 0.6,
      clearcoatRoughness: 0.2,
      normalMap: makeFoilNormal(seed),
      normalScale: new THREE.Vector2(0.6, 0.6),
      envMapIntensity: 1.1,
    });
    const dark = new THREE.MeshStandardMaterial({ color: '#33364a', metalness: 0.6, roughness: 0.45 });
    const legMat = new THREE.MeshPhysicalMaterial({
      color: '#d9dde8',
      metalness: 0.55,
      roughness: 0.3,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
    });
    const cabinMat = candyMaterial('#efeae0', { roughness: 0.28 });
    const accent = candyMaterial(palette.coral, { roughness: 0.3 });
    const lemon = candyMaterial(palette.lemon, { roughness: 0.3 });
    this.windows = new THREE.MeshPhysicalMaterial({
      color: '#14214a',
      roughness: 0.08,
      metalness: 0.2,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      emissive: new THREE.Color(palette.sky),
      emissiveIntensity: 0.18,
    });

    // Lower stage: an octagon wrapped in gold foil, a dark rim on top.
    const stage = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.5, 1.4, 8), foil);
    stage.rotation.y = Math.PI / 8;
    stage.position.y = -0.4;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.12, 8), dark);
    rim.rotation.y = Math.PI / 8;
    rim.position.y = 0.32;
    this.body.add(stage, rim);

    // Cabin: rounded and glossy, with a coral band and a docking hatch on top.
    const cabin = new THREE.Mesh(roundedBox(2.4, 1.7, 2.1, 0.38, 4), cabinMat);
    cabin.position.y = 1.25;
    const band = new THREE.Mesh(roundedBox(2.46, 0.22, 2.16, 0.1, 2), accent);
    band.position.y = 0.62;
    const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.36, 20), legMat);
    hatch.position.y = 2.25;
    this.body.add(cabin, band, hatch);

    // Face: two triangle windows (pointing down a little, like friendly eyes) and a small door.
    for (const side of [-1, 1]) {
      const win = new THREE.Mesh(new THREE.CircleGeometry(0.34, 3), this.windows);
      win.rotation.z = -Math.PI / 2 + side * 0.12;
      win.position.set(side * 0.5, 1.45, 1.065);
      this.body.add(win);
    }
    const door = new THREE.Mesh(roundedBox(0.62, 0.5, 0.06, 0.08, 2), dark);
    door.position.set(0, 0.92, 1.06);
    this.body.add(door);

    // Antenna dish on a short mast.
    const mast = strut(new THREE.Vector3(0.75, 2.0, -0.5), new THREE.Vector3(1.05, 2.7, -0.7), 0.05, legMat);
    const dish = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 20, 8, 0, Math.PI * 2, 0, Math.PI / 3.2),
      new THREE.MeshPhysicalMaterial({ color: '#f5f3ee', roughness: 0.3, clearcoat: 1, side: THREE.DoubleSide }),
    );
    dish.position.set(1.08, 2.62, -0.72);
    dish.rotation.set(-0.5, 0, -0.6);
    this.body.add(mast, dish);

    // Corner thrusters.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const quad = new THREE.Mesh(roundedBox(0.3, 0.3, 0.3, 0.08, 2), lemon);
        quad.position.set(sx * 1.32, 1.55, sz * 1.15);
        this.body.add(quad);
      }
    }

    // Engine bell and its glow.
    const bell = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.62, 0.7, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: '#4a4e63', metalness: 0.7, roughness: 0.35, side: THREE.DoubleSide }),
    );
    bell.position.y = -1.42;
    this.nozzleGlow = new THREE.MeshBasicMaterial({ color: '#ffb36b', transparent: true, opacity: 0, toneMapped: false });
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.58, 24), this.nozzleGlow);
    glow.rotation.x = Math.PI / 2;
    glow.position.y = -1.6;
    this.body.add(bell, glow);

    // Plume: two additive cones, narrow at the nozzle and wide below (exhaust spreads in vacuum).
    this.plumeMat = new THREE.MeshBasicMaterial({
      color: '#ffcf96',
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.plumeInnerMat = this.plumeMat.clone();
    this.plumeInnerMat.color = new THREE.Color('#fff1d6');
    const cone = new THREE.ConeGeometry(1, 1, 24, 1, true);
    cone.translate(0, -0.5, 0);
    this.plumeOuter = new THREE.Mesh(cone, this.plumeMat);
    this.plumeInner = new THREE.Mesh(cone.clone(), this.plumeInnerMat);
    for (const p of [this.plumeOuter, this.plumeInner]) {
      p.position.y = -1.75;
      p.visible = false;
      p.renderOrder = 2;
      this.root.add(p);
    }

    this.engineLight = new THREE.PointLight('#ffb070', 0, 70, 2);
    this.engineLight.position.y = -2.6;
    this.root.add(this.engineLight);

    // Legs: four in an X, each a main strut, two braces and a round footpad.
    const legs = new THREE.Group();
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const pad = new THREE.Vector3(sx * LEG_SPREAD, -LEG_DROP + 0.06, sz * LEG_SPREAD);
        const top = new THREE.Vector3(sx * 0.95, 0.05, sz * 0.95);
        const knee = top.clone().lerp(pad, 0.55);
        legs.add(strut(top, pad, 0.075, legMat));
        legs.add(strut(new THREE.Vector3(sx * 1.05, -1.05, sz * 0.35), knee, 0.04, legMat));
        legs.add(strut(new THREE.Vector3(sx * 0.35, -1.05, sz * 1.05), knee, 0.04, legMat));
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.3, 0.12, 20), legMat);
        foot.position.set(pad.x, -LEG_DROP + 0.06, pad.z);
        legs.add(foot);
      }
    }
    this.root.add(this.body, legs);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m !== this.plumeOuter && m !== this.plumeInner && m.material !== this.nozzleGlow) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
  }

  /**
   * Engine look for this frame. `flicker` is 0..1 noise from the seeded RNG (0 in reduced
   * motion or frozen tests, so the frame is stable).
   */
  setEngine(throttle: number, flicker: number, lightScale: number): void {
    const on = throttle > 0;
    const k = on ? 0.35 + 0.65 * throttle : 0;
    const f = 1 + (flicker - 0.5) * 0.18;
    this.plumeOuter.visible = on;
    this.plumeInner.visible = on;
    if (on) {
      this.plumeOuter.scale.set(0.95 + 0.6 * k, (2.2 + 5.5 * k) * f, 0.95 + 0.6 * k);
      this.plumeInner.scale.set(0.4 + 0.25 * k, (1.2 + 3 * k) * f, 0.4 + 0.25 * k);
      this.plumeMat.opacity = 0.16 * k;
      this.plumeInnerMat.opacity = 0.38 * k;
    }
    this.nozzleGlow.opacity = k * 0.9;
    this.engineLight.intensity = on ? 900 * k * f * lightScale : 0;
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      const mat = m.material as THREE.Material & { normalMap?: THREE.Texture | null };
      mat.normalMap?.dispose();
      mat.dispose();
    });
    this.root.removeFromParent();
  }
}
