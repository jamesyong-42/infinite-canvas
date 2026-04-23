import { ShaderMaterial, type Texture } from 'three';

/**
 * Soft drop-shadow material for the composition-layer drag-lift effect
 * (RFC-002 § Phase 7). Renders a translucent black silhouette of the
 * widget's FBO underneath the composition quad — the shadow strength
 * scales with the widget's lift z so dragged cards feel "lifted off the
 * canvas" without re-rendering the widget content.
 *
 * Cheap 5-tap box blur of the FBO's alpha channel gives a soft edge
 * without a separate render pass. Discards entirely below a small
 * strength threshold so non-dragging widgets contribute zero fragments.
 */
export class ShadowMaterial extends ShaderMaterial {
	constructor() {
		super({
			uniforms: {
				map: { value: null },
				strength: { value: 0 },
				/** Half-width of the blur kernel in UV units. */
				blurRadius: { value: 0.012 },
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
				uniform float strength;
				uniform float blurRadius;
				varying vec2 vUv;
				void main() {
					if (strength < 0.001) discard;
					// 5-tap cross blur — cheap, gives a soft enough edge for
					// the drop-shadow's purpose without a separate pass.
					float a = 0.4 * texture2D(map, vUv).a;
					a += 0.15 * texture2D(map, vUv + vec2(blurRadius, 0.0)).a;
					a += 0.15 * texture2D(map, vUv - vec2(blurRadius, 0.0)).a;
					a += 0.15 * texture2D(map, vUv + vec2(0.0, blurRadius)).a;
					a += 0.15 * texture2D(map, vUv - vec2(0.0, blurRadius)).a;
					gl_FragColor = vec4(0.0, 0.0, 0.0, a * strength);
				}
			`,
			transparent: true,
			depthWrite: false,
		});
	}

	setMap(map: Texture | null) {
		this.uniforms.map.value = map;
	}

	setStrength(value: number) {
		this.uniforms.strength.value = value;
	}
}
