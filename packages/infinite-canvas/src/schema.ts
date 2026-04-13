/**
 * Minimal Standard Schema v1 type definition.
 *
 * Compatible with Zod 3.24+, Valibot, ArkType, and any other library that
 * implements the spec at https://standardschema.dev. We do not depend on any
 * validator — users bring their own.
 *
 * Today we only carry the type parameter for `T`. Runtime validation via
 * `validate()` is wired in by features that need it (inspector, serialization).
 */

// biome-ignore lint/style/useNamingConvention: Standard Schema v1 uses this exact namespace name
export interface StandardSchemaV1<Input = unknown, Output = Input> {
	readonly '~standard': StandardSchemaV1.Props<Input, Output>;
}

// biome-ignore lint/style/useNamingConvention: Standard Schema v1 uses this exact namespace name
export namespace StandardSchemaV1 {
	export interface Props<Input = unknown, Output = Input> {
		readonly version: 1;
		readonly vendor: string;
		readonly validate: (value: unknown) => Result<Output> | Promise<Result<Output>>;
		readonly types?: Types<Input, Output>;
	}

	export type Result<Output> = SuccessResult<Output> | FailureResult;

	export interface SuccessResult<Output> {
		readonly value: Output;
		readonly issues?: undefined;
	}

	export interface FailureResult {
		readonly issues: ReadonlyArray<Issue>;
	}

	export interface Issue {
		readonly message: string;
		readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
	}

	export interface PathSegment {
		readonly key: PropertyKey;
	}

	export interface Types<Input = unknown, Output = Input> {
		readonly input: Input;
		readonly output: Output;
	}

	export type InferOutput<Schema extends StandardSchemaV1> = NonNullable<
		Schema['~standard']['types']
	>['output'];
}
