import * as THREE from 'three';
import type { EqualSpacingIndicator, SnapGuide } from '../../snap.js';

// === Public config (Figma-style defaults) ===

export interface SelectionConfig {
	/** Selection outline color [r,g,b] 0-1. Default: Figma blue. */
	outlineColor: [number, number, number];
	/** Selection outline width in screen px. */
	outlineWidth: number;
	/** Hover outline color [r,g,b] 0-1. */
	hoverColor: [number, number, number];
	/** Hover outline width in screen px. */
	hoverWidth: number;
	/** Handle size in screen px. */
	handleSize: number;
	/** Handle fill color [r,g,b] 0-1 (white). */
	handleFill: [number, number, number];
	/** Handle border color [r,g,b] 0-1 (same as outline). */
	handleBorder: [number, number, number];
	/** Handle border width in screen px. */
	handleBorderWidth: number;
	/** Group bbox dash length in screen px (0 = solid). */
	groupDash: number;
}

export const DEFAULT_SELECTION_CONFIG: SelectionConfig = {
	outlineColor: [0.051, 0.6, 1.0], // #0d99ff (Figma blue)
	outlineWidth: 1.5,
	hoverColor: [0.051, 0.6, 1.0],
	hoverWidth: 1.0,
	handleSize: 8,
	handleFill: [1, 1, 1],
	handleBorder: [0.051, 0.6, 1.0],
	handleBorderWidth: 1.5,
	groupDash: 4,
};

// === Bounds data passed per frame ===

export interface SelectionBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

// === Shader ===

const MAX_ENTITIES = 32;

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

// Selection data
uniform int u_count;
uniform vec4 u_bounds[${MAX_ENTITIES}];   // (worldX, worldY, width, height)
uniform int u_hoverIdx;                   // -1 = none
uniform vec4 u_groupBounds;              // group bbox (0 if count <= 1)
uniform int u_hasGroup;

// Snap guides
uniform int u_guideCount;
uniform vec4 u_guides[16];               // (axis: 0=x/1=y, position, 0, 0)
uniform int u_spacingCount;
uniform vec4 u_spacings[8];              // equal-spacing segments: (axis, from, to, perpPos)
uniform vec3 u_guideColor;

// Style
uniform vec3 u_outlineColor;
uniform float u_outlineWidth;
uniform vec3 u_hoverColor;
uniform float u_hoverWidth;
uniform float u_handleSize;
uniform vec3 u_handleFill;
uniform vec3 u_handleBorder;
uniform float u_handleBorderWidth;
uniform float u_groupDash;

// SDF for axis-aligned rectangle outline (returns distance to edge)
float sdRectOutline(vec2 p, vec2 center, vec2 halfSize) {
	vec2 d = abs(p - center) - halfSize;
	float outside = length(max(d, 0.0));
	float inside = min(max(d.x, d.y), 0.0);
	return abs(outside + inside);
}

// SDF for filled square
float sdSquare(vec2 p, vec2 center, float halfSize) {
	vec2 d = abs(p - center) - vec2(halfSize);
	return max(d.x, d.y);
}

void main() {
	if (u_count == 0 && u_hoverIdx < 0) discard;

	vec2 devicePos = gl_FragCoord.xy;
	devicePos.y = u_resolution.y - devicePos.y;

	float effectiveZoom = u_zoom * u_dpr;
	vec2 worldPos = devicePos / effectiveZoom + u_camera;

	// Screen-space conversion factor
	float pxToWorld = 1.0 / effectiveZoom;

	vec4 color = vec4(0.0);

	// --- Hover outline ---
	if (u_hoverIdx >= 0 && u_hoverIdx < ${MAX_ENTITIES}) {
		vec4 b = u_bounds[u_hoverIdx];
		vec2 center = vec2(b.x + b.z * 0.5, b.y + b.w * 0.5);
		vec2 halfSize = vec2(b.z, b.w) * 0.5;
		float dist = sdRectOutline(worldPos, center, halfSize);
		float width = u_hoverWidth * pxToWorld;
		float alpha = 1.0 - smoothstep(width - pxToWorld * 0.5, width + pxToWorld * 0.5, dist);
		color = max(color, vec4(u_hoverColor, alpha * 0.6));
	}

	// --- Selection outlines ---
	for (int i = 0; i < ${MAX_ENTITIES}; i++) {
		if (i >= u_count) break;
		vec4 b = u_bounds[i];
		vec2 center = vec2(b.x + b.z * 0.5, b.y + b.w * 0.5);
		vec2 halfSize = vec2(b.z, b.w) * 0.5;

		// Outline
		float dist = sdRectOutline(worldPos, center, halfSize);
		float width = u_outlineWidth * pxToWorld;
		float outlineAlpha = 1.0 - smoothstep(width - pxToWorld * 0.5, width + pxToWorld * 0.5, dist);
		color = max(color, vec4(u_outlineColor, outlineAlpha));

		// 8 resize handles
		float hs = u_handleSize * 0.5 * pxToWorld;
		float bw = u_handleBorderWidth * pxToWorld;
		vec2 corners[8];
		corners[0] = vec2(b.x, b.y);                          // nw
		corners[1] = vec2(b.x + b.z * 0.5, b.y);              // n
		corners[2] = vec2(b.x + b.z, b.y);                    // ne
		corners[3] = vec2(b.x + b.z, b.y + b.w * 0.5);        // e
		corners[4] = vec2(b.x + b.z, b.y + b.w);              // se
		corners[5] = vec2(b.x + b.z * 0.5, b.y + b.w);        // s
		corners[6] = vec2(b.x, b.y + b.w);                    // sw
		corners[7] = vec2(b.x, b.y + b.w * 0.5);              // w

		for (int h = 0; h < 8; h++) {
			float d = sdSquare(worldPos, corners[h], hs);
			// Fill (white)
			float fillAlpha = 1.0 - smoothstep(-pxToWorld * 0.5, pxToWorld * 0.5, d);
			// Border
			float borderDist = abs(d + bw * 0.5) - bw * 0.5;
			float borderAlpha = 1.0 - smoothstep(-pxToWorld * 0.5, pxToWorld * 0.5, borderDist);

			if (fillAlpha > 0.01) {
				// Composite: border color on top of fill
				vec3 handleColor = mix(u_handleFill, u_handleBorder, borderAlpha);
				color = vec4(handleColor, max(fillAlpha, color.a));
			}
		}
	}

	// --- Group bounding box (dashed) ---
	if (u_hasGroup == 1 && u_count > 1) {
		vec4 gb = u_groupBounds;
		vec2 center = vec2(gb.x + gb.z * 0.5, gb.y + gb.w * 0.5);
		vec2 halfSize = vec2(gb.z, gb.w) * 0.5;
		float dist = sdRectOutline(worldPos, center, halfSize);
		float width = u_outlineWidth * 0.75 * pxToWorld;
		float lineAlpha = 1.0 - smoothstep(width - pxToWorld * 0.5, width + pxToWorld * 0.5, dist);

		// Dash pattern along the rectangle perimeter
		if (u_groupDash > 0.0 && lineAlpha > 0.01) {
			vec2 rel = worldPos - vec2(gb.x, gb.y);
			float perim;
			// Approximate perimeter position for dash
			if (abs(rel.y) < width || abs(rel.y - gb.w) < width) {
				perim = rel.x;
			} else {
				perim = rel.y;
			}
			float dashWorld = u_groupDash * pxToWorld;
			float dashPattern = step(0.5, fract(perim / (dashWorld * 2.0)));
			lineAlpha *= dashPattern;
		}

		color = max(color, vec4(u_outlineColor, lineAlpha * 0.5));
	}

	// --- Snap guide lines ---
	for (int i = 0; i < 16; i++) {
		if (i >= u_guideCount) break;
		vec4 g = u_guides[i];
		float guideWidth = 0.5 * pxToWorld;
		float dist;
		if (g.x < 0.5) {
			// Vertical line (x-axis alignment)
			dist = abs(worldPos.x - g.y);
		} else {
			// Horizontal line (y-axis alignment)
			dist = abs(worldPos.y - g.y);
		}
		float guideAlpha = 1.0 - smoothstep(guideWidth - pxToWorld * 0.3, guideWidth + pxToWorld * 0.3, dist);
		color = max(color, vec4(u_guideColor, guideAlpha * 0.8));
	}

	// --- Equal spacing indicators ---
	for (int i = 0; i < 8; i++) {
		if (i >= u_spacingCount) break;
		vec4 s = u_spacings[i];
		float lineWidth = 0.5 * pxToWorld;
		float segAlpha = 0.0;
		if (s.x < 0.5) {
			// Horizontal segment (x-axis gap)
			float yDist = abs(worldPos.y - s.w);
			float xInRange = step(s.y, worldPos.x) * step(worldPos.x, s.z);
			// Center line
			segAlpha = (1.0 - smoothstep(lineWidth, lineWidth + pxToWorld, yDist)) * xInRange;
			// End bars (perpendicular marks at from and to)
			float barHeight = 4.0 * pxToWorld;
			float barFromDist = abs(worldPos.x - s.y);
			float barFromAlpha = (1.0 - smoothstep(lineWidth, lineWidth + pxToWorld, barFromDist))
				* (1.0 - smoothstep(barHeight, barHeight + pxToWorld, abs(worldPos.y - s.w)));
			float barToDist = abs(worldPos.x - s.z);
			float barToAlpha = (1.0 - smoothstep(lineWidth, lineWidth + pxToWorld, barToDist))
				* (1.0 - smoothstep(barHeight, barHeight + pxToWorld, abs(worldPos.y - s.w)));
			segAlpha = max(segAlpha, max(barFromAlpha, barToAlpha));
		} else {
			// Vertical segment (y-axis gap)
			float xDist = abs(worldPos.x - s.w);
			float yInRange = step(s.y, worldPos.y) * step(worldPos.y, s.z);
			segAlpha = (1.0 - smoothstep(lineWidth, lineWidth + pxToWorld, xDist)) * yInRange;
			float barWidth = 4.0 * pxToWorld;
			float barFromAlpha = (1.0 - smoothstep(lineWidth, lineWidth + pxToWorld, abs(worldPos.y - s.y)))
				* (1.0 - smoothstep(barWidth, barWidth + pxToWorld, abs(worldPos.x - s.w)));
			float barToAlpha = (1.0 - smoothstep(lineWidth, lineWidth + pxToWorld, abs(worldPos.y - s.z)))
				* (1.0 - smoothstep(barWidth, barWidth + pxToWorld, abs(worldPos.x - s.w)));
			segAlpha = max(segAlpha, max(barFromAlpha, barToAlpha));
		}
		color = max(color, vec4(u_guideColor, segAlpha * 0.7));
	}

	if (color.a < 0.01) discard;
	gl_FragColor = color;
}
`;

// === Renderer class ===

export class SelectionRenderer {
	private material: THREE.ShaderMaterial;
	private mesh: THREE.Mesh;
	private scene: THREE.Scene;
	private camera: THREE.OrthographicCamera;

	constructor() {
		this.scene = new THREE.Scene();
		this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

		const boundsDefault = [];
		for (let i = 0; i < MAX_ENTITIES; i++) {
			boundsDefault.push(new THREE.Vector4(0, 0, 0, 0));
		}

		this.material = new THREE.ShaderMaterial({
			vertexShader,
			fragmentShader,
			uniforms: {
				u_resolution: { value: new THREE.Vector2(1, 1) },
				u_camera: { value: new THREE.Vector2(0, 0) },
				u_zoom: { value: 1 },
				u_dpr: { value: 1 },
				u_count: { value: 0 },
				u_bounds: { value: boundsDefault },
				u_hoverIdx: { value: -1 },
				u_groupBounds: { value: new THREE.Vector4(0, 0, 0, 0) },
				u_hasGroup: { value: 0 },
				// Style (Figma defaults)
				u_outlineColor: { value: new THREE.Vector3(...DEFAULT_SELECTION_CONFIG.outlineColor) },
				u_outlineWidth: { value: DEFAULT_SELECTION_CONFIG.outlineWidth },
				u_hoverColor: { value: new THREE.Vector3(...DEFAULT_SELECTION_CONFIG.hoverColor) },
				u_hoverWidth: { value: DEFAULT_SELECTION_CONFIG.hoverWidth },
				u_handleSize: { value: DEFAULT_SELECTION_CONFIG.handleSize },
				u_handleFill: { value: new THREE.Vector3(...DEFAULT_SELECTION_CONFIG.handleFill) },
				u_handleBorder: { value: new THREE.Vector3(...DEFAULT_SELECTION_CONFIG.handleBorder) },
				u_handleBorderWidth: { value: DEFAULT_SELECTION_CONFIG.handleBorderWidth },
				u_groupDash: { value: DEFAULT_SELECTION_CONFIG.groupDash },
				// Snap guides
				u_guideCount: { value: 0 },
				u_guides: { value: Array.from({ length: 16 }, () => new THREE.Vector4(0, 0, 0, 0)) },
				u_spacingCount: { value: 0 },
				u_spacings: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 0, 0)) },
				u_guideColor: { value: new THREE.Vector3(1.0, 0.0, 0.55) }, // magenta/pink
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

	setConfig(config: Partial<SelectionConfig>) {
		const u = this.material.uniforms;
		if (config.outlineColor) u.u_outlineColor.value.set(...config.outlineColor);
		if (config.outlineWidth !== undefined) u.u_outlineWidth.value = config.outlineWidth;
		if (config.hoverColor) u.u_hoverColor.value.set(...config.hoverColor);
		if (config.hoverWidth !== undefined) u.u_hoverWidth.value = config.hoverWidth;
		if (config.handleSize !== undefined) u.u_handleSize.value = config.handleSize;
		if (config.handleFill) u.u_handleFill.value.set(...config.handleFill);
		if (config.handleBorder) u.u_handleBorder.value.set(...config.handleBorder);
		if (config.handleBorderWidth !== undefined)
			u.u_handleBorderWidth.value = config.handleBorderWidth;
		if (config.groupDash !== undefined) u.u_groupDash.value = config.groupDash;
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
		selected: SelectionBounds[],
		hovered: SelectionBounds | null,
		guides: SnapGuide[] = [],
		spacings: EqualSpacingIndicator[] = [],
	) {
		const u = this.material.uniforms;
		u.u_camera.value.set(cameraX, cameraY);
		u.u_zoom.value = zoom;

		// Upload selected bounds
		const count = Math.min(selected.length, MAX_ENTITIES);
		u.u_count.value = count;
		for (let i = 0; i < count; i++) {
			const b = selected[i];
			u.u_bounds.value[i].set(b.x, b.y, b.width, b.height);
		}

		// Upload hover
		if (hovered && count < MAX_ENTITIES) {
			// Find if hovered is in the selected list
			let hoverIdx = -1;
			for (let i = 0; i < count; i++) {
				const b = selected[i];
				if (b.x === hovered.x && b.y === hovered.y) {
					hoverIdx = i;
					break;
				}
			}
			if (hoverIdx < 0) {
				// Hovered but not selected — add to bounds array
				u.u_bounds.value[count].set(hovered.x, hovered.y, hovered.width, hovered.height);
				u.u_hoverIdx.value = count;
			} else {
				u.u_hoverIdx.value = -1; // already selected, no separate hover
			}
		} else {
			u.u_hoverIdx.value = -1;
		}

		// Group bounding box
		if (count > 1) {
			let minX = Number.POSITIVE_INFINITY,
				minY = Number.POSITIVE_INFINITY,
				maxX = Number.NEGATIVE_INFINITY,
				maxY = Number.NEGATIVE_INFINITY;
			for (let i = 0; i < count; i++) {
				const b = selected[i];
				minX = Math.min(minX, b.x);
				minY = Math.min(minY, b.y);
				maxX = Math.max(maxX, b.x + b.width);
				maxY = Math.max(maxY, b.y + b.height);
			}
			u.u_groupBounds.value.set(minX, minY, maxX - minX, maxY - minY);
			u.u_hasGroup.value = 1;
		} else {
			u.u_hasGroup.value = 0;
		}

		// Upload snap guides
		const gCount = Math.min(guides.length, 16);
		u.u_guideCount.value = gCount;
		for (let i = 0; i < gCount; i++) {
			const g = guides[i];
			u.u_guides.value[i].set(g.axis === 'x' ? 0 : 1, g.position, 0, 0);
		}

		// Upload equal spacing segments
		let sIdx = 0;
		for (const sp of spacings) {
			for (const seg of sp.segments) {
				if (sIdx >= 8) break;
				u.u_spacings.value[sIdx].set(sp.axis === 'x' ? 0 : 1, seg.from, seg.to, sp.perpPosition);
				sIdx++;
			}
		}
		u.u_spacingCount.value = sIdx;

		// Render without clearing (composites on top of grid)
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
