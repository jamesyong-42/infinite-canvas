import { ShaderMaterial, type Texture } from 'three';

/**
 * Passthrough composition shader (RFC-002 Phase 4 stub).
 *
 * Samples a widget's render target with the quad's UVs and writes the
 * result. No upsampler, no zoom-band logic — Phase 5 swaps in a smarter
 * sampler. Discards fully-transparent fragments so empty widget regions
 * do not occlude anything behind them.
 */
export class CompositionMaterial extends ShaderMaterial {
	constructor(map: Texture | null = null) {
		super({
			uniforms: {
				map: { value: map },
				/** Per-widget alpha — used by drag-lift effects in Phase 7. */
				opacity: { value: 1 },
			},
			vertexShader: /* glsl */ `
				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				}
			`,
			fragmentShader: /* glsl */ `
				uniform sampler2D map;
				uniform float opacity;
				varying vec2 vUv;
				void main() {
					vec4 color = texture2D(map, vUv);
					if (color.a < 0.001) discard;
					gl_FragColor = vec4(color.rgb, color.a * opacity);
				}
			`,
			transparent: true,
			depthWrite: false,
		});
	}

	setMap(map: Texture | null) {
		this.uniforms.map.value = map;
	}

	setOpacity(value: number) {
		this.uniforms.opacity.value = value;
	}
}
