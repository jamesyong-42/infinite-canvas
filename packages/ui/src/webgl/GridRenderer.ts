import * as THREE from 'three';

const vertexShader = /* glsl */ `
void main() {
	gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;

uniform vec2 u_resolution;   // device pixels
uniform vec2 u_camera;       // world-space top-left
uniform float u_zoom;        // CSS zoom
uniform float u_dpr;         // device pixel ratio
uniform vec3 u_spacings;     // world-unit grid spacings [8, 64, 512]
uniform vec3 u_dotColor;     // dot RGB
uniform float u_dotAlpha;    // dot base alpha

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

		// Fade curve: too dense → hidden, sweet spot → full, too sparse → fade out
		float opacity = 0.0;
		if (cssSpacing >= 4.0 && cssSpacing < 12.0) {
			opacity = (cssSpacing - 4.0) / 8.0;
		} else if (cssSpacing >= 12.0 && cssSpacing < 250.0) {
			opacity = 1.0;
		} else if (cssSpacing >= 250.0 && cssSpacing < 500.0) {
			opacity = 1.0 - (cssSpacing - 250.0) / 250.0;
		}
		if (opacity <= 0.001) continue;

		// Distance to nearest grid intersection in device pixels
		vec2 f = fract(worldPos / spacing + 0.5) - 0.5;
		float dist = length(f) * spacing * effectiveZoom;

		// Dot radius in device pixels — grows as grid becomes sparser
		float radius = mix(0.5, 1.4, clamp((cssSpacing - 4.0) / 40.0, 0.0, 1.0)) * u_dpr;

		// Anti-aliased dot (0.5 device pixel smoothstep)
		float dot = 1.0 - smoothstep(radius - 0.5, radius + 0.5, dist);

		// Larger grid levels get slightly stronger dots
		float levelWeight = 1.0 + float(i) * 0.4;
		totalAlpha += dot * opacity * levelWeight;
	}

	gl_FragColor = vec4(u_dotColor, clamp(totalAlpha * u_dotAlpha, 0.0, 1.0));
}
`;

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
				u_dotAlpha: { value: 0.2 },
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

	setSize(width: number, height: number, dpr: number = 1) {
		this.renderer.setSize(width, height, false);
		this.renderer.setPixelRatio(dpr);
		const u = this.material.uniforms;
		u.u_resolution.value.set(width * dpr, height * dpr);
		u.u_dpr.value = dpr;
	}

	render(cameraX: number, cameraY: number, zoom: number, isDark: boolean) {
		const u = this.material.uniforms;
		u.u_camera.value.set(cameraX, cameraY);
		u.u_zoom.value = zoom;

		if (isDark) {
			u.u_dotColor.value.set(1, 1, 1);
			u.u_dotAlpha.value = 0.12;
		} else {
			u.u_dotColor.value.set(0, 0, 0);
			u.u_dotAlpha.value = 0.18;
		}

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
