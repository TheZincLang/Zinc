

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