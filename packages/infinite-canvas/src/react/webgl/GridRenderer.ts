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

export const DEFAULT_GRID_CONFIG: GridConfig = {
	spacings: [8, 64, 512],
	dotColor: [0, 0, 0],
	dotAlpha: 0.18,
	fadeIn: [4, 12],
	fadeOut: [250, 500],
	dotRadius: [0.5, 1.4],
	levelWeight: [1.0, 0.4],
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

		// Dot radius in device pixels — grows as grid becomes sparser
		float t = clamp((cssSpacing - u_fadeIn.x) / 40.0, 0.0, 1.0);
		float radius = mix(u_dotRadius.x, u_dotRadius.y, t) * u_dpr;

		// Anti-aliased dot (0.5 device pixel smoothstep)
		float dot = 1.0 - smoothstep(radius - 0.5, radius + 0.5, dist);

		// Larger grid levels get progressively stronger dots
		float weight = u_levelWeight.x + float(i) * u_levelWeight.y;
		totalAlpha += dot * opacity * weight;
	}

	gl_FragColor = vec4(u_dotColor, clamp(totalAlpha * u_dotAlpha, 0.0, 1.0));
}
`;

// === Renderer class ===

export class GridRenderer {
	private renderer: THREE.WebGLRenderer;
	private scene: THREE.Scene;
	private camera: THREE.OrthographicCamera;
	private material: THREE.ShaderMaterial;
	private mesh: THREE.Mesh;

	constructor(canvas: HTMLCanvasElement) {
		this.renderer = new THREE.WebGLRenderer({
			canvas,
			alpha: true,
			antialias: false,
			premultipliedAlpha: false,
		});
		this.renderer.setClearColor(0x000000, 0);
		// Accumulate `renderer.info.render.calls/triangles` across multiple
		// render() calls per tick (grid + selection share this renderer). The
		// InfiniteCanvas rAF loop calls `renderer.info.reset()` once per tick
		// before the first pass.
		this.renderer.info.autoReset = false;

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
				u_spacings: { value: new THREE.Vector3(8, 64, 512) },
				u_dotColor: { value: new THREE.Vector3(0, 0, 0) },
				u_dotAlpha: { value: 0.18 },
				u_fadeIn: { value: new THREE.Vector2(4, 12) },
				u_fadeOut: { value: new THREE.Vector2(250, 500) },
				u_dotRadius: { value: new THREE.Vector2(0.5, 1.4) },
				u_levelWeight: { value: new THREE.Vector2(1.0, 0.4) },
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
		this.renderer.setSize(width, height, false);
		this.renderer.setPixelRatio(dpr);
		const u = this.material.uniforms;
		u.u_resolution.value.set(width * dpr, height * dpr);
		u.u_dpr.value = dpr;
	}

	render(cameraX: number, cameraY: number, zoom: number) {
		const u = this.material.uniforms;
		u.u_camera.value.set(cameraX, cameraY);
		u.u_zoom.value = zoom;
		this.renderer.render(this.scene, this.camera);
	}

	dispose() {
		this.mesh.geometry.dispose();
		this.material.dispose();
		this.renderer.dispose();
	}

	/** Expose for future WebGL widget rendering */
	getWebGLRenderer(): THREE.WebGLRenderer {
		return this.renderer;
	}
}
