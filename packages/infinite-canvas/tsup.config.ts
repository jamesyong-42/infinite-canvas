import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['src/index.ts', 'src/advanced.ts'],
	format: ['esm', 'cjs'],
	dts: true,
	sourcemap: true,
	clean: true,
	splitting: true,
	treeshake: true,
	external: ['react', 'react-dom', 'three', '@react-three/fiber', '@jamesyong42/reactive-ecs'],
});
