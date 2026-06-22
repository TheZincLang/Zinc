

export interface BugErrorOptions {
    type: BugErrorType
    message?: string
    line?: number
    column?: number
    range?: number
}

export enum BugErrorType{
    reachedUnreachableState,
    reachedUnwantedState,
}

export class BugError implements BugErrorOptions {
    type: BugErrorType
    message: string
    line: number
    column: number
    range: number
    constructor({type, message, line, column, range}: BugErrorOptions) {
        this.type = type
        this.message = message ?? "no message provided"
        this.line = line ?? -1
        this.column = column ?? -1
        this.range = range ?? 0
    }
}

export enum TypeKind {
    // primitives
    Int,
    Float,
    Double,
    Bool,
    Char,
    String,

    // void / never
    Void,
    Never,

    // user-defined
    Struct,
    Enum,
    Interface,
    TypeAlias,
    Union,          // T | U | ... — tagged union, TS syntax, C++ variant layout

    // callables
    Function,
    Lambda,
    Method,

    // wrappers / qualifiers
    Array,
    Tuple,
    Optional,   // T?
    Reference,  // &T
    Pointer,    // *T (if you expose raw pointers at all)

    // generics
    TypeParameter,   // T in fn foo<T>
    Generic,         // Foo<T, U> — a concrete instantiation of a generic

    // special inference / error states
    Unknown,    // not yet inferred
    Inferred,   // successfully inferred, waiting to be resolved
    Error,      // types error placeholder so inference can continue
}

/**
 * Maps the source spelling of a built-in primitive to its TypeKind.
 * Anything not in this map is treated as a user-defined type (resolved later
 * by name). Several aliases collapse onto the same TypeKind until the type
 * system grows distinct fixed-width integer/float kinds.
 */

export const PRIMITIVE_TYPES = new Map<string, TypeKind>([
    ["int", TypeKind.Int],
    ["i8", TypeKind.Int],
    ["i16", TypeKind.Int],
    ["i32", TypeKind.Int],
    ["i64", TypeKind.Int],
    ["u8", TypeKind.Int],
    ["u16", TypeKind.Int],
    ["u32", TypeKind.Int],
    ["u64", TypeKind.Int],
    ["float", TypeKind.Float],
    ["f32", TypeKind.Float],
    ["double", TypeKind.Double],
    ["f64", TypeKind.Double],
    ["bool", TypeKind.Bool],
    ["char", TypeKind.Char],
    ["string", TypeKind.String],
    ["void", TypeKind.Void],
])