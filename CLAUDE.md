# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Related repositories
**Docs** — `../Docs/` (separate git repo). Language and compiler documentation templates, filled incrementally.
Agent index: `../Docs/CLAUDE.md` — maps each topic to its file so agents can fetch exactly what they need.

## What this is

Zinc is a compiled programming language being built from scratch. The repository contains the compiler frontend, written in TypeScript. Source files use the `.zn` extension.

## Commands

**Run the compiler** (no build step needed for development):
```
npx tsx src/main.ts
```

**Type-check** (emitting is disabled via `allowImportingTsExtensions`):
```
npx tsc --noEmit
```

**Build** (note: currently blocked by `allowImportingTsExtensions` + no `noEmit`):
```
npm run build
```

There is no test runner. The test file is `testFiles/main.zn` and is exercised by running the compiler directly.

## Architecture

The compiler pipeline runs in three stages coordinated by `FileManager`:

```
compile(path)
  └─ FileManager(path)
       ├─ lexer.findImports()   → discovers transitive imports (pre-lex pass)
       ├─ lexer.lexFile()       → produces Token[]
       └─ parser.parseFile()    → produces Program (AST)
```

**`src/compile.ts`** — entry point. Walks the import graph (BFS), creates a `FileManager` per file, then calls `buildAST()` on each.

**`src/file/fileManager/fileManager.ts`** — `FileManager` is the central context object. It owns the `Lexer`, `Parser`, `Token[]`, the resulting `Program` (AST root), and the file's `exports: Node[]`. Both lexer and parser hold a reference back to it.

**`src/lexer/lexer.ts`** — `Lexer` reads a `FileBuffer` character-by-character. `findImports()` is a fast pre-pass that scans only `import` statements (resetting the buffer afterward). `lexFile()` does a full lex and returns a `Token[]`. Identifiers and string literals are interned into maps; tokens carry a numeric `data` field that is the interned index (for identifiers/strings) or the literal value (for numbers/chars).

**`src/parser/parser.ts`** — `Parser` is a recursive-descent parser. It uses `peek()`/`match()`/`getToken()` to advance through `Token[]`. Expression parsing uses the standard precedence-climbing chain: `parseAssignment → parseTernary → parseLogicalOr → … → parsePrimary`. `parseToken()` dispatches on statement-level keywords.

**`src/lexer/lexerTypes.ts`** — defines `TokenType` (all token kinds), `Token`, `CharType`, `LexerError`, and `ScopeExitOperation` (a bitmask used to close string template interpolations when `}` is encountered).

**`src/parser/ParserTypes.ts`** — defines the full AST: `Node` (a discriminated union), all node interfaces, operator enums, and `ParserError`.

**`src/global/types/globalTypes.ts`** — `TypeKind` (the type system enum used across lexer and parser), and `BugError` (for internal compiler invariant violations, distinct from user-facing parse/lex errors).

**`src/lexer/utility/buffers/`** — `FileBuffer` wraps a file for character-at-a-time reading with `getLineIndex()`/`getColumnIndex()` tracking. `BasicBuffer` is the base class.

## Current implementation status

**Working:** variable declarations (`let`/`const`), enums, `struct` declarations (fields + methods) and `class` declarations (fields, methods, `init` constructors, `extends`/`mixin`/`implements`/`owns`/`serves` clauses, and `public`/`private`/`protected`/`static`/`override` member modifiers), `interface` declarations (field signatures + bodyless method signatures), `group` declarations (named lists of type ids for bulk clause targets), `fn`/`func`/`function` declarations (params, optional return type, array types, `async`/`export` modifiers), type annotations via `parseType()` → `TypeNode` (primitive names resolved to `TypeKind`, user types carried by interned id, `[]` array suffixes, and `|` union types of two or more members with duplicates rejected; reused by `let`, params, return types, and enum backing types), all expression forms (arithmetic, bitwise, logical, ternary, string templates, field access, indexing, function calls, pre/postfix operators), all assignment operators, `if`/`else`, `while`, `loop`, `for` (C-style three-clause and `for`-in), `switch`/`case`/`default`, `break`/`continue`/`return`, `import` statements, import graph resolution, pretty-printing tokens and AST.

Declared functions populate `symbolTable.functions`; declared types (enums + structs) populate `symbolTable.types`, so type annotations and enum/struct headers pretty-print by name instead of `type#N`.

**Not yet implemented:** the type checker (including interface conformance, group-reference expansion, union narrowing/assignability, and generic arity/scope/constraint checking), lifetime inference, and code generation.

**Recently added:** generics — generic **type-parameter declarations** at binding sites (`parseTypeParameters()`, stored as `typeParameters: number[]` on `FunctionNode`/`StructNode`/`ClassNode`/`EnumNode`/`InterfaceNode`/`MethodSignatureNode`; wired into functions, methods, interface method signatures, structs, classes, enums, interfaces; duplicate names rejected; param names recorded in `declaredTypes` so body uses resolve by name) and generic **type arguments** in type annotations (`parseTypeMember()` emits a `Generic` `TypeNode` `{id, resolved, arguments}`, each argument a full `TypeNode` so unions/nested generics work; array suffixes wrap the application). `consumeGenericClose()` splits the lexer's glued `>>`/`>=`/`>>=` so nested generics (`Box<Map<K, V>>`) close correctly. Arity/scope/constraint checking is the type checker's job.

**Earlier:** `interface` declarations (`InterfaceNode`) — a body of field signatures (`FieldNode`) and bodyless method signatures (`MethodSignatureNode`, an omitted return type defaulting to `void`), duplicate member names rejected; and `group` declarations (`GroupNode`) — a comma-separated list of type ids, usable wherever a class clause (`extends`/`implements`/`owns`) names a target. `interface`/`group` are reserved keywords in the lexer (`KEYWORDS_MAP`). Both are global-scope-only and record their name in `declaredTypes` so references pretty-print by name. A group is not itself a type; expanding a group reference into its members is left to the (unwritten) type checker. Also added **union types** — `parseType()` now parses a `|`-separated list of members into a `TypeNode` `Union` (kind added to `TypeNodeKind`), with the single-member layer factored into `parseTypeMember()` and duplicate members rejected via `typeNodesEqual`. Union narrowing and the tagged-union runtime layout are type-checker concerns and remain unimplemented.

**Still earlier:** `for` loops — both the C-style three-clause form (`for (init; cond; update) { ... }`, each clause optional, initializer declarations scoped to a shared header scope) and the `for (<ident> in <expr>) { ... }` iteration form (`ForNode` / `ForInNode`); and `import` statements (`ImportNode`) — named (`import { a, b } from "..."`), wildcard (`import * as ns from "..."`), and type-only (`import types { T } from "..."`). `in`, `from`, `as`, and `types` are contextual keywords recognised by spelling, not reserved in the lexer. The import clause order (`<spec> [as <ident>] from "<path>"`) mirrors `lexer.findImports`, which still drives import discovery as a pre-pass.