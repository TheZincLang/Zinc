import {execFileSync} from "child_process"
import {mkdirSync, writeFileSync} from "fs"
import {join} from "path"
import {
    AssignmentOperator,
    BinaryExpressionOperator,
    BitwiseOperator,
    ExpressionOperator,
    FunctionNode,
    LiteralType,
    Node,
    NodeType,
    PostfixOperator,
    Program,
    TypeNode,
    TypeNodeKind,
    UnaryOperator,
} from "../parser/ParserTypes.ts"
import {TypeKind} from "../global/types/globalTypes.ts"
import {FileManager} from "../file/fileManager/fileManager.ts";
import {SymbolTable} from "../parser/prettyPrinter.ts";
import {standardFunctions} from "./standardFunctions.ts";

const PRIMITIVE_C_TYPES: Partial<Record<TypeKind, string>> = {
    [TypeKind.Void]:   "void",
    [TypeKind.Bool]:   "bool",
    [TypeKind.Char]:   "char",
    [TypeKind.Int]:    "int",
    [TypeKind.Float]:  "float",
    [TypeKind.Double]: "double",
    [TypeKind.String]: "const char*",
}

// ---------------------------------------------------------------------------
// Operator → C symbol maps
//
// One entry per operator that maps to a plain C operator symbol. Operators
// that need special codegen (no direct C equivalent) are intentionally absent:
//   - ExpressionOperator.exponentiate → no C operator (use pow())
//   - PostfixOperator.index           → subscript syntax `a[b]`, not infix
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

export class CEmitter {
    private header: string = ""
    private buf = ""
    private indentLevel = 0
    private hIndentLevel = 0
    private emittingHeader = false
    private fileManager: FileManager

    constructor(fileManager: FileManager) {
        this.fileManager = fileManager
        this.symbolTable = this.fileManager.parser!.getSymbolTable()
        this.lexerSymbolTable = this.fileManager.lexer.getSymbolTable()
    }

    emit(program: Program): string {
        const includes = "#include <stdint.h>\n#include <stdbool.h>\n#include <stdio.h>\n#include <math.h>\n\n"
        this.header = ""
        this.buf = ""
        for (const node of program.children) this.emitNode(node)
        // header holds function definitions, emitted at the top of the file
        return includes + this.header + this.buf
    }

    // -- output helpers ------------------------------------------------------
    // All output goes through write/line/push/pop. The `emittingHeader` toggle
    // (see setHeader) routes them to either the header or the main buffer.

    private write(s: string) {
        if (this.emittingHeader) this.header += s
        else this.buf += s
    }
    private line(s: string) {
        if (this.emittingHeader) this.header += "    ".repeat(this.hIndentLevel) + s + "\n"
        else this.buf += "    ".repeat(this.indentLevel) + s + "\n"
    }
    private push() { if (this.emittingHeader) this.hIndentLevel++; else this.indentLevel++ }
    private pop()  { if (this.emittingHeader) this.hIndentLevel--; else this.indentLevel-- }

    /** Toggle output between the header buffer and the main buffer. Returns the
     *  previous value so callers can restore it. */
    private setHeader(value: boolean): boolean {
        const prev = this.emittingHeader
        this.emittingHeader = value
        return prev
    }

    private getIdentifier(id: number): string {
        return this.lexerSymbolTable.variables?.get(id) ?? `__unknown_${id}`
    }

    // -- file management ------------------------------------------------------

    private symbolTable: SymbolTable
    private lexerSymbolTable: SymbolTable

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

    private emitFunction(_node: import("../parser/ParserTypes.ts").FunctionNode): void {
        let line = ""
        line += this.emitType(_node.returnType) + " "
        line += this.getIdentifier(_node.id) + "("
        line += _node.parameters.map(param => this.emitType(param.type) + " " + this.getIdentifier(param.id)).join(", ")
        line += ") {"
        this.line(line)
        this.push()
        this.emitCodeBlock(_node.body)
        this.pop()
        this.line("}")
    }

    private emitStruct(_node: import("../parser/ParserTypes.ts").StructNode): void {
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
            this.emitMethod(method, this.getIdentifier(_node.id))
        }
    }

    private emitMethod(_node: import("../parser/ParserTypes.ts").FunctionNode, typeName: string): void {
        let line = ""
        line += this.emitType(_node.returnType) + " "
        line += typeName + "_" + this.getIdentifier(_node.id) + "("
        line += typeName + " " + "this"
        line += _node.parameters.map(param => ", " + this.emitType(param.type) + " " + this.getIdentifier(param.id)).join("")
        line += ") {"
        this.line(line)
        this.push()
        this.emitCodeBlock(_node.body)
        this.pop()
        this.line("}")
    }

    private emitEnum(_node: import("../parser/ParserTypes.ts").EnumNode): void {
        throw new Error("not implemented: emitEnum")
    }

    private emitLet(_node: import("../parser/ParserTypes.ts").LetNode): void {
        throw new Error("not implemented: emitLet")
    }

    private emitAssignment(_node: import("../parser/ParserTypes.ts").AssignmentNode): void {
        throw new Error("not implemented: emitAssignment")
    }

    private emitReturn(_node: import("../parser/ParserTypes.ts").ReturnNode): void {
        this.line("return " + (_node.value ? this.emitExpr(_node.value) : "") + ";")
    }

    private emitIf(_node: import("../parser/ParserTypes.ts").IfNode): void {
        throw new Error("not implemented: emitIf")
    }

    private emitWhile(_node: import("../parser/ParserTypes.ts").WhileNode): void {
        throw new Error("not implemented: emitWhile")
    }

    private emitLoop(_node: import("../parser/ParserTypes.ts").LoopNode): void {
        // loop {} → while (1) {}
        throw new Error("not implemented: emitLoop")
    }

    private emitFor(_node: import("../parser/ParserTypes.ts").ForNode): void {
        throw new Error("not implemented: emitFor")
    }

    private emitForIn(_node: import("../parser/ParserTypes.ts").ForInNode): void {
        throw new Error("not implemented: emitForIn")
    }

    private emitSwitch(_node: import("../parser/ParserTypes.ts").SwitchNode): void {
        throw new Error("not implemented: emitSwitch")
    }

    private emitSwitchCase(_node: import("../parser/ParserTypes.ts").SwitchCaseNode): void {
        throw new Error("not implemented: emitSwitchCase")
    }

    private emitSwitchDefault(_node: import("../parser/ParserTypes.ts").SwitchDefaultNode): void {
        throw new Error("not implemented: emitSwitchDefault")
    }

    private emitCodeBlock(_node: import("../parser/ParserTypes.ts").CodeBlockNode): void {
        for(const node of _node.body) {
            this.emitNode(node)
        }
    }

    private emitField(_node: import("../parser/ParserTypes.ts").FieldNode): void {
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

    private emitLiteral(_node: import("../parser/ParserTypes.ts").LiteralNode): string {
        switch (_node.type) {
            case LiteralType.String: {
                return  "\"" + (this.symbolTable.strings?.get(_node.value) ?? `__unknown_string_${_node.value}`) + "\""
            }
        }
        throw new Error("not implemented: emitLiteral")
    }

    private emitVariable(_node: import("../parser/ParserTypes.ts").VariableNode): string {
        return this.symbolTable.variables!.get(_node.variableId) ?? `__unknown_${_node.variableId}`
    }

    private emitMath(_node: import("../parser/ParserTypes.ts").MathNode): string {
        return `(${this.emitExpr(_node.left)} ${MATH_OPERATORS[_node.operator]} ${this.emitExpr(_node.right)})`
    }

    private emitBinary(_node: import("../parser/ParserTypes.ts").BinaryNode): string {
        throw new Error("not implemented: emitBinary")
    }

    private emitBitwise(_node: import("../parser/ParserTypes.ts").BitwiseNode): string {
        throw new Error("not implemented: emitBitwise")
    }

    private emitUnary(_node: import("../parser/ParserTypes.ts").UnaryNode): string {
        throw new Error("not implemented: emitUnary")
    }

    private emitPostfix(_node: import("../parser/ParserTypes.ts").PostfixNode): string {
        throw new Error("not implemented: emitPostfix")
    }

    private emitTernary(_node: import("../parser/ParserTypes.ts").TernaryNode): string {
        throw new Error("not implemented: emitTernary")
    }

    private emitCall(_node: import("../parser/ParserTypes.ts").CallNode): string {
        if(!(_node.object.type === NodeType.VariableNode)) {
            throw new Error("CEmit can only emit calls on identifiers")
        }
        const funcName = this.getIdentifier(_node.object.data.variableId)
        if(this.symbolTable.functions?.has(_node.object.data.variableId)) {
            const args = _node.arguments.map(arg => this.emitExpr(arg)).join(", ")
            return `${funcName}(${args})`
        } else if (standardFunctions.has(funcName)) {
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

    private emitArrayLiteral(_node: import("../parser/ParserTypes.ts").ArrayLiteralNode): string {
        throw new Error("not implemented: emitArrayLiteral")
    }

    private emitStringTemplate(_node: import("../parser/ParserTypes.ts").StringTemplateNode): string {
        throw new Error("not implemented: emitStringTemplate")
    }

    private emitAssignmentExpr(_node: import("../parser/ParserTypes.ts").AssignmentNode): string {
        throw new Error("not implemented: emitAssignmentExpr")
    }

    // -- type annotation → C type string -------------------------------------

    emitType(_type: TypeNode): string {
        if(_type.kind === TypeNodeKind.Name) {
            if(_type.resolved !== TypeKind.Unknown) return PRIMITIVE_C_TYPES[_type.resolved]
                ?? (() => { throw new Error(`emitType: no C mapping for TypeKind ${_type.resolved}`) })()
            return this.symbolTable.types!.get(_type.id)
                ?? (() => { throw new Error(`emitType: unknown user type id ${_type.id}`) })()
        } else if(_type.kind === TypeNodeKind.Array) {
            return this.emitType(_type.element) + "*"
        } else {
            throw new Error(`emitType: unhandled TypeNode kind`)
        }
    }
}

// ---------------------------------------------------------------------------
// Runner — write C to disk, compile, execute
//
// Requires a C compiler on PATH. Install one of:
//   - GCC via MSYS2:  https://www.msys2.org  (pacman -S mingw-w64-ucrt-x86_64-gcc)
//   - LLVM/Clang:     https://releases.llvm.org/download.html
//   - MSVC:           included with Visual Studio Build Tools
//
// Then set ZINC_CC to the compiler executable name, or pass it as `cc` below.
// Default: "gcc"
// ---------------------------------------------------------------------------

export function compileAndRun(cSource: string, outDir: string = "./Zinc/out", cc = process.env["ZINC_CC"] ?? "clang"): void {
    mkdirSync(outDir, { recursive: true })


    const cFile  = join(outDir, "out.c")
    const exeFile = join(outDir, process.platform === "win32" ? "out.exe" : "out")

    writeFileSync(cFile, cSource, "utf8")
    execFileSync(cc, [cFile, "-o", exeFile, "-O2"], { stdio: "inherit" })
    execFileSync(exeFile, [], { stdio: "inherit" })
}
