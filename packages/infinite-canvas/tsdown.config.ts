import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['src/index.ts', 'src/advanced.ts', 'src/devtools.ts'],
	format: ['esm', 'cjs'],
	dts: true,
	sourcemap: true,
	clean: true,
	treeshake: true,
	external: ['react', 'react-dom', 'three', '@react-three/fiber', '@jamesyong42/reactive-ecs'],
	publint: 'ci-only',
	attw: 'ci-only',
});
