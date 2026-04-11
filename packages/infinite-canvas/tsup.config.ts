import { defineConfig } from 'tsup';

export default defineConfig({
	entry: ['src/index.ts', 'src/ecs.ts', 'src/advanced.ts'],
	format: ['esm', 'cjs'],
	dts: true,
	sourcemap: true,
	clean: true,
	external: ['react', 'react-dom', 'three', '@react-three/fiber'],
});
