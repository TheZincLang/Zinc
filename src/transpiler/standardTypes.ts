import { TypeKind } from "../global/types/globalTypes.ts"

// Maps resolved primitive TypeKinds to their C type strings.
// For user-defined types (structs/enums), the emitter uses the interned name directly.
// Array types are handled separately — emit as `T*` with a length wrapper struct.

export const primitiveTypeMap = new Map<TypeKind, string>([
    [TypeKind.Int,    "int32_t"],
    [TypeKind.Float,  "float"],
    [TypeKind.Double, "double"],
    [TypeKind.Bool,   "bool"],
    [TypeKind.Char,   "char"],
    [TypeKind.String, "const char*"],
    [TypeKind.Void,   "void"],
    [TypeKind.Never,  "void"],    // _Noreturn on the function, return type is void
])

// Maps the raw written name to a C type for cases where TypeKind collapses
// aliases (e.g. i8/i16/i32/i64 all resolve to TypeKind.Int, but map to different C types).
// The emitter should check this first when a TypeNode carries the original name.
export const namedTypeMap = new Map<string, string>([
    ["i8",     "int8_t"],
    ["i16",    "int16_t"],
    ["i32",    "int32_t"],
    ["i64",    "int64_t"],
    ["int",    "int32_t"],
    ["u8",     "uint8_t"],
    ["u16",    "uint16_t"],
    ["u32",    "uint32_t"],
    ["u64",    "uint64_t"],
    ["f32",    "float"],
    ["float",  "float"],
    ["f64",    "double"],
    ["double", "double"],
    ["bool",   "bool"],
    ["char",   "char"],
    ["string", "const char*"],
    ["void",   "void"],
])
