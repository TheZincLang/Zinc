/**
 * prettyPrint.ts — AST pretty printer for the R5 parser
 *
 * Usage:
 *   printAST(program, { label: "my file", symbolTable })
 *   printNode(node, { depth: 0, symbolTable })
 *
 * ─────────────────────────────────────────────────────
 * HOW TO ADD A NEW NODE TYPE
 * ─────────────────────────────────────────────────────
 * 1. Add the variant to the `Node` union and `NodeType` enum in ParserTypes.ts.
 * 2. Add a corresponding interface for the node data in ParserTypes.ts.
 * 3. In this file, add a case to the `renderNode` switch below.
 *    Each case receives `(data, ctx)` and should return a `Line[]`.
 *    Use the helper functions (leaf, header, recurse) documented above
 *    each helper to build the output.
 * 4. Optionally add a color entry in NODE_COLORS below.
 *
 * That's it — no other changes needed.
 * ─────────────────────────────────────────────────────
 */

import {
    Node, NodeType, Program,
    LetNode, TernaryNode, BinaryNode, MathNode, BitwiseNode,
    UnaryNode, PostfixNode, FieldAccessNode, LiteralNode,
    VariableNode, CallNode, StringTemplateNode,
    Modifier, ExpressionOperator, BinaryExpressionOperator,
    BitwiseOperator, UnaryOperator, PostfixOperator,
    LiteralType, StringTemplatePartType,
} from "./ParserTypes.ts"

// ─── ANSI ────────────────────────────────────────────────────────────────────

const R  = "\x1b[0m"   // reset
const DIM  = "\x1b[2m"
const BOLD = "\x1b[1m"
const C = {
    yellow:  "\x1b[33m",
    green:   "\x1b[32m",
    cyan:    "\x1b[36m",
    magenta: "\x1b[35m",
    blue:    "\x1b[34m",
    red:     "\x1b[31m",
    white:   "\x1b[37m",
    orange:  "\x1b[38;5;214m",
    teal:    "\x1b[38;5;80m",
    pink:    "\x1b[38;5;205m",
}

// ─── NODE COLORS ─────────────────────────────────────────────────────────────
// Map NodeType enum member name → ANSI color string.
// Add entries here when you add new node types (step 4 above).

const NODE_COLORS: Partial<Record<string, string>> = {
    LetNode:            C.magenta,
    TernaryNode:        C.blue,
    BinaryNode:         C.cyan,
    MathNode:           C.orange,
    BitwiseNode:        C.teal,
    UnaryNode:          C.pink,
    PostfixNode:        C.pink,
    FieldAccessNode:    C.cyan,
    LiteralNode:        C.yellow,
    VariableNode:       C.green,
    CallNode:           C.cyan,
    StringTemplateNode: C.green,
}

// ─── SYMBOL TABLE TYPES ───────────────────────────────────────────────────────

/** Optional symbol table the caller can pass in for resolving ids → names. */
export interface SymbolTable {
    variables?: Map<number, string>
    functions?:  Map<number, string>
    types?:      Map<number, string>
    strings?:    Map<number, string>
}

// ─── INTERNAL LINE REPRESENTATION ────────────────────────────────────────────

interface Line {
    indent: number
    text:   string   // may contain ANSI codes
}

// ─── CONTEXT ─────────────────────────────────────────────────────────────────

interface Ctx {
    depth:       number
    symbolTable?: SymbolTable
}

function deeper(ctx: Ctx): Ctx {
    return { ...ctx, depth: ctx.depth + 1 }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/** Render a single key→value leaf line (no children). */
function leaf(label: string, value: string, ctx: Ctx): Line {
    return {
        indent: ctx.depth,
        text:   `${DIM}${label}:${R} ${value}`,
    }
}

/** Render a node-types header with optional extra info on the same line. */
function header(typeName: string, extra = "", ctx: Ctx): Line {
    const color = NODE_COLORS[typeName] ?? C.white
    return {
        indent: ctx.depth,
        text:   `${color}${BOLD}${typeName}${R}${extra ? `  ${DIM}${extra}${R}` : ""}`,
    }
}

/** Recursively render a child Node and return its lines. */
function recurse(node: Node, ctx: Ctx): Line[] {
    return renderNode(node, ctx)
}

/** Resolve a variable id to a name via the symbol table (falls back to #id). */
function resolveVar(id: number, ctx: Ctx): string {
    return ctx.symbolTable?.variables?.get(id) ?? `${DIM}#${id}${R}`
}

/** Resolve a types id to a name via the symbol table (falls back to types#id). */
function resolveType(id: number, ctx: Ctx): string {
    return ctx.symbolTable?.types?.get(id) ?? `${DIM}type#${id}${R}`
}

/** Resolve a string pool id (falls back to str#id). */
function resolveString(id: number, ctx: Ctx): string {
    const s = ctx.symbolTable?.strings?.get(id)
    return s !== undefined ? `${C.green}"${s}"${R}` : `${DIM}str#${id}${R}`
}

/** Render a labelled group of lines (e.g. "args:", then indented children). */
function group(label: string, children: Line[][], ctx: Ctx): Line[] {
    const lines: Line[] = [{ indent: ctx.depth, text: `${DIM}${label}:${R}` }]
    for (const child of children) lines.push(...child)
    return lines
}

// ─── ENUM DISPLAY NAMES ───────────────────────────────────────────────────────

const EXPR_OP: Record<ExpressionOperator, string> = {
    [ExpressionOperator.add]:         `${C.orange}+${R}`,
    [ExpressionOperator.subtract]:    `${C.orange}-${R}`,
    [ExpressionOperator.multiply]:    `${C.orange}*${R}`,
    [ExpressionOperator.divide]:      `${C.orange}/${R}`,
    [ExpressionOperator.modulus]:     `${C.orange}%${R}`,
    [ExpressionOperator.exponentiate]:`${C.orange}**${R}`,
}

const BIN_OP: Record<BinaryExpressionOperator, string> = {
    [BinaryExpressionOperator.Or]:               `${C.cyan}||${R}`,
    [BinaryExpressionOperator.And]:              `${C.cyan}&&${R}`,
    [BinaryExpressionOperator.Equal]:            `${C.cyan}==${R}`,
    [BinaryExpressionOperator.NotEqual]:         `${C.cyan}!=${R}`,
    [BinaryExpressionOperator.LessThan]:         `${C.cyan}<${R}`,
    [BinaryExpressionOperator.LessThanOrEqual]:  `${C.cyan}<=${R}`,
    [BinaryExpressionOperator.MoreThan]:         `${C.cyan}>${R}`,
    [BinaryExpressionOperator.MoreThanOrEqual]:  `${C.cyan}>=${R}`,
}

const BIT_OP: Record<BitwiseOperator, string> = {
    [BitwiseOperator.Or]:  `${C.teal}|${R}`,
    [BitwiseOperator.Xor]: `${C.teal}^${R}`,
    [BitwiseOperator.And]: `${C.teal}&${R}`,
}

const UNARY_OP: Record<UnaryOperator, string> = {
    [UnaryOperator.increment]:   `${C.pink}++${R}`,
    [UnaryOperator.decrement]:   `${C.pink}--${R}`,
    [UnaryOperator.bitwiseNot]:  `${C.pink}~${R}`,
    [UnaryOperator.negative]:    `${C.pink}-${R}`,
    [UnaryOperator.booleanNot]:  `${C.pink}!${R}`,
}

const POSTFIX_OP: Record<PostfixOperator, string> = {
    [PostfixOperator.increment]: `${C.pink}++${R}`,
    [PostfixOperator.decrement]: `${C.pink}--${R}`,
    [PostfixOperator.index]:     `${C.pink}[]${R}`,
}

const LIT_TYPE: Record<LiteralType, string> = {
    [LiteralType.Integer]:     "int",
    [LiteralType.Float]:       "float",
    [LiteralType.Double]:      "double",
    [LiteralType.String]:      "string",
    [LiteralType.CharLiteral]: "char",
    [LiteralType.Boolean]:     "bool",
}

// ─── NODE RENDERERS ───────────────────────────────────────────────────────────
// Add a new `case NodeType.YourNode:` block here when extending (step 3 above).

function renderNode(node: Node, ctx: Ctx): Line[] {
    const typeName = NodeType[node.type]
    const lines: Line[] = []

    switch (node.type) {

        // ── LetNode ──────────────────────────────────────────────────────────
        case NodeType.LetNode: {
            const d = node.data as LetNode
            const mods = [...d.modifiers].map(m => Modifier[m]).join(", ") || "none"
            lines.push(header(typeName, undefined, ctx))
            lines.push(leaf("var",      resolveVar(d.variableId, ctx),    deeper(ctx)))
            lines.push(leaf("varType",  resolveType(d.variableType, ctx), deeper(ctx)))
            lines.push(leaf("mods",     `${DIM}${mods}${R}`,              deeper(ctx)))
            if (d.definition) {
                lines.push({ indent: deeper(ctx).depth, text: `${DIM}definition:${R}` })
                lines.push(...recurse(d.definition, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            }
            break
        }

        // ── TernaryNode ──────────────────────────────────────────────────────
        case NodeType.TernaryNode: {
            const d = node.data as TernaryNode
            lines.push(header(typeName, undefined, ctx))
            lines.push({ indent: deeper(ctx).depth, text: `${DIM}condition:${R}` })
            lines.push(...recurse(d.condition,   { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            lines.push({ indent: deeper(ctx).depth, text: `${DIM}then:${R}` })
            lines.push(...recurse(d.trueOption,  { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            lines.push({ indent: deeper(ctx).depth, text: `${DIM}else:${R}` })
            lines.push(...recurse(d.falseOption, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            break
        }

        // ── BinaryNode ───────────────────────────────────────────────────────
        case NodeType.BinaryNode: {
            const d = node.data as BinaryNode
            lines.push(header(typeName, BIN_OP[d.operator], ctx))
            lines.push(...recurse(d.left,  deeper(ctx)))
            lines.push(...recurse(d.right, deeper(ctx)))
            break
        }

        // ── MathNode ─────────────────────────────────────────────────────────
        case NodeType.MathNode: {
            const d = node.data as MathNode
            lines.push(header(typeName, EXPR_OP[d.operator], ctx))
            lines.push(...recurse(d.left,  deeper(ctx)))
            lines.push(...recurse(d.right, deeper(ctx)))
            break
        }

        // ── BitwiseNode ──────────────────────────────────────────────────────
        case NodeType.BitwiseNode: {
            const d = node.data as BitwiseNode
            lines.push(header(typeName, BIT_OP[d.operator], ctx))
            lines.push(...recurse(d.left,  deeper(ctx)))
            lines.push(...recurse(d.right, deeper(ctx)))
            break
        }

        // ── UnaryNode ────────────────────────────────────────────────────────
        case NodeType.UnaryNode: {
            const d = node.data as UnaryNode
            lines.push(header(typeName, UNARY_OP[d.operator], ctx))
            lines.push(...recurse(d.operand, deeper(ctx)))
            break
        }

        // ── PostfixNode ──────────────────────────────────────────────────────
        case NodeType.PostfixNode: {
            const d = node.data as PostfixNode
            lines.push(header(typeName, POSTFIX_OP[d.operator], ctx))
            lines.push(...recurse(d.operand, deeper(ctx)))
            if (d.arguments?.length) {
                lines.push(...group("args", d.arguments.map(a => recurse(a, { ...deeper(ctx), depth: deeper(ctx).depth + 1 })), deeper(ctx)))
            }
            break
        }

        // ── FieldAccessNode ──────────────────────────────────────────────────
        case NodeType.FieldAccessNode: {
            const d = node.data as FieldAccessNode
            lines.push(header(typeName, undefined, ctx))
            lines.push(leaf("field", resolveVar(d.field, ctx), deeper(ctx)))
            lines.push({ indent: deeper(ctx).depth, text: `${DIM}object:${R}` })
            lines.push(...recurse(d.object, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            break
        }

        // ── LiteralNode ──────────────────────────────────────────────────────
        case NodeType.LiteralNode: {
            const d = node.data as LiteralNode
            const litType = LIT_TYPE[d.type]
            lines.push(header(typeName, `${C.yellow}${d.value}${R}  ${DIM}(${litType})${R}`, ctx))
            break
        }

        // ── VariableNode ─────────────────────────────────────────────────────
        case NodeType.VariableNode: {
            const d = node.data as VariableNode
            lines.push(header(typeName, resolveVar(d.variableId, ctx), ctx))
            break
        }

        // ── CallNode ─────────────────────────────────────────────────────────
        case NodeType.CallNode: {
            const d = node.data as CallNode
            lines.push(header(typeName, undefined, ctx))
            lines.push({ indent: deeper(ctx).depth, text: `${DIM}callee:${R}` })
            lines.push(...recurse(d.object, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            if (d.arguments.length) {
                lines.push(...group("args", d.arguments.map(a => recurse(a, { ...deeper(ctx), depth: deeper(ctx).depth + 1 })), deeper(ctx)))
            }
            break
        }

        // ── StringTemplateNode ───────────────────────────────────────────────
        case NodeType.StringTemplateNode: {
            const d = node.data as StringTemplateNode
            lines.push(header(typeName, `${DIM}(${d.parts.length} parts)${R}`, ctx))
            for (const part of d.parts) {
                if (part.type === StringTemplatePartType.string) {
                    lines.push(leaf("str", resolveString(part.value, deeper(ctx)), deeper(ctx)))
                } else {
                    lines.push({ indent: deeper(ctx).depth, text: `${DIM}expr:${R}` })
                    lines.push(...recurse(part.value, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
                }
            }
            break
        }

        // ── FALLBACK ─────────────────────────────────────────────────────────
        default: {
            console.log("this should never happen, add a case for the new node types in renderNode!")
            /* lines.push(header(typeName ?? `UnknownNode(${node.types})`, undefined, ctx))
            lines.push(leaf("data", JSON.stringify((node as any).data), deeper(ctx))) */
        }
    }

    return lines
}

// ─── TREE RENDERING ──────────────────────────────────────────────────────────

const INDENT_BRANCH = `${DIM}│  ${R}`
const INDENT_LAST   = `   `
const PREFIX_BRANCH = `${DIM}├─ ${R}`
const PREFIX_LAST   = `${DIM}└─ ${R}`

/**
 * Render a list of Line objects as a tree with box-drawing connectors.
 * Each depth level increments by 1; connectors are calculated from consecutive depths.
 */
function renderLines(lines: Line[]): string {
    // We need to know, for each line, whether it's the last sibling at each depth level.
    // Strategy: group into a tree, then render.
    // Simpler: for each line, track the set of depths that still have upcoming siblings.

    const result: string[] = []
    const depthHasMore: boolean[] = [] // index = depth, value = true if more siblings follow

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const depth = line.indent

        // For this depth: is there a next line at the same or shallower depth?
        depthHasMore[depth] = false
        for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].indent <= depth) {
                depthHasMore[depth] = lines[j].indent === depth
                break
            }
        }

        let prefix = ""
        for (let d = 0; d < depth; d++) {
            if (d === depth - 1) {
                prefix += depthHasMore[depth] ? PREFIX_BRANCH : PREFIX_LAST
            } else {
                prefix += depthHasMore[d] ? INDENT_BRANCH : INDENT_LAST
            }
        }

        result.push(prefix + line.text)
    }

    return result.join("\n")
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

export interface PrintASTOptions {
    /** Optional label printed above the tree. */
    label?:       string
    /** Symbol table for resolving variable/types/string ids. */
    symbolTable?: SymbolTable
}

/**
 * Pretty-print a full Program (list of top-level nodes).
 *
 * @example
 *   printAST(program, { label: "test.r5", symbolTable: myTable })
 */
export function printAST(program: Program, opts: PrintASTOptions = {}) {
    const { label, symbolTable } = opts
    if (label) console.log(`\n${BOLD}── ${label} ──${R}`)

    const allLines: Line[] = []
    for (const node of program.children) {
        allLines.push(...renderNode(node, { depth: 0, symbolTable }))
    }

    console.log(renderLines(allLines))
    console.log(DIM + `\n${program.children.length} top-level node(s)` + R)
}

/**
 * Pretty-print a single Node (useful for debugging a sub-expression).
 *
 * @example
 *   printNode(someNode, { symbolTable: myTable })
 */
export function printNode(node: Node, opts: { symbolTable?: SymbolTable } = {}) {
    const lines = renderNode(node, { depth: 0, symbolTable: opts.symbolTable })
    console.log(renderLines(lines))
}