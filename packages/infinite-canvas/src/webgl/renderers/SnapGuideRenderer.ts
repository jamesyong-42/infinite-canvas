import * as THREE from 'three';
import type { EqualSpacingIndicator, SnapGuide } from '../../ecs/spatial/snap.js';

// === Public config ===

export interface SnapGuideConfig {
	/** Guide line + spacing indicator color [r,g,b] 0-1. */
	color: [number, number, number];
	/** Line width in world pixels (constant across zoom). */
	lineWidth: number;
	/** Guide alpha (full-canvas alignment lines). */
	guideAlpha: number;
	/** Equal-spacing indicator alpha. */
	spacingAlpha: number;
}

export const DEFAULT_SNAP_GUIDE_CONFIG: SnapGuideConfig = {
	color: [1.0, 0.0, 0.55], // magenta/pink
	lineWidth: 0.5,
	guideAlpha: 0.8,
	spacingAlpha: 0.7,
};

// Hard caps. Mirror the sized uniform arrays — the shader truncates
// silently past these, which is the right call for a transient overlay.
const MAX_GUIDES = 16;
const MAX_SPACINGS = 8;

// === Shader ===

const vertexShader = /* glsl */ `
void main() {
	gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

uniform vec2 u_resolution;
uniform vec2 u_camera;
uniform float u_zoom;
uniform float u_dpr;

uniform int u_guideCount;
uniform vec4 u_guides[${MAX_GUIDES}];      // (axis: 0=x/1=y, position, 0, 0)
uniform int u_spacingCount;
uniform vec4 u_spacings[${MAX_SPACINGS}];  // (axis, from, to, perpPos)

uniform vec3 u_color;
uniform float u_lineWidth;
uniform float u_guideAlpha;
uniform float u_spacingAlpha;

void main() {
	if (u_guideCount == 0 && u_spacingCount == 0) discard;

	vec2 devicePos = gl_FragCoord.xy;
	devicePos.y = u_resolution.y - devicePos.y;

	float effectiveZoom = u_zoom * u_dpr;
	vec2 worldPos = devicePos / effectiveZoom + u_camera;
	float pxToWorld = 1.0 / effectiveZoom;
	float lineHalf = u_lineWidth * pxToWorld;

	vec4 color = vec4(0.0);

	// --- Snap guide lines (full-canvas axis alignment) ---
	for (int i = 0; i < ${MAX_GUIDES}; i++) {
		if (i >= u_guideCount) break;
		vec4 g = u_guides[i];
		float dist = g.x < 0.5 ? abs(worldPos.x - g.y) : abs(worldPos.y - g.y);
		float a = 1.0 - smoothstep(lineHalf - pxToWorld * 0.3, lineHalf + pxToWorld * 0.3, dist);
		color = max(color, vec4(u_color, a * u_guideAlpha));
	}

	// --- Equal spacing indicators (segment + end-bars) ---
	for (int i = 0; i < ${MAX_SPACINGS}; i++) {
		if (i >= u_spacingCount) break;
		vec4 s = u_spacings[i];
		float segAlpha = 0.0;
		if (s.x < 0.5) {
			// Horizontal gap segment
			float yDist = abs(worldPos.y - s.w);
			float xInRange = step(s.y, worldPos.x) * step(worldPos.x, s.z);
			segAlpha = (1.0 - smoothstep(lineHalf, lineHalf + pxToWorld, yDist)) * xInRange;
			float barHeight = 4.0 * pxToWorld;
			float barFrom = (1.0 - smoothstep(lineHalf, lineHalf + pxToWorld, abs(worldPos.x - s.y)))
				* (1.0 - smoothstep(barHeight, barHeight + pxToWorld, abs(worldPos.y - s.w)));
			float barTo = (1.0 - smoothstep(lineHalf, lineHalf + pxToWorld, abs(worldPos.x - s.z)))
				* (1.0 - smoothstep(barHeight, barHeight + pxToWorld, abs(worldPos.y - s.w)));
			segAlpha = max(segAlpha, max(barFrom, barTo));
		} else {
			// Vertical gap segment
			float xDist = abs(worldPos.x - s.w);
			float yInRange = step(s.y, worldPos.y) * step(worldPos.y, s.z);
			segAlpha = (1.0 - smoothstep(lineHalf, lineHalf + pxToWorld, xDist)) * yInRange;
			float barWidth = 4.0 * pxToWorld;
			float barFrom = (1.0 - smoothstep(lineHalf, lineHalf + pxToWorld, abs(worldPos.y - s.y)))
				* (1.0 - smoothstep(barWidth, barWidth + pxToWorld, abs(worldPos.x - s.w)));
			float barTo = (1.0 - smoothstep(lineHalf, lineHalf + pxToWorld, abs(worldPos.y - s.z)))
				* (1.0 - smoothstep(barWidth, barWidth + pxToWorld, abs(worldPos.x - s.w)));
			segAlpha = max(segAlpha, max(barFrom, barTo));
		}
		color = max(color, vec4(u_color, segAlpha * u_spacingAlpha));
	}

	if (color.a < 0.01) discard;
	gl_FragColor = color;
}
`;

/**
 * Renders alignment guide lines and equal-spacing indicators in a single
 * SDF pass. Independent of {@link SelectionRenderer} — guides participate
 * regardless of whether anything is selected, and the dragged entity may
 * have its own chrome that opts out of the engine-drawn selection frame.
 */
export class SnapGuideRenderer {
	private material: THREE.ShaderMaterial;
	private mesh: THREE.Mesh;
	private scene: THREE.Scene;
	private camera: THREE.OrthographicCamera;

	constructor() {
		this.scene = new THREE.Scene();
		this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

		this.material = new THREE.ShaderMaterial({
			vertexShader,
			fragmentShader,
			uniforms: {
				u_resolution: { value: new THREE.Vector2(1, 1) },
				u_camera: { value: new THREE.Vector2(0, 0) },
				u_zoom: { value: 1 },
				u_dpr: { value: 1 },
				u_guideCount: { value: 0 },
				u_guides: {
					value: Array.from({ length: MAX_GUIDES }, () => new THREE.Vector4(0, 0, 0, 0)),
				},
				u_spacingCount: { value: 0 },
				u_spacings: {
					value: Array.from({ length: MAX_SPACINGS }, () => new THREE.Vector4(0, 0, 0, 0)),
				},
				u_color: { value: new THREE.Vector3(...DEFAULT_SNAP_GUIDE_CONFIG.color) },
				u_lineWidth: { value: DEFAULT_SNAP_GUIDE_CONFIG.lineWidth },
				u_guideAlpha: { value: DEFAULT_SNAP_GUIDE_CONFIG.guideAlpha },
				u_spacingAlpha: { value: DEFAULT_SNAP_GUIDE_CONFIG.spacingAlpha },
			},
			transparent: true,
			depthTest: false,
			depthWrite: false,
		});

		const geometry = new THREE.BufferGeometry();
		const vertices = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);
		geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

		this.mesh = new THREE.Mesh(geometry, this.material);
		this.scene.add(this.mesh);
	}

	setConfig(config: Partial<SnapGuideConfig>) {
		const u = this.material.uniforms;
		if (config.color) u.u_color.value.set(...config.color);
		if (config.lineWidth !== undefined) u.u_lineWidth.value = config.lineWidth;
		if (config.guideAlpha !== undefined) u.u_guideAlpha.value = config.guideAlpha;
		if (config.spacingAlpha !== undefined) u.u_spacingAlpha.value = config.spacingAlpha;
	}

	setSize(resolution: THREE.Vector2, dpr: number) {
		this.material.uniforms.u_resolution.value.copy(resolution);
		this.material.uniforms.u_dpr.value = dpr;
	}

	render(
		renderer: THREE.WebGLRenderer,
		cameraX: number,
		cameraY: number,
		zoom: number,
		guides: SnapGuide[],
		spacings: EqualSpacingIndicator[],
	) {
		const u = this.material.uniforms;
		u.u_camera.value.set(cameraX, cameraY);
		u.u_zoom.value = zoom;

		const gCount = Math.min(guides.length, MAX_GUIDES);
		u.u_guideCount.value = gCount;
		for (let i = 0; i < gCount; i++) {
			const g = guides[i];
			u.u_guides.value[i].set(g.axis === 'x' ? 0 : 1, g.position, 0, 0);
		}

		let sIdx = 0;
		for (const sp of spacings) {
			for (const seg of sp.segments) {
				if (sIdx >= MAX_SPACINGS) break;
				u.u_spacings.value[sIdx].set(sp.axis === 'x' ? 0 : 1, seg.from, seg.to, sp.perpPosition);
				sIdx++;
			}
		}
		u.u_spacingCount.value = sIdx;

		const prevAutoClear = renderer.autoClear;
		renderer.autoClear = false;
		renderer.render(this.scene, this.camera);
		renderer.autoClear = prevAutoClear;
	}

	dispose() {
		this.mesh.geometry.dispose();
		this.material.dispose();
	}
}
