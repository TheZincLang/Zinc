/**
 * prettyPrint.ts — AST pretty printer for the Zinc parser
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
    EnumNode, CodeBlockNode, IfNode, SwitchNode, SwitchCaseNode,
    SwitchDefaultNode, AssignmentNode, WhileNode, LoopNode, ForNode, ForInNode, ArrayLiteralNode, ReturnNode, FunctionNode,
    StructNode, FieldNode,
    ImportNode, ImportKind, TypeNode, TypeNodeKind,
    Modifier, ExpressionOperator, BinaryExpressionOperator,
    BitwiseOperator, UnaryOperator, PostfixOperator, AssignmentOperator,
    LiteralType, StringTemplatePartType,
} from "./ParserTypes.ts"
import {TypeKind} from "../global/types/globalTypes.ts"

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
    EnumNode:           C.magenta,
    CodeBlock:          C.white,
    IfNode:             C.blue,
    SwitchNode:         C.blue,
    SwitchCaseNode:     C.cyan,
    SwitchDefaultNode:  C.cyan,
    AssignmentNode:     C.magenta,
    WhileNode:          C.blue,
    LoopNode:           C.blue,
    ForNode:            C.blue,
    ForInNode:          C.blue,
    ImportNode:         C.magenta,
    ArrayLiteralNode:   C.yellow,
    BreakNode:          C.red,
    ContinueNode:       C.red,
    ReturnNode:         C.red,
    FunctionNode:       C.magenta,
    StructNode:         C.magenta,
    FieldNode:          C.green,
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

/** Canonical display names for primitive TypeKinds. */
const TYPE_NAME: Partial<Record<TypeKind, string>> = {
    [TypeKind.Int]:     "int",
    [TypeKind.Float]:   "float",
    [TypeKind.Double]:  "double",
    [TypeKind.Bool]:    "bool",
    [TypeKind.Char]:    "char",
    [TypeKind.String]:  "string",
    [TypeKind.Void]:    "void",
}

/** Render a parsed TypeNode to a colored string (e.g. `int`, `Point`, `int[]`). */
function renderType(type: TypeNode, ctx: Ctx): string {
    switch (type.kind) {
        case TypeNodeKind.Array:
            return `${renderType(type.element, ctx)}${DIM}[]${R}`
        case TypeNodeKind.Name:
            return renderTypeName(type.id, type.resolved, ctx)
    }
}

/** Render a type's base name: a primitive keyword, a user type, or `inferred`. */
function renderTypeName(id: number, resolved: TypeKind, ctx: Ctx): string {
    if (resolved !== TypeKind.Unknown) {
        return `${C.teal}${TYPE_NAME[resolved] ?? TypeKind[resolved]}${R}`
    }
    return id >= 0 ? resolveType(id, ctx) : `${DIM}inferred${R}`
}

/** Resolve a function id to a name via the symbol table (falls back to fn#id). */
function resolveFunction(id: number, ctx: Ctx): string {
    return ctx.symbolTable?.functions?.get(id)
        ?? ctx.symbolTable?.variables?.get(id)
        ?? `${DIM}fn#${id}${R}`
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
    [BitwiseOperator.Or]:         `${C.teal}|${R}`,
    [BitwiseOperator.Xor]:        `${C.teal}^${R}`,
    [BitwiseOperator.And]:        `${C.teal}&${R}`,
    [BitwiseOperator.ShiftLeft]:  `${C.teal}<<${R}`,
    [BitwiseOperator.ShiftRight]: `${C.teal}>>${R}`,
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

const ASSIGN_OP: Record<AssignmentOperator, string> = {
    [AssignmentOperator.Assign]:           `${C.magenta}=${R}`,
    [AssignmentOperator.AddAssign]:        `${C.magenta}+=${R}`,
    [AssignmentOperator.SubAssign]:        `${C.magenta}-=${R}`,
    [AssignmentOperator.MulAssign]:        `${C.magenta}*=${R}`,
    [AssignmentOperator.DivAssign]:        `${C.magenta}/=${R}`,
    [AssignmentOperator.ModAssign]:        `${C.magenta}%=${R}`,
    [AssignmentOperator.ExpAssign]:        `${C.magenta}**=${R}`,
    [AssignmentOperator.ShiftLeftAssign]:  `${C.magenta}<<=${R}`,
    [AssignmentOperator.ShiftRightAssign]: `${C.magenta}>>=${R}`,
    [AssignmentOperator.BitAndAssign]:     `${C.magenta}&=${R}`,
    [AssignmentOperator.BitOrAssign]:      `${C.magenta}|=${R}`,
    [AssignmentOperator.BitXorAssign]:     `${C.magenta}^=${R}`,
    [AssignmentOperator.AndAssign]:        `${C.magenta}&&=${R}`,
    [AssignmentOperator.OrAssign]:         `${C.magenta}||=${R}`,
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
            lines.push(leaf("varType",  renderType(d.variableType, ctx),  deeper(ctx)))
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

        // ── EnumNode ─────────────────────────────────────────────────────────
        case NodeType.EnumNode: {
            const d = node.data as EnumNode
            const mods = [...d.modifiers].map(m => Modifier[m]).join(", ") || "none"
            lines.push(header(typeName, resolveType(d.id, ctx), ctx))
            lines.push(leaf("type", renderType(d.type, ctx), deeper(ctx)))
            lines.push(leaf("mods", `${DIM}${mods}${R}`,      deeper(ctx)))
            for (const option of d.options) {
                if (option.value) {
                    lines.push({ indent: deeper(ctx).depth, text: `${DIM}option:${R} ${resolveVar(option.id, ctx)} ${DIM}=${R}` })
                    lines.push(...recurse(option.value, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
                } else {
                    lines.push(leaf("option", resolveVar(option.id, ctx), deeper(ctx)))
                }
            }
            break
        }

        // ── CodeBlock ────────────────────────────────────────────────────────
        case NodeType.CodeBlock: {
            const d = node.data as CodeBlockNode
            lines.push(header(typeName, `${DIM}(${d.body.length} statement(s))${R}`, ctx))
            for (const statement of d.body) {
                lines.push(...recurse(statement, deeper(ctx)))
            }
            break
        }

        // ── IfNode ───────────────────────────────────────────────────────────
        case NodeType.IfNode: {
            const d = node.data as IfNode
            lines.push(header(typeName, undefined, ctx))
            lines.push({ indent: deeper(ctx).depth, text: `${DIM}condition:${R}` })
            lines.push(...recurse(d.condition, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            lines.push({ indent: deeper(ctx).depth, text: `${DIM}then:${R}` })
            lines.push(...recurse({type: NodeType.CodeBlock, data: d.ifNode}, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            if (d.elseNode) {
                lines.push({ indent: deeper(ctx).depth, text: `${DIM}else:${R}` })
                lines.push(...recurse(d.elseNode, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            }
            break
        }

        // ── SwitchNode ───────────────────────────────────────────────────────
        case NodeType.SwitchNode: {
            const d = node.data as SwitchNode
            lines.push(header(typeName, undefined, ctx))
            lines.push({ indent: deeper(ctx).depth, text: `${DIM}expression:${R}` })
            lines.push(...recurse(d.expression, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            for (const switchCase of d.cases) {
                lines.push(...recurse(switchCase, deeper(ctx)))
            }
            break
        }

        // ── SwitchCaseNode ───────────────────────────────────────────────────
        case NodeType.SwitchCaseNode: {
            const d = node.data as SwitchCaseNode
            lines.push(header(typeName, undefined, ctx))
            lines.push({ indent: deeper(ctx).depth, text: `${DIM}value:${R}` })
            lines.push(...recurse(d.value, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            lines.push({ indent: deeper(ctx).depth, text: `${DIM}body:${R}` })
            lines.push(...recurse({type: NodeType.CodeBlock, data: d.body}, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            break
        }

        // ── SwitchDefaultNode ────────────────────────────────────────────────
        case NodeType.SwitchDefaultNode: {
            const d = node.data as SwitchDefaultNode
            lines.push(header(typeName, undefined, ctx))
            lines.push({ indent: deeper(ctx).depth, text: `${DIM}body:${R}` })
            lines.push(...recurse({type: NodeType.CodeBlock, data: d.body}, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            break
        }

        // ── AssignmentNode ───────────────────────────────────────────────────
        case NodeType.AssignmentNode: {
            const d = node.data as AssignmentNode
            lines.push(header(typeName, ASSIGN_OP[d.operator], ctx))
            lines.push({ indent: deeper(ctx).depth, text: `${DIM}target:${R}` })
            lines.push(...recurse(d.target, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            lines.push({ indent: deeper(ctx).depth, text: `${DIM}value:${R}` })
            lines.push(...recurse(d.value, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            break
        }

        // ── WhileNode ────────────────────────────────────────────────────────
        case NodeType.WhileNode: {
            const d = node.data as WhileNode
            lines.push(header(typeName, undefined, ctx))
            lines.push({ indent: deeper(ctx).depth, text: `${DIM}condition:${R}` })
            lines.push(...recurse(d.condition, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            lines.push({ indent: deeper(ctx).depth, text: `${DIM}body:${R}` })
            lines.push(...recurse({type: NodeType.CodeBlock, data: d.body}, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            break
        }

        // ── LoopNode ─────────────────────────────────────────────────────────
        case NodeType.LoopNode: {
            const d = node.data as LoopNode
            lines.push(header(typeName, undefined, ctx))
            lines.push({ indent: deeper(ctx).depth, text: `${DIM}body:${R}` })
            lines.push(...recurse({type: NodeType.CodeBlock, data: d.body}, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            break
        }

        // ── ForNode ──────────────────────────────────────────────────────────
        case NodeType.ForNode: {
            const d = node.data as ForNode
            lines.push(header(typeName, undefined, ctx))
            if (d.initializer) {
                lines.push({ indent: deeper(ctx).depth, text: `${DIM}init:${R}` })
                lines.push(...recurse(d.initializer, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            }
            if (d.condition) {
                lines.push({ indent: deeper(ctx).depth, text: `${DIM}condition:${R}` })
                lines.push(...recurse(d.condition, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            }
            if (d.update) {
                lines.push({ indent: deeper(ctx).depth, text: `${DIM}update:${R}` })
                lines.push(...recurse(d.update, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            }
            lines.push({ indent: deeper(ctx).depth, text: `${DIM}body:${R}` })
            lines.push(...recurse({type: NodeType.CodeBlock, data: d.body}, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            break
        }

        // ── ForInNode ────────────────────────────────────────────────────────
        case NodeType.ForInNode: {
            const d = node.data as ForInNode
            lines.push(header(typeName, resolveVar(d.variableId, ctx), ctx))
            lines.push({ indent: deeper(ctx).depth, text: `${DIM}in:${R}` })
            lines.push(...recurse(d.iterable, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            lines.push({ indent: deeper(ctx).depth, text: `${DIM}body:${R}` })
            lines.push(...recurse({type: NodeType.CodeBlock, data: d.body}, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            break
        }

        // ── ImportNode ───────────────────────────────────────────────────────
        case NodeType.ImportNode: {
            const d = node.data as ImportNode
            const spec = d.kind === ImportKind.wildcard
                ? "*"
                : `{ ${d.names.map(id => resolveVar(id, ctx)).join(`${DIM}, ${R}`)} }`
            lines.push(header(typeName, `${d.typeOnly ? `${DIM}types${R} ` : ""}${spec}`, ctx))
            lines.push(leaf("from", resolveString(d.path, deeper(ctx)), deeper(ctx)))
            if (d.alias !== null) {
                lines.push(leaf("as", resolveVar(d.alias, ctx), deeper(ctx)))
            }
            break
        }

        // ── ArrayLiteralNode ─────────────────────────────────────────────────
        case NodeType.ArrayLiteralNode: {
            const d = node.data as ArrayLiteralNode
            lines.push(header(typeName, `${DIM}(${d.elements.length} element(s))${R}`, ctx))
            for (const element of d.elements) {
                lines.push(...recurse(element, deeper(ctx)))
            }
            break
        }

        // ── BreakNode / ContinueNode ─────────────────────────────────────────
        case NodeType.BreakNode:
        case NodeType.ContinueNode: {
            lines.push(header(typeName, undefined, ctx))
            break
        }

        // ── ReturnNode ───────────────────────────────────────────────────────
        case NodeType.ReturnNode: {
            const d = node.data as ReturnNode
            lines.push(header(typeName, undefined, ctx))
            if (d.value) {
                lines.push(...recurse(d.value, deeper(ctx)))
            }
            break
        }

        // ── FunctionNode ─────────────────────────────────────────────────────
        case NodeType.FunctionNode: {
            const d = node.data as FunctionNode
            const mods = [...d.modifiers].map(m => Modifier[m]).join(", ") || "none"
            lines.push(header(typeName, resolveFunction(d.id, ctx), ctx))
            lines.push(leaf("returns", renderType(d.returnType, ctx), deeper(ctx)))
            lines.push(leaf("mods",    `${DIM}${mods}${R}`,           deeper(ctx)))
            if (d.parameters.length) {
                lines.push({ indent: deeper(ctx).depth, text: `${DIM}params:${R}` })
                for (const param of d.parameters) {
                    lines.push(leaf(
                        "param",
                        `${resolveVar(param.id, ctx)} ${DIM}:${R} ${renderType(param.type, ctx)}`,
                        { ...deeper(ctx), depth: deeper(ctx).depth + 1 }
                    ))
                }
            }
            lines.push({ indent: deeper(ctx).depth, text: `${DIM}body:${R}` })
            lines.push(...recurse({type: NodeType.CodeBlock, data: d.body}, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
            break
        }

        // ── StructNode ───────────────────────────────────────────────────────
        case NodeType.StructNode: {
            const d = node.data as StructNode
            const mods = [...d.modifiers].map(m => Modifier[m]).join(", ") || "none"
            lines.push(header(typeName, resolveType(d.id, ctx), ctx))
            lines.push(leaf("mods", `${DIM}${mods}${R}`, deeper(ctx)))
            if (d.fields.length) {
                lines.push({ indent: deeper(ctx).depth, text: `${DIM}members:${R}` })
                for (const member of d.fields) {
                    lines.push(...recurse(member, { ...deeper(ctx), depth: deeper(ctx).depth + 1 }))
                }
            }
            break
        }

        // ── FieldNode ────────────────────────────────────────────────────────
        case NodeType.FieldNode: {
            const d = node.data as FieldNode
            lines.push(header(
                typeName,
                `${resolveVar(d.id, ctx)} ${DIM}:${R} ${renderType(d.type, ctx)}`,
                ctx
            ))
            break
        }

        // ── FALLBACK ─────────────────────────────────────────────────────────
        default: {
            console.log("this should never happen, add a case for the new node types in renderNode!")
        }
    }

    return lines
}

// ─── TREE RENDERING ──────────────────────────────────────────────────────────

const INDENT_BRANCH = `${DIM}│  ${R}`
const INDENT_LAST   = `   `
const PREFIX_BRANCH = `${DIM}├─ ${R}`
const PREFIX_LAST   = `${DIM}└─ ${R}`

function renderLines(lines: Line[]): string {
    const result: string[] = []
    const depthHasMore: boolean[] = []

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const depth = line.indent

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
    label?:       string
    symbolTable?: SymbolTable
}

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
