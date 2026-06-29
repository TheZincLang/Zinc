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

## v0 scope

This is the minimal subset needed to get codegen running. Deferred features (generics, unions, lambdas, classes, interfaces, groups, async/await, memory operators, throw/try) have been removed from the parser and lexer. They can be re-added once codegen is working.

## Current implementation status

**Working (v0):** variable declarations (`let`/`const`), enums (basic tagged values), `struct` declarations (fields + methods, no access modifiers, no defaults), `fn`/`func`/`function` declarations (positional params, optional return type, array types, `export` modifier), type annotations via `parseType()` → `TypeNode` (primitive names resolved to `TypeKind`, user types by interned id, `[]` array suffixes), all expression forms (arithmetic, bitwise, logical, ternary, string templates, field access, indexing, function calls, pre/postfix operators), all assignment operators, `if`/`else`, `while`, `loop`, `for` (C-style three-clause and `for`-in), `switch`/`case`/`default`, `break`/`continue`/`return`, `import` statements (named / wildcard / aliased / type-only), import graph resolution, pretty-printing tokens and AST.

Declared functions populate `symbolTable.functions`; declared types (enums + structs) populate `symbolTable.types`, so type annotations and struct/enum headers pretty-print by name instead of `type#N`.

**Not yet implemented:** type checker, lifetime inference, code generation (LLVM backend).

**Deferred (not in v0):** union types, lambdas/closures, generics, interfaces, classes/inheritance, memory operators (`move`/`borrow`/`ref`/`delete`), mixins, `owns`/`serves`, groups, concurrency (`async`/`await`), `throw`/`try`/`catch`, `new`/`typeof`/`sizeof`.