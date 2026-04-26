import * as THREE from 'three';

// === Public config ===

export interface GridConfig {
	/** World-unit spacings for up to 3 grid levels [fine, medium, coarse]. */
	spacings: [number, number, number];
	/** Dot RGB color as [r, g, b] in 0–1 range. */
	dotColor: [number, number, number];
	/** Base dot opacity multiplier (0–1). */
	dotAlpha: number;
	/** CSS-pixel range where a grid level fades in: [start, end]. */
	fadeIn: [number, number];
	/** CSS-pixel range where a grid level fades out: [start, end]. */
	fadeOut: [number, number];
	/** Dot radius range in CSS pixels [min, max]. Scaled by DPR internally. */
	dotRadius: [number, number];
	/** Per-level opacity weight: level i gets (base + i * step). */
	levelWeight: [number, number];
}

// Tuned to match Apple Freeform / FigJam:
//   - single perceptually-uniform grid at any zoom (levels hand off cleanly
//     without stacking their intensities)
//   - constant-perceptual-size dots (no CAD-style growth at sparser levels)
//   - soft neutral gray color carrying the lightness, not low-alpha black
export const DEFAULT_GRID_CONFIG: GridConfig = {
	spacings: [20, 100, 500],
	dotColor: [0.75, 0.77, 0.8],
	dotAlpha: 1.0,
	fadeIn: [8, 16],
	fadeOut: [120, 200],
	dotRadius: [0.75, 0.75],
	levelWeight: [1.0, 0.0],
};

// === Shader source ===

const vertexShader = /* glsl */ `
void main() {
	gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

uniform vec2 u_resolution;    // device pixels
uniform vec2 u_camera;        // world-space top-left
uniform float u_zoom;         // CSS zoom
uniform float u_dpr;          // device pixel ratio
uniform vec3 u_spacings;      // world-unit grid spacings
uniform vec3 u_dotColor;      // dot RGB
uniform float u_dotAlpha;     // dot base alpha
uniform vec2 u_fadeIn;        // CSS-px [start, end]
uniform vec2 u_fadeOut;       // CSS-px [start, end]
uniform vec2 u_dotRadius;     // CSS-px [min, max]
uniform vec2 u_levelWeight;   // [base, step]

void main() {
	vec2 devicePos = gl_FragCoord.xy;
	devicePos.y = u_resolution.y - devicePos.y;

	float effectiveZoom = u_zoom * u_dpr;
	vec2 worldPos = devicePos / effectiveZoom + u_camera;

	float totalAlpha = 0.0;

	for (int i = 0; i < 3; i++) {
		float spacing;
		if (i == 0) spacing = u_spacings.x;
		else if (i == 1) spacing = u_spacings.y;
		else spacing = u_spacings.z;

		// Screen spacing in CSS pixels (DPR-independent for consistent fading)
		float cssSpacing = spacing * u_zoom;

		// Fade curve
		float opacity = 0.0;
		if (cssSpacing >= u_fadeIn.x && cssSpacing < u_fadeIn.y) {
			opacity = (cssSpacing - u_fadeIn.x) / (u_fadeIn.y - u_fadeIn.x);
		} else if (cssSpacing >= u_fadeIn.y && cssSpacing < u_fadeOut.x) {
			opacity = 1.0;
		} else if (cssSpacing >= u_fadeOut.x && cssSpacing < u_fadeOut.y) {
			opacity = 1.0 - (cssSpacing - u_fadeOut.x) / (u_fadeOut.y - u_fadeOut.x);
		}
		if (opacity <= 0.001) continue;

		// Distance to nearest grid intersection in device pixels
		vec2 f = fract(worldPos / spacing + 0.5) - 0.5;
		float dist = length(f) * spacing * effectiveZoom;

		// Dot radius in device pixels — optionally grows for sparser levels
		// (set u_dotRadius.x == u_dotRadius.y for Freeform/FigJam-style
		// constant-size dots)
		float t = clamp((cssSpacing - u_fadeIn.x) / 40.0, 0.0, 1.0);
		float radius = mix(u_dotRadius.x, u_dotRadius.y, t) * u_dpr;

		// Anti-aliased dot (0.5 device pixel smoothstep)
		float dot = 1.0 - smoothstep(radius - 0.5, radius + 0.5, dist);

		// Per-level weight: base + i * step. Step=0 keeps all levels at equal
		// intensity; positive step emphasizes coarser levels (CAD feel).
		float weight = u_levelWeight.x + float(i) * u_levelWeight.y;

		// Composite with max, not sum. Additive compositing causes anti-
		// aliased dot rims to stack at joint intersections (every N-th dot
		// visibly fatter — a CAD tell). max() guarantees a joint intersection
		// looks identical to a single-level dot, matching Freeform / FigJam.
		totalAlpha = max(totalAlpha, dot * opacity * weight);
	}

	gl_FragColor = vec4(u_dotColor, clamp(totalAlpha * u_dotAlpha, 0.0, 1.0));
}
`;

// === Renderer class ===

/**
 * Draws the infinite dot-grid background into a THREE.WebGLRenderer.
 * The renderer is owned by the parent (see {@link WebGLManager}) — this class
 * only contributes a scene, camera, and shader material.
 */
export class GridRenderer {
	private scene: THREE.Scene;
	private camera: THREE.OrthographicCamera;
	private material: THREE.ShaderMaterial;
	private mesh: THREE.Mesh;

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
				u_spacings: { value: new THREE.Vector3(...DEFAULT_GRID_CONFIG.spacings) },
				u_dotColor: { value: new THREE.Vector3(...DEFAULT_GRID_CONFIG.dotColor) },
				u_dotAlpha: { value: DEFAULT_GRID_CONFIG.dotAlpha },
				u_fadeIn: { value: new THREE.Vector2(...DEFAULT_GRID_CONFIG.fadeIn) },
				u_fadeOut: { value: new THREE.Vector2(...DEFAULT_GRID_CONFIG.fadeOut) },
				u_dotRadius: { value: new THREE.Vector2(...DEFAULT_GRID_CONFIG.dotRadius) },
				u_levelWeight: { value: new THREE.Vector2(...DEFAULT_GRID_CONFIG.levelWeight) },
			},
			transparent: true,
			depthTest: false,
			depthWrite: false,
		});

		// Fullscreen triangle (more efficient than quad — no diagonal seam)
		const geometry = new THREE.BufferGeometry();
		const vertices = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);
		geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

		this.mesh = new THREE.Mesh(geometry, this.material);
		this.scene.add(this.mesh);
	}

	/** Apply a (partial) grid config. Only provided fields are updated. */
	setConfig(config: Partial<GridConfig>) {
		const u = this.material.uniforms;
		if (config.spacings) u.u_spacings.value.set(...config.spacings);
		if (config.dotColor) u.u_dotColor.value.set(...config.dotColor);
		if (config.dotAlpha !== undefined) u.u_dotAlpha.value = config.dotAlpha;
		if (config.fadeIn) u.u_fadeIn.value.set(...config.fadeIn);
		if (config.fadeOut) u.u_fadeOut.value.set(...config.fadeOut);
		if (config.dotRadius) u.u_dotRadius.value.set(...config.dotRadius);
		if (config.levelWeight) u.u_levelWeight.value.set(...config.levelWeight);
	}

	setSize(width: number, height: number, dpr = 1) {
		const u = this.material.uniforms;
		u.u_resolution.value.set(width * dpr, height * dpr);
		u.u_dpr.value = dpr;
	}

	render(renderer: THREE.WebGLRenderer, cameraX: number, cameraY: number, zoom: number) {
		const u = this.material.uniforms;
		u.u_camera.value.set(cameraX, cameraY);
		u.u_zoom.value = zoom;
		renderer.render(this.scene, this.camera);
	}

	dispose() {
		this.mesh.geometry.dispose();
		this.material.dispose();
	}
}
