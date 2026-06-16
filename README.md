# Zinc

Zinc is a compiled, statically typed programming language built from scratch. It
aims for the safety and performance of a systems language while keeping the
high-level ergonomics of TypeScript — write in whatever paradigm suits the
problem, and drop to low-level primitives only where it actually matters.

This repository holds the **compiler frontend**, written in TypeScript. Source
files use the `.zn` extension.

> Status: **earliest development.** The lexer and parser are largely working;
> the type checker and code generation are not yet implemented.

## Goals

- **Safety** — prevent null dereferences, buffer overflows, use-after-free, and
  data races through a mix of static and runtime checks.
- **Performance** — efficient machine code with minimal overhead, comparable to
  C/C++. No garbage collector.
- **Expressiveness** — procedural, object-oriented, and functional styles, plus
  TypeScript-like abstractions (union types, type narrowing, string templates,
  closures) with no runtime penalty.
- **Developer experience** — clear error messages, fast compilation, a smooth
  workflow.

## Design philosophy

Zinc does not force a trade-off between high- and low-level code. A plain `=` is
a copy, and the ownership system is entirely opt-in — most programs never touch
it. In the hot path, reach for `move` / `borrow` / `ref` and manual memory
control; everywhere else, use the high-level abstractions for free.

```zn
let x: i32 = 42
const name = "zinc"
let msg = `Hello ${name}, count = ${x + 1}`

if x > 0 {
  return x
} else {
  return -x
}
```

## Getting started

Requires Node.js. No build step is needed for development — the compiler runs
directly via [`tsx`](https://github.com/privatenumber/tsx).

```bash
npm install

# Run the compiler (entry point: src/main.ts)
npx tsx src/main.ts

# Type-check the TypeScript sources
npx tsc --noEmit
```

There is no test runner yet. `testFiles/main.zn` is the scratch input exercised
by running the compiler directly.

## Architecture

The pipeline runs in stages coordinated by `FileManager`:

```
compile(path)
  └─ FileManager(path)
       ├─ lexer.findImports()   → discovers transitive imports (pre-lex pass)
       ├─ lexer.lexFile()       → produces Token[]
       └─ parser.parseFile()    → produces Program (AST)
```

| Path                                    | Responsibility                                             |
|-----------------------------------------|------------------------------------------------------------|
| `src/main.ts`                           | CLI entry — reads a path arg and calls `compile()`         |
| `src/compile.ts`                        | BFS walk of the import graph; one `FileManager` per file   |
| `src/file/fileManager/fileManager.ts`   | Central per-file context — owns lexer, parser, tokens, AST |
| `src/lexer/lexer.ts`                    | Character-by-character lexer; import pre-pass + full lex   |
| `src/parser/parser.ts`                  | Recursive-descent, precedence-climbing parser              |
| `src/lexer/lexerTypes.ts`               | `TokenType`, `Token`, `LexerError`, `ScopeExitOperation`   |
| `src/parser/ParserTypes.ts`             | The full AST (`Node` union), operator enums, `ParserError` |
| `src/global/types/globalTypes.ts`       | `TypeKind` enum and `BugError`                             |

## Implementation status

**Working:** `let` / `const` declarations, `enum`, `struct` and `class`
declarations (fields, methods, `init` constructors, `extends` / `implements` /
`owns` / `serves` clauses, member modifiers), `fn` / `func` / `function`
declarations, type annotations, all expression forms (arithmetic, bitwise,
logical, ternary, string templates, field access, indexing, calls, pre/postfix
operators), all assignment operators, `if` / `else`, `while`, `switch`, `break`
/ `continue` / `return`, import-graph resolution, and pretty-printing of tokens
and AST.

**Not yet implemented:** `for` loops, `import` statements, the type checker,
lifetime inference, and code generation (LLVM backend).

## Documentation

Language and compiler reference documentation lives in the companion
[Docs](../Docs) repository.

## License

See [LICENSE](LICENSE).
