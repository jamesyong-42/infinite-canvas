import { ShaderMaterial, type Texture, Vector2, Vector3, Vector4 } from 'three';

/**
 * Module-level shared uniforms for the overlap glow.
 *
 * Every {@link CompositionMaterial} instance references THESE EXACT
 * Vector2 / Vector3 objects. Mutating any `.value` here propagates to
 * every R3F card simultaneously (Three.js sees them as the same uniform
 * binding). One call to `applyOverlapGlowShaderUniforms(config)` retunes
 * every card without iterating materials.
 */
export const sharedGlowUniforms = {
	uGlowColor: { value: new Vector3(0.5, 0.5, 0.5) },
	uGlowAlpha: { value: new Vector2(0.25, 0.45) }, // [candidate, target]
	uGlowFalloff: { value: new Vector2(0.3, 0.4) }, // [candidate, target] in uv
	uRimColor: { value: new Vector3(0.5, 0.5, 0.5) },
	uRimAlpha: { value: new Vector2(0.55, 0.85) }, // [candidate, target]
	uRimRadius: { value: 3 }, // 600px / 200px reference card → 3 in UV
};

/**
 * Shader pair for the composition pass — sample an sRGB-encoded widget
 * FBO and write it to the sRGB backbuffer unchanged. No tone mapping,
 * no output encoding (the FBO already holds display-ready values, see
 * RFC-002 § sRGB FBO fix).
 *
 * `uDraggedRect` + `uIsDragged` implement the RFC-003 drag-promote
 * clip: when an R3F widget is being dragged, every other widget's
 * fragments inside that widget's screen rect are discarded so the
 * promoted DOM CardChrome (now above the R3F canvas) shows through.
 *
 * `uHotPoint` + `uHotStrength` + `uIsOverlapTarget` drive the
 * single-layer overlap glow — a soft radial gradient at the
 * intersection centroid that fades out via `uGlowFalloff`. Color and
 * alpha are tunable via {@link sharedGlowUniforms}.
 */
const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// Fragment shader. Includes Three's <colorspace_fragment> chunk after
// writing gl_FragColor — Three.js's texture sampler automatically
// decodes sRGB textures to linear during the texture2D call (because
// the FBO declares colorSpace=SRGBColorSpace), so without re-encoding
// to the renderer's outputColorSpace (also sRGB) the values would land
// in the backbuffer as linear and read as washed-out / desaturated.
const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D map;
uniform vec4 uDraggedRect;
uniform float uIsDragged;
uniform vec2 uHotPoint;
uniform float uHotStrength;
uniform float uIsOverlapTarget;

uniform vec3 uGlowColor;
uniform vec2 uGlowAlpha;
uniform vec2 uGlowFalloff;
uniform vec3 uRimColor;
uniform vec2 uRimAlpha;
uniform float uRimRadius;

varying vec2 vUv;

void main() {
  if (uIsDragged < 0.5) {
    vec2 sp = gl_FragCoord.xy;
    if (sp.x >= uDraggedRect.x && sp.x <= uDraggedRect.z &&
        sp.y >= uDraggedRect.y && sp.y <= uDraggedRect.w) {
      discard;
    }
  }
  vec4 c = texture2D(map, vUv);
  if (c.a < 0.001) discard;

  // Two-part overlap highlight, both tinted with uGlowColor:
  //   1. Inner glow — soft radial at the hot point, falling off to
  //      transparent at uGlowFalloff.
  //   2. Rim — a thin band along the card edge that pools toward the
  //      hot point (rimBand AND rimFocus must both be high).
  if (uHotStrength > 0.001) {
    float d = length(vUv - uHotPoint);

    // Inner glow.
    float falloff = mix(uGlowFalloff.x, uGlowFalloff.y, uIsOverlapTarget);
    float alpha = mix(uGlowAlpha.x, uGlowAlpha.y, uIsOverlapTarget);
    float glow = smoothstep(falloff, 0.0, d) * uHotStrength * alpha;
    c.rgb = mix(c.rgb, uGlowColor, glow);

    // Rim — band thickness fixed at 0.028 in uv (~3% of card on each
    // axis); brightness pools toward the hot point via rimFocus, with
    // falloff distance derived from uRimRadius (matches the DOM
    // radial-gradient(uRimRadius circle ..., transparent 40%)).
    float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float rimBand = smoothstep(0.028, 0.0, edge);
    float rimFocus = smoothstep(uRimRadius * 0.4, 0.0, d);
    float rimA = mix(uRimAlpha.x, uRimAlpha.y, uIsOverlapTarget);
    float rim = rimBand * rimFocus * uHotStrength * rimA;
    c.rgb = mix(c.rgb, uRimColor, rim);
  }

  gl_FragColor = c;
  #include <colorspace_fragment>
}
`;

/**
 * Per-instance composition material. Each widget's quad gets its own
 * instance so the per-quad uniforms (`map`, `uIsDragged`,
 * `uDraggedRect`) are independent. Three.js compiles the shader once
 * and reuses the program across instances since they share
 * vertex/fragment source — verify in dev via
 * `renderer.info.programs.length === 1` for the composition shader.
 */
export class CompositionMaterial extends ShaderMaterial {
	constructor() {
		super({
			vertexShader: VERTEX_SHADER,
			fragmentShader: FRAGMENT_SHADER,
			uniforms: {
				// Per-instance.
				map: { value: null },
				uDraggedRect: { value: new Vector4(0, 0, 0, 0) },
				uIsDragged: { value: 0 },
				uHotPoint: { value: new Vector2(0.5, 0.5) },
				uHotStrength: { value: 0 },
				uIsOverlapTarget: { value: 0 },
				// Shared across all materials — same object references so
				// mutations to `sharedGlowUniforms.X.value` propagate.
				uGlowColor: sharedGlowUniforms.uGlowColor,
				uGlowAlpha: sharedGlowUniforms.uGlowAlpha,
				uGlowFalloff: sharedGlowUniforms.uGlowFalloff,
				uRimColor: sharedGlowUniforms.uRimColor,
				uRimAlpha: sharedGlowUniforms.uRimAlpha,
				uRimRadius: sharedGlowUniforms.uRimRadius,
			},
			transparent: true,
			depthWrite: false,
		});
	}

	setMap(map: Texture | null): void {
		this.uniforms.map.value = map;
	}

	setDraggedRect(minX: number, minY: number, maxX: number, maxY: number): void {
		(this.uniforms.uDraggedRect.value as Vector4).set(minX, minY, maxX, maxY);
	}

	setIsDragged(isDragged: boolean): void {
		this.uniforms.uIsDragged.value = isDragged ? 1 : 0;
	}

	/** Set the radial-glow centre in uv space (0..1). */
	setHotPoint(x: number, y: number): void {
		(this.uniforms.uHotPoint.value as Vector2).set(x, y);
	}

	/** 0..1 — glow opacity; set to 0 to disable. */
	setHotStrength(strength: number): void {
		this.uniforms.uHotStrength.value = strength;
	}

	/** Toggle target state (mixes toward the target alpha / falloff). */
	setIsOverlapTarget(on: boolean): void {
		this.uniforms.uIsOverlapTarget.value = on ? 1 : 0;
	}
}
