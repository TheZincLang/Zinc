import {execFileSync} from "child_process"
import {mkdirSync, writeFileSync} from "fs"
import {join} from "path"
import {
    ArrayLiteralNode,
    AssignmentNode,
    AssignmentOperator,
    BinaryExpressionOperator,
    BinaryNode,
    BitwiseNode,
    BitwiseOperator,
    CodeBlockNode,
    EnumNode,
    ExpressionOperator,
    FieldNode,
    ForInNode,
    ForNode,
    FunctionNode,
    IfNode,
    LetNode,
    LiteralNode,
    LiteralType,
    LoopNode,
    Node,
    NodeType,
    PostfixNode,
    PostfixOperator,
    Program,
    StructNode,
    StringTemplateNode,
    StringTemplatePartType,
    SwitchCaseNode,
    SwitchDefaultNode,
    SwitchNode,
    TernaryNode,
    TypeNode,
    TypeNodeKind,
    UnaryNode,
    UnaryOperator,
    WhileNode,
} from "../parser/ParserTypes.ts"
import {_arrayType, _nameType} from "../parser/helperFunctions.ts"
import {TypeKind} from "../global/types/globalTypes.ts"
import {FileManager} from "../file/fileManager/fileManager.ts";
import {SymbolTable} from "../parser/prettyPrinter.ts";
import {standardFunctions} from "./standardFunctions.ts";
import {namedTypeMap, primitiveTypeMap} from "./standardTypes.ts";

// ---------------------------------------------------------------------------
// Operator → C symbol maps
//
// One entry per operator that maps to a plain C operator symbol. Operators
// that need special codegen (no direct C equivalent) are intentionally absent:
//   - ExpressionOperator.exponentiate → no C operator (use pow())
//   - PostfixOperator.index           → subscript syntax `a[b]`, not infix
//   - AssignmentOperator.{Exp,And,Or}Assign → no C equivalent, handled in emitAssignmentExpr
// ---------------------------------------------------------------------------

const MATH_OPERATORS: Partial<Record<ExpressionOperator, string>> = {
    [ExpressionOperator.add]:      "+",
    [ExpressionOperator.subtract]: "-",
    [ExpressionOperator.multiply]: "*",
    [ExpressionOperator.divide]:   "/",
    [ExpressionOperator.modulus]:  "%",
}

const BINARY_OPERATORS: Record<BinaryExpressionOperator, string> = {
    [BinaryExpressionOperator.Or]:               "||",
    [BinaryExpressionOperator.And]:              "&&",
    [BinaryExpressionOperator.Equal]:            "==",
    [BinaryExpressionOperator.NotEqual]:         "!=",
    [BinaryExpressionOperator.LessThan]:         "<",
    [BinaryExpressionOperator.LessThanOrEqual]:  "<=",
    [BinaryExpressionOperator.MoreThan]:         ">",
    [BinaryExpressionOperator.MoreThanOrEqual]:  ">=",
}

const BITWISE_OPERATORS: Record<BitwiseOperator, string> = {
    [BitwiseOperator.Or]:         "|",
    [BitwiseOperator.Xor]:        "^",
    [BitwiseOperator.And]:        "&",
    [BitwiseOperator.ShiftLeft]:  "<<",
    [BitwiseOperator.ShiftRight]: ">>",
}

const UNARY_OPERATORS: Record<UnaryOperator, string> = {
    [UnaryOperator.increment]:  "++",
    [UnaryOperator.decrement]:  "--",
    [UnaryOperator.bitwiseNot]: "~",
    [UnaryOperator.negative]:   "-",
    [UnaryOperator.booleanNot]: "!",
}

const POSTFIX_OPERATORS: Partial<Record<PostfixOperator, string>> = {
    [PostfixOperator.increment]: "++",
    [PostfixOperator.decrement]: "--",
}

const ASSIGNMENT_OPERATORS: Record<AssignmentOperator, string> = {
    [AssignmentOperator.Assign]:           "=",
    [AssignmentOperator.AddAssign]:        "+=",
    [AssignmentOperator.SubAssign]:        "-=",
    [AssignmentOperator.MulAssign]:        "*=",
    [AssignmentOperator.DivAssign]:        "/=",
    [AssignmentOperator.ModAssign]:        "%=",
    [AssignmentOperator.ExpAssign]:        "**=", // no C equivalent — needs special codegen
    [AssignmentOperator.ShiftLeftAssign]:  "<<=",
    [AssignmentOperator.ShiftRightAssign]: ">>=",
    [AssignmentOperator.BitAndAssign]:     "&=",
    [AssignmentOperator.BitOrAssign]:      "|=",
    [AssignmentOperator.BitXorAssign]:     "^=",
    [AssignmentOperator.AndAssign]:        "&&=", // no C equivalent — needs special codegen
    [AssignmentOperator.OrAssign]:         "||=", // no C equivalent — needs special codegen
}

// ---------------------------------------------------------------------------
// CEmitter — walks the AST and builds a C source string
// ---------------------------------------------------------------------------

/** A struct/function definition together with the FileManager whose
 *  identifier table its internal ids (field ids, parameter ids, ...) belong
 *  to. Needed once definitions can come from an imported file: ids are
 *  interned per-file, so the same name gets different numbers in different
 *  files, and looking one up always has to go through *that* file's own
 *  symbol table, never the current one. */
interface Owned<T> {
    owner: FileManager
    def: T
}

export class CEmitter {
    private buf = ""
    private indentLevel = 0
    private fileManager: FileManager

    // Struct/function definitions collected in a pre-pass over the top-level
    // program (plus, lazily, anything pulled in from an imported file — see
    // lookupStruct/lookupFunc), so calls and field accesses can be resolved
    // before the defining node has necessarily been emitted.
    private structDefs = new Map<number, Owned<StructNode>>()
    private funcDefs = new Map<number, Owned<FunctionNode>>()

    // Best-effort variable → type map used only for codegen decisions
    // (method dispatch, print formatting, array element types). This is
    // *not* a type checker — there isn't one yet (see CLAUDE.md) — it just
    // tracks the types already written down in `let`/parameter annotations
    // well enough to pick the right C code to emit. Cleared per function.
    private varTypes = new Map<number, TypeNode>()

    private tempCounter = 0

    // Zinc arrays lower to a length-carrying wrapper struct:
    //   typedef struct { T* data; size_t len; } Zn_Array_T;
    // Wrapper typedefs are generated lazily the first time a given element
    // C-type is seen (see emitType) and collected here so they can all be
    // placed before any struct/function code, regardless of where in the
    // traversal they were discovered.
    private typeDefsBuf = ""
    private arrayTypesEmitted = new Set<string>()

    constructor(fileManager: FileManager) {
        this.fileManager = fileManager
        this.symbolTable = this.fileManager.parser!.getSymbolTable()
        this.lexerSymbolTable = this.fileManager.lexer.getSymbolTable()
    }

    /** Emits this file's own .c body: standard includes, an `#include` for
     *  every distinct file it imports from (their declarations need to be
     *  visible for calls into them to type-check), then all of this file's
     *  own struct/function definitions. */
    emitBody(program: Program): string {
        const stdIncludes = "#include <stdint.h>\n#include <stdbool.h>\n#include <stddef.h>\n" +
            "#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n#include <math.h>\n"

        let localIncludes = ""
        const seen = new Set<string>()
        for (const imported of this.fileManager.importedFiles) {
            if (seen.has(imported.path)) continue
            seen.add(imported.path)
            localIncludes += `#include "${mangleFilePath(imported.path)}.h"\n`
        }

        this.buf = ""
        this.typeDefsBuf = ""
        this.arrayTypesEmitted.clear()
        this.structDefs.clear()
        this.funcDefs.clear()

        for (const node of program.children) {
            if (node.type === NodeType.StructNode) this.structDefs.set(node.data.id, {owner: this.fileManager, def: node.data})
            if (node.type === NodeType.FunctionNode) this.funcDefs.set(node.data.id, {owner: this.fileManager, def: node.data})
        }

        for (const node of program.children) this.emitNode(node)
        return stdIncludes + localIncludes + "\n" + this.typeDefsBuf + this.buf
    }

    /** Emits this file's .h: a typedef and method/function prototypes for
     *  each `export`ed declaration, so other files can `#include` it and
     *  link against the definitions in this file's own .c. */
    emitHeader(program: Program): string {
        this.typeDefsBuf = ""
        this.arrayTypesEmitted.clear()

        let body = ""
        for (const node of this.fileManager.exports) {
            switch (node.type) {
                case NodeType.FunctionNode:
                    body += this.functionSignature(node.data) + ";\n"
                    break
                case NodeType.StructNode:
                    body += this.structHeaderBlock(node.data)
                    break
                case NodeType.EnumNode:
                    body += this.enumHeaderBlock(node.data)
                    break
                default:
                    throw new Error(`emitHeader: exporting a ${NodeType[node.type]} isn't supported yet`)
            }
        }

        const guard = "#pragma once\n\n#include <stdint.h>\n#include <stdbool.h>\n#include <stddef.h>\n\n"
        return guard + this.typeDefsBuf + body
    }

    private functionSignature(fn: FunctionNode, namePrefix?: string, thisType?: string): string {
        const name = namePrefix ? `${namePrefix}_${this.getIdentifier(fn.id)}` : this.getIdentifier(fn.id)
        const params = [
            ...(thisType ? [`${thisType} this`] : []),
            ...fn.parameters.map(p => `${this.emitType(p.type)} ${this.getIdentifier(p.id)}`),
        ]
        return `${this.emitType(fn.returnType)} ${name}(${params.join(", ")})`
    }

    private structHeaderBlock(s: StructNode): string {
        const typeName = this.getIdentifier(s.id)
        const methods: FunctionNode[] = []
        let out = "typedef struct {\n"
        for (const field of s.fields) {
            if (field.type === NodeType.FieldNode) {
                out += `    ${this.emitType(field.data.type)} ${this.getIdentifier(field.data.id)};\n`
            } else if (field.type === NodeType.FunctionNode) {
                methods.push(field.data)
            } else {
                throw new Error("that's not a field you can use in Zinc")
            }
        }
        out += `} ${typeName};\n`
        for (const method of methods) {
            out += this.functionSignature(method, typeName, typeName) + ";\n"
        }
        return out
    }

    private enumHeaderBlock(e: EnumNode): string {
        const enumName = this.symbolTable.types!.get(e.id) ?? `__unknown_type_${e.id}`
        const cType = this.emitType(e.type)
        let out = `typedef ${cType} ${enumName};\n`
        let nextValue = 0
        for (const option of e.options) {
            const optName = this.getIdentifier(option.id)
            const valueExpr = option.value ? this.emitExpr(option.value) : String(nextValue)
            out += `static const ${enumName} ${enumName}_${optName} = ${valueExpr};\n`
            nextValue++
        }
        return out
    }

    // -- output helpers ------------------------------------------------------

    private write(s: string) {
        this.buf += s
    }
    private line(s: string) {
        this.buf += "    ".repeat(this.indentLevel) + s + "\n"
    }
    private push() { this.indentLevel++ }
    private pop()  { this.indentLevel-- }

    private getIdentifier(id: number): string {
        return this.lexerSymbolTable.variables?.get(id) ?? `__unknown_${id}`
    }

    /** Reverse-lookup an interned identifier by its written name (used to find
     *  the id behind the "this" convention inside method bodies). */
    private resolveIdentifierId(name: string): number | undefined {
        for (const [id, n] of this.lexerSymbolTable.variables ?? []) {
            if (n === name) return id
        }
        return undefined
    }

    /** Resolves an identifier's name the way `owner` would see it — `this`'s
     *  own tables if it's the current file, otherwise `owner`'s. */
    private identifierNameIn(owner: FileManager, id: number): string {
        if (owner === this.fileManager) return this.getIdentifier(id)
        return owner.lexer.getSymbolTable().variables?.get(id) ?? `__unknown_${id}`
    }

    /** Same idea as identifierNameIn, but for a declared struct/enum's C
     *  type name (which may differ from the raw identifier text). */
    private typeNameIn(owner: FileManager, id: number): string {
        if (owner === this.fileManager) return this.symbolTable.types!.get(id) ?? `__unknown_type_${id}`
        return owner.parser!.getSymbolTable().types!.get(id) ?? `__unknown_type_${id}`
    }

    /** Finds a struct definition by local id, checking imported files by
     *  name if it isn't declared in this file. Results are cached into
     *  structDefs so repeated lookups don't rescan every import. */
    private lookupStruct(id: number): Owned<StructNode> | undefined {
        const cached = this.structDefs.get(id)
        if (cached) return cached
        const name = this.getIdentifier(id)
        for (const imported of this.fileManager.importedFiles) {
            const exportedName = (n: Node) => n.type === NodeType.StructNode && imported.parser!.getSymbolTable().variables?.get(n.data.id) === name
            const exported = imported.exports.find(exportedName)
            if (exported && exported.type === NodeType.StructNode) {
                const entry: Owned<StructNode> = {owner: imported, def: exported.data}
                this.structDefs.set(id, entry)
                return entry
            }
        }
        return undefined
    }

    /** Same as lookupStruct, for plain top-level functions. */
    private lookupFunc(id: number): Owned<FunctionNode> | undefined {
        const cached = this.funcDefs.get(id)
        if (cached) return cached
        const name = this.getIdentifier(id)
        for (const imported of this.fileManager.importedFiles) {
            const exportedName = (n: Node) => n.type === NodeType.FunctionNode && imported.parser!.getSymbolTable().variables?.get(n.data.id) === name
            const exported = imported.exports.find(exportedName)
            if (exported && exported.type === NodeType.FunctionNode) {
                const entry: Owned<FunctionNode> = {owner: imported, def: exported.data}
                this.funcDefs.set(id, entry)
                return entry
            }
        }
        return undefined
    }

    /** Resolves a struct/enum type name for emitType, checking imported
     *  files by name if it isn't declared in this file. */
    private lookupTypeName(id: number): string | undefined {
        const local = this.symbolTable.types!.get(id)
        if (local !== undefined) return local
        const name = this.getIdentifier(id)
        for (const imported of this.fileManager.importedFiles) {
            const table = imported.parser!.getSymbolTable()
            const exported = imported.exports.find(n =>
                (n.type === NodeType.StructNode || n.type === NodeType.EnumNode) && table.variables?.get(n.data.id) === name
            )
            if (exported && (exported.type === NodeType.StructNode || exported.type === NodeType.EnumNode)) {
                return table.types?.get(exported.data.id) ?? name
            }
        }
        return undefined
    }

    // -- file management ------------------------------------------------------

    private symbolTable: SymbolTable
    private lexerSymbolTable: SymbolTable

    // -- type resolution (codegen-only, see `varTypes` above) ----------------

    private literalTypeNode(type: LiteralType): TypeNode {
        switch (type) {
            case LiteralType.Integer:     return _nameType(-1, TypeKind.Int)
            case LiteralType.Float:       return _nameType(-1, TypeKind.Float)
            case LiteralType.Double:      return _nameType(-1, TypeKind.Double)
            case LiteralType.String:      return _nameType(-1, TypeKind.String)
            case LiteralType.CharLiteral: return _nameType(-1, TypeKind.Char)
            case LiteralType.Boolean:     return _nameType(-1, TypeKind.Bool)
        }
    }

    /** Narrow a TypeNode to a user-defined struct and look up its definition. */
    private getStructDef(type: TypeNode): Owned<StructNode> {
        if (type.kind !== TypeNodeKind.Name || type.resolved !== TypeKind.Unknown) {
            throw new Error("expected a struct type")
        }
        const entry = this.lookupStruct(type.id)
        if (!entry) throw new Error(`unknown struct type id ${type.id}`)
        return entry
    }

    private resolveExprType(node: Node): TypeNode {
        switch (node.type) {
            case NodeType.LiteralNode:
                return this.literalTypeNode(node.data.type)

            case NodeType.VariableNode: {
                const t = this.varTypes.get(node.data.variableId)
                if (!t) throw new Error(`resolveExprType: unknown type for variable "${this.getIdentifier(node.data.variableId)}"`)
                return t
            }

            case NodeType.MathNode:
                return this.resolveExprType(node.data.left)

            case NodeType.BinaryNode:
                return _nameType(-1, TypeKind.Bool)

            case NodeType.BitwiseNode:
                return this.resolveExprType(node.data.left)

            case NodeType.UnaryNode:
                return node.data.operator === UnaryOperator.booleanNot
                    ? _nameType(-1, TypeKind.Bool)
                    : this.resolveExprType(node.data.operand)

            case NodeType.PostfixNode: {
                if (node.data.operator === PostfixOperator.index) {
                    const operandType = this.resolveExprType(node.data.operand)
                    if (operandType.kind !== TypeNodeKind.Array) throw new Error("resolveExprType: indexing a non-array value")
                    return operandType.element
                }
                return this.resolveExprType(node.data.operand)
            }

            case NodeType.TernaryNode:
                return this.resolveExprType(node.data.trueOption)

            case NodeType.FieldAccessNode: {
                const objType = this.resolveExprType(node.data.object)
                const {owner, def} = this.getStructDef(objType)
                const fieldName = this.getIdentifier(node.data.field)
                const field = def.fields.find(f => f.type === NodeType.FieldNode && this.identifierNameIn(owner, f.data.id) === fieldName)
                if (!field || field.type !== NodeType.FieldNode) {
                    throw new Error(`resolveExprType: unknown field "${fieldName}"`)
                }
                return field.data.type
            }

            case NodeType.CallNode: {
                const callee = node.data.object
                if (callee.type === NodeType.VariableNode) {
                    const fn = this.lookupFunc(callee.data.variableId)
                    if (!fn) throw new Error("resolveExprType: unknown function return type")
                    return fn.def.returnType
                }
                if (callee.type === NodeType.FieldAccessNode) {
                    const objType = this.resolveExprType(callee.data.object)
                    const {owner, def} = this.getStructDef(objType)
                    const methodName = this.getIdentifier(callee.data.field)
                    const method = def.fields.find(f => f.type === NodeType.FunctionNode && this.identifierNameIn(owner, f.data.id) === methodName)
                    if (!method || method.type !== NodeType.FunctionNode) {
                        throw new Error(`resolveExprType: unknown method "${methodName}"`)
                    }
                    return method.data.returnType
                }
                throw new Error("resolveExprType: unsupported call target")
            }

            case NodeType.ArrayLiteralNode: {
                if (node.data.elements.length === 0) throw new Error("resolveExprType: cannot infer element type of an empty array literal")
                return _arrayType(this.resolveExprType(node.data.elements[0]))
            }

            case NodeType.StringTemplateNode:
                return _nameType(-1, TypeKind.String)

            case NodeType.AssignmentNode:
                return this.resolveExprType(node.data.target)

            default:
                throw new Error(`resolveExprType: cannot infer the type of a ${NodeType[node.type]}`)
        }
    }

    private isIntegerExpr(node: Node): boolean {
        try {
            const t = this.resolveExprType(node)
            return t.kind === TypeNodeKind.Name && t.resolved === TypeKind.Int
        } catch {
            return false
        }
    }

    private isArrayExpr(node: Node): boolean {
        try {
            return this.resolveExprType(node).kind === TypeNodeKind.Array
        } catch {
            return false
        }
    }

    // -- dispatch ------------------------------------------------------------

    private emitNode(node: Node): void {
        switch (node.type) {
            case NodeType.FunctionNode:      return this.emitFunction(node.data)
            case NodeType.StructNode:        return this.emitStruct(node.data)
            case NodeType.EnumNode:          return this.emitEnum(node.data)
            case NodeType.LetNode:           return this.emitLet(node.data)
            case NodeType.AssignmentNode:    return this.emitAssignment(node.data)
            case NodeType.ReturnNode:        return this.emitReturn(node.data)
            case NodeType.IfNode:            return this.emitIf(node.data)
            case NodeType.WhileNode:         return this.emitWhile(node.data)
            case NodeType.LoopNode:          return this.emitLoop(node.data)
            case NodeType.ForNode:           return this.emitFor(node.data)
            case NodeType.ForInNode:         return this.emitForIn(node.data)
            case NodeType.SwitchNode:        return this.emitSwitch(node.data)
            case NodeType.SwitchCaseNode:    return this.emitSwitchCase(node.data)
            case NodeType.SwitchDefaultNode: return this.emitSwitchDefault(node.data)
            case NodeType.CodeBlock:         return this.emitCodeBlock(node.data)
            case NodeType.BreakNode:         return this.line("break;")
            case NodeType.ContinueNode:      return this.line("continue;")
            case NodeType.ImportNode:        return // imports resolved at link time — skip
            case NodeType.FieldNode:         return this.emitField(node.data)

            // expression-statements
            case NodeType.CallNode:
            case NodeType.UnaryNode:
            case NodeType.PostfixNode:
                this.line(this.emitExpr(node) + ";")
                return

            default:
                throw new Error(`emitNode: unhandled node type ${node.type}`)
        }
    }

    // -- statements ----------------------------------------------------------

    private emitFunction(_node: FunctionNode): void {
        this.varTypes.clear()
        for (const param of _node.parameters) this.varTypes.set(param.id, param.type)

        this.line(this.functionSignature(_node) + " {")
        this.push()
        this.emitCodeBlock(_node.body)
        this.pop()
        this.line("}")
    }

    private emitStruct(_node: StructNode): void {
        let methods: FunctionNode[] = []
        this.line("typedef struct { ")
        this.push()
        for(const field of _node.fields) {
            if(field.type === NodeType.FieldNode) {
                this.emitField(field.data)
            } else if (field.type === NodeType.FunctionNode) {
                methods.push(field.data)
            } else {
                throw new Error("that's not a field you can use in Zinc")
            }

        }
        this.pop()
        this.line("} " + this.symbolTable.types!.get(_node.id) + ";")
        for(const method of methods) {
            this.emitMethod(method, this.getIdentifier(_node.id), _node.id)
        }
    }

    private emitMethod(_node: FunctionNode, typeName: string, structId: number): void {
        this.varTypes.clear()
        const thisId = this.resolveIdentifierId("this")
        if (thisId !== undefined) this.varTypes.set(thisId, _nameType(structId, TypeKind.Unknown))
        for (const param of _node.parameters) this.varTypes.set(param.id, param.type)

        this.line(this.functionSignature(_node, typeName, typeName) + " {")
        this.push()
        this.emitCodeBlock(_node.body)
        this.pop()
        this.line("}")
    }

    private emitEnum(_node: EnumNode): void {
        const enumName = this.symbolTable.types!.get(_node.id) ?? `__unknown_type_${_node.id}`
        const cType = this.emitType(_node.type)
        this.line(`typedef ${cType} ${enumName};`)
        let nextValue = 0
        for (const option of _node.options) {
            const optName = this.getIdentifier(option.id)
            const valueExpr = option.value ? this.emitExpr(option.value) : String(nextValue)
            this.line(`static const ${enumName} ${enumName}_${optName} = ${valueExpr};`)
            nextValue++
        }
    }

    /** Builds `CType name = init` with no trailing `;` — shared by emitLet
     *  (statement form) and emitForClause (for-loop initializer form). */
    private buildLetDecl(_node: LetNode): string {
        const varName = this.getIdentifier(_node.variableId)
        let type = _node.variableType
        if (type.kind === TypeNodeKind.Name && type.id === -1 && type.resolved === TypeKind.Unknown) {
            if (!_node.definition) throw new Error(`emitLet: cannot infer the type of "${varName}" — no annotation and no initializer`)
            type = this.resolveExprType(_node.definition)
        }
        this.varTypes.set(_node.variableId, type)
        const cType = this.emitType(type)
        const init = _node.definition ? ` = ${this.emitExpr(_node.definition)}` : ""
        return `${cType} ${varName}${init}`
    }

    private emitLet(_node: LetNode): void {
        this.line(this.buildLetDecl(_node) + ";")
    }

    private emitAssignment(_node: AssignmentNode): void {
        this.line(this.emitAssignmentExpr(_node) + ";")
    }

    private emitReturn(_node: import("../parser/ParserTypes.ts").ReturnNode): void {
        this.line("return " + (_node.value ? this.emitExpr(_node.value) : "") + ";")
    }

    private emitIf(_node: IfNode): void {
        this.emitIfChain(_node, false)
    }

    private emitIfChain(_node: IfNode, isElseIf: boolean): void {
        if (isElseIf) {
            this.write(`} else if (${this.emitExpr(_node.condition)}) {\n`)
        } else {
            this.line(`if (${this.emitExpr(_node.condition)}) {`)
        }
        this.push()
        this.emitCodeBlock(_node.ifNode)
        this.pop()

        const elseNode = _node.elseNode
        if (elseNode === null) {
            this.line("}")
            return
        }
        if (elseNode.type === NodeType.IfNode) {
            this.write("    ".repeat(this.indentLevel))
            this.emitIfChain(elseNode.data, true)
        } else if (elseNode.type === NodeType.CodeBlock) {
            this.line("} else {")
            this.push()
            this.emitCodeBlock(elseNode.data)
            this.pop()
            this.line("}")
        } else {
            throw new Error("emitIf: unexpected else-branch node type")
        }
    }

    private emitWhile(_node: WhileNode): void {
        this.line(`while (${this.emitExpr(_node.condition)}) {`)
        this.push()
        this.emitCodeBlock(_node.body)
        this.pop()
        this.line("}")
    }

    private emitLoop(_node: LoopNode): void {
        // loop {} → while (1) {}
        this.line("while (1) {")
        this.push()
        this.emitCodeBlock(_node.body)
        this.pop()
        this.line("}")
    }

    /** Renders a for-loop init/update clause inline (no trailing `;`). */
    private emitForClause(node: Node | null): string {
        if (node === null) return ""
        switch (node.type) {
            case NodeType.LetNode:        return this.buildLetDecl(node.data)
            case NodeType.AssignmentNode: return this.emitAssignmentExpr(node.data)
            case NodeType.CallNode:
            case NodeType.UnaryNode:
            case NodeType.PostfixNode:
                return this.emitExpr(node)
            default:
                throw new Error(`emitForClause: unsupported node type in for-clause: ${NodeType[node.type]}`)
        }
    }

    private emitFor(_node: ForNode): void {
        const init = this.emitForClause(_node.initializer)
        const condition = _node.condition ? this.emitExpr(_node.condition) : ""
        const update = this.emitForClause(_node.update)
        this.line(`for (${init}; ${condition}; ${update}) {`)
        this.push()
        this.emitCodeBlock(_node.body)
        this.pop()
        this.line("}")
    }

    private emitForIn(_node: ForInNode): void {
        const iterableType = this.resolveExprType(_node.iterable)
        if (iterableType.kind !== TypeNodeKind.Array) {
            throw new Error("emitForIn: for-in can only iterate over array values")
        }
        const elemType = iterableType.element
        const elemCType = this.emitType(elemType)
        const arrCType = this.emitType(iterableType)
        const varName = this.getIdentifier(_node.variableId)
        const iterName = `__zn_iter_${this.tempCounter++}`
        const idxName = `__zn_i_${this.tempCounter++}`

        // Bind the iterable once — it may carry side effects (a call) or be
        // expensive to re-evaluate, and this also works uniformly whether
        // it's a literal, a variable, or any other array-typed expression.
        this.line(`${arrCType} ${iterName} = ${this.emitExpr(_node.iterable)};`)
        this.line(`for (size_t ${idxName} = 0; ${idxName} < ${iterName}.len; ${idxName}++) {`)
        this.push()
        this.line(`${elemCType} ${varName} = ${iterName}.data[${idxName}];`)
        this.varTypes.set(_node.variableId, elemType)
        this.emitCodeBlock(_node.body)
        this.pop()
        this.line("}")
    }

    private emitSwitch(_node: SwitchNode): void {
        this.line(`switch (${this.emitExpr(_node.expression)}) {`)
        this.push()
        for (const switchCase of _node.cases) this.emitNode(switchCase)
        this.pop()
        this.line("}")
    }

    private emitSwitchCase(_node: SwitchCaseNode): void {
        this.line(`case ${this.emitExpr(_node.value)}: {`)
        this.push()
        this.emitCodeBlock(_node.body)
        this.line("break;")
        this.pop()
        this.line("}")
    }

    private emitSwitchDefault(_node: SwitchDefaultNode): void {
        this.line("default: {")
        this.push()
        this.emitCodeBlock(_node.body)
        this.line("break;")
        this.pop()
        this.line("}")
    }

    private emitCodeBlock(_node: CodeBlockNode): void {
        for(const node of _node.body) {
            this.emitNode(node)
        }
    }

    private emitField(_node: FieldNode): void {
        let line: string = ""
        line += this.emitType(_node.type) + " "
        line +=  this.getIdentifier(_node.id) + ";"
        this.line(line)
    }

    // -- expressions (return a string, no trailing semicolon) ----------------

    private emitExpr(node: Node): string {
        switch (node.type) {
            case NodeType.LiteralNode:        return this.emitLiteral(node.data)
            case NodeType.VariableNode:       return this.emitVariable(node.data)
            case NodeType.MathNode:           return this.emitMath(node.data)
            case NodeType.BinaryNode:         return this.emitBinary(node.data)
            case NodeType.BitwiseNode:        return this.emitBitwise(node.data)
            case NodeType.UnaryNode:          return this.emitUnary(node.data)
            case NodeType.PostfixNode:        return this.emitPostfix(node.data)
            case NodeType.TernaryNode:        return this.emitTernary(node.data)
            case NodeType.CallNode:           return this.emitCall(node.data)
            case NodeType.FieldAccessNode:    return this.emitFieldAccess(node.data)
            case NodeType.ArrayLiteralNode:   return this.emitArrayLiteral(node.data)
            case NodeType.StringTemplateNode: return this.emitStringTemplate(node.data)
            case NodeType.AssignmentNode:     return this.emitAssignmentExpr(node.data)
            default:
                throw new Error(`emitExpr: not an expression node: ${node.type}`)
        }
    }

    private escapeCString(s: string): string {
        return s
            .replace(/\\/g, "\\\\")
            .replace(/"/g, "\\\"")
            .replace(/\n/g, "\\n")
            .replace(/\t/g, "\\t")
    }

    private escapeCChar(c: string): string {
        if (c === "\\") return "\\\\"
        if (c === "'") return "\\'"
        if (c === "\n") return "\\n"
        if (c === "\t") return "\\t"
        return c
    }

    private emitLiteral(_node: LiteralNode): string {
        switch (_node.type) {
            case LiteralType.String:
                return `"${this.escapeCString(this.symbolTable.strings?.get(_node.value) ?? `__unknown_string_${_node.value}`)}"`
            case LiteralType.Integer:
                return String(_node.value)
            case LiteralType.Float:
                return `${_node.value}f`
            case LiteralType.Double:
                return String(_node.value)
            case LiteralType.CharLiteral:
                return `'${this.escapeCChar(String.fromCharCode(_node.value))}'`
            case LiteralType.Boolean:
                return _node.value ? "true" : "false"
        }
    }

    private emitVariable(_node: import("../parser/ParserTypes.ts").VariableNode): string {
        return this.symbolTable.variables!.get(_node.variableId) ?? `__unknown_${_node.variableId}`
    }

    private emitMath(_node: import("../parser/ParserTypes.ts").MathNode): string {
        if (_node.operator === ExpressionOperator.exponentiate) {
            return `pow(${this.emitExpr(_node.left)}, ${this.emitExpr(_node.right)})`
        }
        return `(${this.emitExpr(_node.left)} ${MATH_OPERATORS[_node.operator]} ${this.emitExpr(_node.right)})`
    }

    private emitBinary(_node: BinaryNode): string {
        return `(${this.emitExpr(_node.left)} ${BINARY_OPERATORS[_node.operator]} ${this.emitExpr(_node.right)})`
    }

    private emitBitwise(_node: BitwiseNode): string {
        return `(${this.emitExpr(_node.left)} ${BITWISE_OPERATORS[_node.operator]} ${this.emitExpr(_node.right)})`
    }

    private emitUnary(_node: UnaryNode): string {
        return `(${UNARY_OPERATORS[_node.operator]}${this.emitExpr(_node.operand)})`
    }

    private emitPostfix(_node: PostfixNode): string {
        if (_node.operator === PostfixOperator.index) {
            const args = _node.arguments ?? []
            const base = this.emitExpr(_node.operand)
            const indexed = this.isArrayExpr(_node.operand) ? `${base}.data` : base
            return `${indexed}[${this.emitExpr(args[0])}]`
        }
        return `(${this.emitExpr(_node.operand)}${POSTFIX_OPERATORS[_node.operator]})`
    }

    private emitTernary(_node: TernaryNode): string {
        return `(${this.emitExpr(_node.condition)} ? ${this.emitExpr(_node.trueOption)} : ${this.emitExpr(_node.falseOption)})`
    }

    /** printf-family format specifier for a resolved expression type. */
    private formatSpecifierFor(type: TypeNode): string {
        if (type.kind === TypeNodeKind.Array) {
            throw new Error("print: cannot format an array value directly")
        }
        switch (type.resolved) {
            case TypeKind.String: return "%s"
            case TypeKind.Int:    return "%d"
            case TypeKind.Float:
            case TypeKind.Double: return "%f"
            case TypeKind.Bool:   return "%d"
            case TypeKind.Char:   return "%c"
            default:
                throw new Error("print: cannot format a value of this type")
        }
    }

    private emitPrintCall(args: Node[], appendNewline: boolean, toStderr: boolean): string {
        let format = ""
        const cArgs: string[] = []
        for (const arg of args) {
            format += this.formatSpecifierFor(this.resolveExprType(arg))
            cArgs.push(this.emitExpr(arg))
        }
        if (appendNewline) format += "\\n"
        const fn = toStderr ? "fprintf" : "printf"
        const leading = toStderr ? ["stderr"] : []
        return `${fn}(${[...leading, `"${format}"`, ...cArgs].join(", ")})`
    }

    private emitCall(_node: import("../parser/ParserTypes.ts").CallNode): string {
        // method call: receiver.method(args) → TypeName_method(receiver, args)
        if (_node.object.type === NodeType.FieldAccessNode) {
            const fieldAccess = _node.object.data
            const objType = this.resolveExprType(fieldAccess.object)
            const {owner, def: structDef} = this.getStructDef(objType)
            const methodName = this.getIdentifier(fieldAccess.field)
            const method = structDef.fields.find(f => f.type === NodeType.FunctionNode && this.identifierNameIn(owner, f.data.id) === methodName)
            if (!method || method.type !== NodeType.FunctionNode) {
                throw new Error(`unknown method: ${methodName}`)
            }
            const typeName = this.typeNameIn(owner, structDef.id)
            const receiver = this.emitExpr(fieldAccess.object)
            const args = _node.arguments.map(arg => this.emitExpr(arg))
            return `${typeName}_${methodName}(${[receiver, ...args].join(", ")})`
        }

        if(!(_node.object.type === NodeType.VariableNode)) {
            throw new Error("CEmit can only emit calls on identifiers or method accesses")
        }
        const funcName = this.getIdentifier(_node.object.data.variableId)
        if(this.lookupFunc(_node.object.data.variableId)) {
            const args = _node.arguments.map(arg => this.emitExpr(arg)).join(", ")
            return `${funcName}(${args})`
        }

        switch (funcName) {
            case "print":
                return this.emitPrintCall(_node.arguments, false, false)
            case "println":
                return this.emitPrintCall(_node.arguments, true, false)
            case "eprint":
                return this.emitPrintCall(_node.arguments, false, true)
            case "abs": {
                const arg = _node.arguments[0]
                const cFunc = this.isIntegerExpr(arg) ? "abs" : "fabs"
                return `${cFunc}(${this.emitExpr(arg)})`
            }
        }

        if (standardFunctions.has(funcName)) {
            const cFuncName = standardFunctions.get(funcName)
            const args = _node.arguments.map(arg => this.emitExpr(arg)).join(", ")
            return `${cFuncName}(${args})`
        } else {
            throw new Error(`unknown func: ${funcName}`)
        }
    }

    private emitFieldAccess(_node: import("../parser/ParserTypes.ts").FieldAccessNode): string {
        return `${this.emitExpr(_node.object)}.${this.getIdentifier(_node.field)}`
    }

    private emitArrayLiteral(_node: ArrayLiteralNode): string {
        if (_node.elements.length === 0) throw new Error("emitArrayLiteral: cannot infer element type of an empty array literal")
        const elemType = this.resolveExprType(_node.elements[0])
        const elemCType = this.emitType(elemType)
        const arrCType = this.emitArrayType(elemType)
        const elements = _node.elements.map(e => this.emitExpr(e)).join(", ")
        // Builds a Zn_Array_* wrapper value: a stack-allocated backing array
        // (C99/GNU compound literal) plus its length. Note the backing array
        // has automatic storage bound to the enclosing block — returning it
        // out of that block (e.g. as a function's return value) dangles,
        // same caveat as string templates below. No lifetime checking yet.
        return `(${arrCType}){ .data = (${elemCType}[]){${elements}}, .len = ${_node.elements.length} }`
    }

    private emitStringTemplate(_node: StringTemplateNode): string {
        let format = ""
        const args: string[] = []
        for (const part of _node.parts) {
            if (part.type === StringTemplatePartType.string) {
                const raw = this.symbolTable.strings?.get(part.value) ?? ""
                format += this.escapeCString(raw).replace(/%/g, "%%")
            } else {
                format += this.formatSpecifierFor(this.resolveExprType(part.value))
                args.push(this.emitExpr(part.value))
            }
        }
        const buf = `__zn_buf_${this.tempCounter++}`
        // GNU statement-expression: builds the formatted string into a stack
        // buffer and yields it as a `const char*`. Requires gcc/clang.
        return `({ char ${buf}[256]; snprintf(${buf}, sizeof(${buf}), "${format}"${args.length ? ", " + args.join(", ") : ""}); ${buf}; })`
    }

    private emitAssignmentExpr(_node: AssignmentNode): string {
        const target = this.emitExpr(_node.target)
        const value = this.emitExpr(_node.value)
        switch (_node.operator) {
            case AssignmentOperator.ExpAssign:
                return `(${target} = pow(${target}, ${value}))`
            case AssignmentOperator.AndAssign:
                return `(${target} = ((${target}) && (${value})))`
            case AssignmentOperator.OrAssign:
                return `(${target} = ((${target}) || (${value})))`
            default:
                return `(${target} ${ASSIGNMENT_OPERATORS[_node.operator]} ${value})`
        }
    }

    // -- type annotation → C type string -------------------------------------

    emitType(_type: TypeNode): string {
        if(_type.kind === TypeNodeKind.Name) {
            // Check the raw written name first (e.g. i8/u32/int all resolve to
            // TypeKind.Int, but map to different fixed-width C types).
            const rawName = _type.id >= 0 ? this.getIdentifier(_type.id) : undefined
            if (rawName !== undefined && namedTypeMap.has(rawName)) return namedTypeMap.get(rawName)!
            if(_type.resolved !== TypeKind.Unknown) return primitiveTypeMap.get(_type.resolved)
                ?? (() => { throw new Error(`emitType: no C mapping for TypeKind ${TypeKind[_type.resolved]}`) })()
            return this.lookupTypeName(_type.id)
                ?? (() => { throw new Error(`emitType: unknown user type id ${_type.id}`) })()
        } else if(_type.kind === TypeNodeKind.Array) {
            return this.emitArrayType(_type.element)
        } else {
            throw new Error(`emitType: unhandled TypeNode kind`)
        }
    }

    /** Emits (if needed) and returns the name of the length-carrying wrapper
     *  struct for an array of `elementType`. See `typeDefsBuf` for the format. */
    private emitArrayType(elementType: TypeNode): string {
        if (elementType.kind === TypeNodeKind.Name && elementType.resolved === TypeKind.Unknown) {
            // The wrapper typedef has to appear before its first use, but
            // struct/enum typedefs are only written out in program order —
            // there's no forward-declaration pass yet, so ordering can't be
            // guaranteed here. Primitive/string/array element types don't
            // have this problem since they're always already declared.
            throw new Error("emitType: arrays of struct/enum element types aren't supported yet (typedef ordering isn't solved)")
        }
        const elemCType = this.emitType(elementType)
        const name = "Zn_Array_" + this.mangleTypeName(elemCType)
        if (!this.arrayTypesEmitted.has(name)) {
            this.arrayTypesEmitted.add(name)
            this.typeDefsBuf += `typedef struct { ${elemCType}* data; size_t len; } ${name};\n`
        }
        return name
    }

    private mangleTypeName(cType: string): string {
        return cType.replace(/[^A-Za-z0-9_]/g, "_")
    }
}

// ---------------------------------------------------------------------------
// File naming — shared between CEmitter (building `#include "X.h"` lines)
// and compileAndRunMulti (deciding what to name the files on disk), so the
// two always agree on what a given Zinc file's C output is called.
// ---------------------------------------------------------------------------

export function mangleFilePath(absPath: string): string {
    return absPath.replace(/[^A-Za-z0-9_]/g, "_")
}

// ---------------------------------------------------------------------------
// Runner — write each file's C source to disk, compile them all together as
// one program, execute the result.
//
// Requires a C compiler on PATH. Install one of:
//   - GCC via MSYS2:  https://www.msys2.org  (pacman -S mingw-w64-ucrt-x86_64-gcc)
//   - LLVM/Clang:     https://releases.llvm.org/download.html
//   - MSVC:           included with Visual Studio Build Tools
//
// Then set ZINC_CC to the compiler executable name, or pass it as `cc` below.
// Default: "clang"
// ---------------------------------------------------------------------------

export interface EmittedFile {
    path: string      // the Zinc source file's own absolute path
    cSource: string
    hSource: string
}

export function compileAndRunMulti(files: EmittedFile[], outDir: string = "./out", cc = process.env["ZINC_CC"] ?? "clang"): void {
    mkdirSync(outDir, { recursive: true })

    const cFiles = files.map(f => {
        const stem = mangleFilePath(f.path)
        writeFileSync(join(outDir, `${stem}.c`), f.cSource, "utf8")
        writeFileSync(join(outDir, `${stem}.h`), f.hSource, "utf8")
        return join(outDir, `${stem}.c`)
    })

    const exeFile = join(outDir, process.platform === "win32" ? "out.exe" : "out")

    // libm is a separate link target on Unix-y platforms; on Windows math
    // functions live in the C runtime and there's no libm to link against.
    const mathLib = process.platform === "win32" ? [] : ["-lm"]

    // Every discovered file is compiled together as one link step — imports
    // aren't separate programs, they're separate translation units. Exactly
    // one of them needs to define `main`; the linker just requires that to
    // be true across the set, same as it would for hand-written C.
    execFileSync(cc, [...cFiles, "-o", exeFile, "-O2", ...mathLib], { stdio: "inherit" })
    execFileSync(exeFile, [], { stdio: "inherit" })
}
