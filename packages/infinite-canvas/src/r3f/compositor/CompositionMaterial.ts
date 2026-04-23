import { ShaderMaterial, type Texture, Vector4 } from 'three';

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
				map: { value: null },
				uDraggedRect: { value: new Vector4(0, 0, 0, 0) },
				uIsDragged: { value: 0 },
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
}
