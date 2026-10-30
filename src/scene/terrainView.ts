/**
 * Terrain rendering: real LOLA heights at true scale (vertical exaggeration 1.0).
 *
 * - Far mesh: the whole 15.3 km square at the quality tier's level of detail (256, 128 or 64
 *   vertices a side). Lower tiers are resampled from the full grid.
 * - Near patch: about 1.9 km around the lander at full data resolution (each 60 m cell split in
 *   two), so the ground under the footpads matches the sim at every tier. The far mesh skips
 *   (discards) the pixels under the patch, 1 m inside its edge, and a two-sided skirt hides the
 *   seam from inside and outside the patch.
 *
 * Colour: regolith tinted per site (maria darker and warmer, highlands lighter), brighter on
 * steep slopes, a broad two-octave brightness variation (about +-12%), baked long sun shadows
 * (bluish) and a decorative crater detail map. The shader samples the detail at two scales (150 m
 * and about 520 m, rotated 37 degrees) so the repeat does not show, and fades the detail normals
 * far away. Detail is decoration, not data.
 */
import * as THREE from 'three';
import type { Rng } from '../kit/prng';
import type { SiteLook } from '../sim/sites';
import type { Terrain } from '../sim/terrain';
import { sampleBaked } from './shade';
import { makeValueNoise, type RegolithDetail } from './textures';

/** World metres per repeat of the detail map. */
const DETAIL_TILE = 150;
/** Near patch half size in data cells, and the split of each cell. */
const PATCH_HALF = 16;
const PATCH_SUB = 2;
/** Recentre the patch when the lander is this many cells from its centre. */
const PATCH_SLACK = 5;
const SKIRT = 30;
/** The far mesh is discarded this far (m) inside the patch edge, so it tucks under the patch. */
const PATCH_INSET = 1;

/** Default regolith colours (hex is sRGB; three stores them linear): warm grey, fresh slopes. */
export const DEFAULT_LOOK: SiteLook = {
  regolith: '#8e877d',
  fresh: '#aaa49b',
  craterDensity: 1,
  craterScale: 1,
};
/** Linear multiplier inside baked shadows: dim and a little blue (earthshine and sky fill). */
const SHADOW_TINT = { r: 0.3, g: 0.34, b: 0.46 } as const;

/**
 * Detail sampling at two scales, mixed 60/40: the 150 m tile and a rotated, larger copy (0.29 x
 * the frequency, about 520 m). The second normal sample is rotated back into the first frame.
 * Detail normals fade to 30% between 250 m and 600 m from the camera.
 */
const DETAIL_GLSL = /* glsl */ `
const mat2 mtRot = mat2(0.79864, 0.60182, -0.60182, 0.79864);
const mat2 mtRotInv = mat2(0.79864, -0.60182, 0.60182, 0.79864);
vec2 mtUv2(vec2 uv) { return mtRot * uv * 0.29; }
`;

const MAP_GLSL = /* glsl */ `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = mix( texture2D( map, vMapUv ), texture2D( map, mtUv2( vMapUv ) ), 0.4 );
  diffuseColor *= sampledDiffuseColor;
#endif
`;

const NORMAL_GLSL = /* glsl */ `
#if defined( USE_NORMALMAP_TANGENTSPACE )
  vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
  vec3 mapN2 = texture2D( normalMap, mtUv2( vNormalMapUv ) ).xyz * 2.0 - 1.0;
  mapN.xy = mix( mapN.xy, mtRotInv * mapN2.xy, 0.4 );
  mapN.xy *= normalScale * mix( 1.0, 0.3, smoothstep( 250.0, 600.0, length( vViewPosition ) ) );
  normal = normalize( tbn * mapN );
#endif
`;

/** Add the two-scale detail to a standard material's fragment shader. */
function addDetail(shader: { fragmentShader: string }): void {
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', `${DETAIL_GLSL}\nvoid main() {`)
    .replace('#include <map_fragment>', MAP_GLSL)
    .replace('#include <normal_fragment_maps>', NORMAL_GLSL);
}

export type Lod = 256 | 128 | 64;

export interface TerrainSource {
  terrain: Terrain;
  /** Baked sun light factor per grid point (0..1). */
  lit: Float32Array;
  /** Seed for colour variation. */
  seed: number;
  /** Site colours and crater detail (decoration). */
  look: SiteLook;
}

interface GridSpec {
  /** Vertex count per side. */
  n: number;
  x0: number;
  z0: number;
  /** Vertex spacing (m). */
  step: number;
  skirt: boolean;
}

export class TerrainView {
  readonly group = new THREE.Group();
  private readonly farMaterial: THREE.MeshStandardMaterial;
  private readonly nearMaterial: THREE.MeshStandardMaterial;
  private readonly patchRect = { value: new THREE.Vector4(1, 1, -1, -1) };
  private far: THREE.Mesh | null = null;
  private near: THREE.Mesh | null = null;
  private src: TerrainSource | null = null;
  private tint: ((x: number, z: number) => number) | null = null;
  private lod: Lod;
  private patchI = -1;
  private patchJ = -1;
  private readonly tmp = new THREE.Color();
  private readonly regolith = new THREE.Color(DEFAULT_LOOK.regolith);
  private readonly fresh = new THREE.Color(DEFAULT_LOOK.fresh);
  private detail: RegolithDetail;

  constructor(detail: RegolithDetail, lod: Lod) {
    this.lod = lod;
    this.detail = detail;
    this.group.name = 'terrain';
    const base = {
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
      envMapIntensity: 0,
      map: detail.albedo,
      normalMap: detail.normal,
      normalScale: new THREE.Vector2(0.6, 0.6),
    };
    this.nearMaterial = new THREE.MeshStandardMaterial(base);
    this.farMaterial = new THREE.MeshStandardMaterial(base);
    this.nearMaterial.onBeforeCompile = (shader) => addDetail(shader);
    this.nearMaterial.customProgramCacheKey = () => 'moon-terrain-near';
    const rect = this.patchRect;
    this.farMaterial.onBeforeCompile = (shader) => {
      addDetail(shader);
      shader.uniforms['uPatch'] = rect;
      shader.vertexShader =
        'varying vec2 vWorldXZ;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n  vWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;',
        );
      shader.fragmentShader =
        'uniform vec4 uPatch;\nvarying vec2 vWorldXZ;\n' +
        shader.fragmentShader.replace(
          'void main() {',
          'void main() {\n  if (vWorldXZ.x > uPatch.x && vWorldXZ.x < uPatch.z && vWorldXZ.y > uPatch.y && vWorldXZ.y < uPatch.w) discard;',
        );
    };
    this.farMaterial.customProgramCacheKey = () => 'moon-terrain-far';
  }

  get terrain(): Terrain | null {
    return this.src?.terrain ?? null;
  }

  /** Swap the detail maps (a new site look). The caller owns the old maps. */
  setDetail(detail: RegolithDetail): void {
    this.detail = detail;
    for (const m of [this.nearMaterial, this.farMaterial]) {
      m.map = detail.albedo;
      m.normalMap = detail.normal;
    }
  }

  get detailMaps(): RegolithDetail {
    return this.detail;
  }

  setSource(src: TerrainSource, rng: Rng): void {
    this.src = src;
    this.regolith.set(src.look.regolith);
    this.fresh.set(src.look.fresh);
    const noise = makeValueNoise(rng, 64);
    // Broad brightness variation in three octaves (about +-12%), so the far field does not look
    // flat or tiled.
    this.tint = (x, z) => {
      const u = x / 900 + 32;
      const v = z / 900 + 32;
      return 0.88 + 0.15 * noise(u, v) + 0.06 * noise(u * 3.1, v * 3.1) + 0.03 * noise(u * 9.7 + 5, v * 9.7 + 5);
    };
    this.patchI = -1;
    this.patchJ = -1;
    this.buildFar();
    this.updatePatch(0, 0);
  }

  setLod(lod: Lod): void {
    if (lod === this.lod) return;
    this.lod = lod;
    if (this.src) this.buildFar();
  }

  /** Keep the full-resolution patch under the lander. */
  updatePatch(x: number, z: number): void {
    const src = this.src;
    if (!src) return;
    const t = src.terrain;
    const lim = t.size - 1 - PATCH_HALF;
    const ci = Math.max(PATCH_HALF, Math.min(lim, Math.round(t.indexOf(x))));
    const cj = Math.max(PATCH_HALF, Math.min(lim, Math.round(t.indexOf(z))));
    if (this.near && Math.abs(ci - this.patchI) < PATCH_SLACK && Math.abs(cj - this.patchJ) < PATCH_SLACK) return;
    this.patchI = ci;
    this.patchJ = cj;
    const step = t.spacing / PATCH_SUB;
    const n = PATCH_HALF * 2 * PATCH_SUB + 1;
    const x0 = t.coordOf(ci - PATCH_HALF);
    const z0 = t.coordOf(cj - PATCH_HALF);
    const geo = this.buildGrid({ n, x0, z0, step, skirt: true });
    if (this.near) {
      this.near.geometry.dispose();
      this.near.geometry = geo;
    } else {
      this.near = new THREE.Mesh(geo, this.nearMaterial);
      this.near.name = 'terrain-near';
      this.near.receiveShadow = true;
      this.group.add(this.near);
    }
    const x1 = x0 + (n - 1) * step;
    const z1 = z0 + (n - 1) * step;
    this.patchRect.value.set(x0 + PATCH_INSET, z0 + PATCH_INSET, x1 - PATCH_INSET, z1 - PATCH_INSET);
  }

  private buildFar(): void {
    const src = this.src;
    if (!src) return;
    const t = src.terrain;
    const n = Math.min(this.lod, t.size);
    const step = t.extent / (n - 1);
    const geo = this.buildGrid({ n, x0: -t.half, z0: -t.half, step, skirt: false });
    if (this.far) {
      this.far.geometry.dispose();
      this.far.geometry = geo;
    } else {
      this.far = new THREE.Mesh(geo, this.farMaterial);
      this.far.name = 'terrain-far';
      this.far.receiveShadow = true;
      this.group.add(this.far);
    }
  }

  private colourAt(x: number, z: number, out: THREE.Color): void {
    const src = this.src;
    if (!src) return;
    const t = src.terrain;
    const slope = t.slopeAt(x, z, 30);
    const fresh = Math.min(1, Math.max(0, (slope - 0.12) / 0.35));
    out.copy(this.regolith).lerp(this.fresh, fresh);
    out.multiplyScalar(this.tint ? this.tint(x, z) : 1);
    const lit = sampleBaked(src.lit, t.size, t.indexOf(x), t.indexOf(z));
    const r = SHADOW_TINT.r + (1 - SHADOW_TINT.r) * lit;
    const g = SHADOW_TINT.g + (1 - SHADOW_TINT.g) * lit;
    const b = SHADOW_TINT.b + (1 - SHADOW_TINT.b) * lit;
    out.setRGB(out.r * r, out.g * g, out.b * b);
  }

  private buildGrid(spec: GridSpec): THREE.BufferGeometry {
    const src = this.src;
    if (!src) return new THREE.BufferGeometry();
    const t = src.terrain;
    const { n, x0, z0, step } = spec;
    const main = n * n;
    const edge = spec.skirt ? 4 * (n - 1) : 0;
    const count = main + edge;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const c = this.tmp;
    const r = Math.max(step, 2);
    const put = (k: number, x: number, y: number, z: number) => {
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      const gr = t.gradientAt(x, z, r);
      const len = Math.hypot(gr.dx, 1, gr.dz);
      nor[k * 3] = -gr.dx / len;
      nor[k * 3 + 1] = 1 / len;
      nor[k * 3 + 2] = -gr.dz / len;
      // Linear colour, the same space three uses for vertex colours.
      this.colourAt(x, z, c);
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
      uv[k * 2] = x / DETAIL_TILE;
      uv[k * 2 + 1] = z / DETAIL_TILE;
    };
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = x0 + i * step;
        const z = z0 + j * step;
        put(j * n + i, x, t.heightAt(x, z), z);
      }
    }
    const indices: number[] = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        const b = a + 1;
        const d = a + n;
        const e = d + 1;
        indices.push(a, d, b, b, d, e);
      }
    }
    if (spec.skirt) {
      // Walk the border once (clockwise from above) and hang a curtain below each edge.
      const ring: number[] = [];
      for (let i = 0; i < n - 1; i++) ring.push(i);
      for (let j = 0; j < n - 1; j++) ring.push(j * n + (n - 1));
      for (let i = n - 1; i > 0; i--) ring.push((n - 1) * n + i);
      for (let j = n - 1; j > 0; j--) ring.push(j * n);
      ring.forEach((top, k) => {
        const sk = main + k;
        put(sk, pos[top * 3] as number, (pos[top * 3 + 1] as number) - SKIRT, pos[top * 3 + 2] as number);
      });
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k] as number;
        const b = ring[(k + 1) % ring.length] as number;
        const sa = main + k;
        const sb = main + ((k + 1) % ring.length);
        // Both windings: the camera sees the skirt from outside and from inside the patch.
        indices.push(a, b, sa, b, sb, sa);
        indices.push(a, sa, b, b, sa, sb);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    return geo;
  }

  dispose(): void {
    this.far?.geometry.dispose();
    this.near?.geometry.dispose();
    this.farMaterial.dispose();
    this.nearMaterial.dispose();
    this.group.removeFromParent();
  }
}
