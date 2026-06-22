import {TypeKind} from "../global/types/globalTypes.ts";

export enum ParserErrorType {
    UnexpectedToken,
    UnterminatedString,
    UnexpectedEndOfFile,
    InvalidSyntax,
    UnknownVariable,
    TypeError,
    InvalidDeclarationScope,
    Other
}

export interface ParserErrorOptions {
    type: ParserErrorType
    message?: string
    line?: number
    column?: number
    range?: number
    filePath?: string
}

export class ParserError implements ParserErrorOptions{
    type: ParserErrorType
    message?: string
    line?: number
    column?: number
    range?: number
    filePath?: string

    constructor({type, message, line, column, range, filePath}: ParserErrorOptions) {
        this.type = type
        this.message = message ?? "no message provided"
        this.line = line ?? -1
        this.column = column ?? -1
        this.range = range ?? 0
        this.filePath = filePath ?? "no path provided"
    }
}

export interface StackEntry{
    declaredVariables: Set<number>
    //isAsync: boolean
}

export enum Modifier {
    const,
    async,
    array,
    export,
    // member-level access / dispatch modifiers (structs & classes)
    public,
    private,
    protected,
    static,
    override,
}

export enum TypeNodeKind {
    Name,    // a named type — primitive (int, bool) or user-defined (Point)
    Array,   // T[]
    Union,   // T | U | ...
    Generic, // Foo<T, U> — a generic type applied to type arguments
    // future: Optional (T?), Reference (&T), Pointer (*T)
}

/**
 * A parsed type annotation.
 *
 * `Name` carries the interned identifier id of the written name (`id`), or -1
 * when the type was synthesized rather than written (an omitted return type, an
 * un-annotated `let`). `resolved` holds the primitive `TypeKind` when the name
 * is a known primitive, otherwise `TypeKind.Unknown` — meaning it names a
 * user-defined type to be resolved by a later semantic pass.
 *
 * `Array` wraps an element type, so `int[][]` nests two `Array` nodes.
 *
 * `Union` holds two or more member types (`int | string`). Members are the
 * `<member>` layer of the annotation grammar (a name plus `[]` suffixes); a
 * union therefore never directly nests another union. Duplicate members are
 * rejected at parse time. Narrowing/runtime semantics are the type checker's
 * job (not implemented) — see lang/types.md.
 *
 * `Generic` is a named type applied to one or more type arguments (`Box<int>`,
 * `Map<K, V>`). It mirrors `Name` (`id`/`resolved` describe the base name) and
 * adds `arguments`, each itself a `TypeNode` (so `Box<Map<K, V>>` nests). The
 * base of a generic application is always user-defined, so `resolved` is
 * `Unknown` in practice. Whether the base actually names a generic type, and
 * arity/constraint checking, are the type checker's job — see lang/generics.md.
 */
export type TypeNode =
    | {kind: TypeNodeKind.Name; id: number; resolved: TypeKind}
    | {kind: TypeNodeKind.Array; element: TypeNode}
    | {kind: TypeNodeKind.Union; members: TypeNode[]}
    | {kind: TypeNodeKind.Generic; id: number; resolved: TypeKind; arguments: TypeNode[]}


export interface Program {
    children: Node[]
}

export type Node =
    | {type: NodeType.LetNode; data: LetNode}
    | {type: NodeType.TernaryNode; data: TernaryNode}
    | {type: NodeType.BinaryNode, data: BinaryNode}
    | {type: NodeType.MathNode, data: MathNode}
    | {type: NodeType.BitwiseNode, data: BitwiseNode}
    | {type: NodeType.UnaryNode, data: UnaryNode}
    | {type: NodeType.PostfixNode, data: PostfixNode}
    | {type: NodeType.FieldAccessNode, data: FieldAccessNode}
    | {type: NodeType.LiteralNode, data: LiteralNode}
    | {type: NodeType.VariableNode, data: VariableNode}
    | {type: NodeType.CallNode, data: CallNode}
    | {type: NodeType.StringTemplateNode, data: StringTemplateNode}
    | {type: NodeType.EnumNode, data: EnumNode}
    | {type: NodeType.CodeBlock, data: CodeBlockNode}
    | {type: NodeType.IfNode, data: IfNode}
    | {type: NodeType.SwitchNode, data: SwitchNode}
    | {type: NodeType.SwitchCaseNode, data: SwitchCaseNode}
    | {type: NodeType.SwitchDefaultNode, data: SwitchDefaultNode}
    | {type: NodeType.AssignmentNode, data: AssignmentNode}
    | {type: NodeType.WhileNode, data: WhileNode}
    | {type: NodeType.LoopNode, data: LoopNode}
    | {type: NodeType.ForNode, data: ForNode}
    | {type: NodeType.ForInNode, data: ForInNode}
    | {type: NodeType.ImportNode, data: ImportNode}
    | {type: NodeType.LambdaNode, data: LambdaNode}
    | {type: NodeType.ArrayLiteralNode, data: ArrayLiteralNode}
    | {type: NodeType.BreakNode, data: BreakNode}
    | {type: NodeType.ContinueNode, data: ContinueNode}
    | {type: NodeType.ReturnNode, data: ReturnNode}
    | {type: NodeType.FunctionNode, data: FunctionNode}
    | {type: NodeType.StructNode, data: StructNode}
    | {type: NodeType.ClassNode, data: ClassNode}
    | {type: NodeType.FieldNode, data: FieldNode}
    | {type: NodeType.ConstructorNode, data: ConstructorNode}
    | {type: NodeType.InterfaceNode, data: InterfaceNode}
    | {type: NodeType.MethodSignatureNode, data: MethodSignatureNode}
    | {type: NodeType.GroupNode, data: GroupNode}
    | {type: NodeType.ThrowNode, data: ThrowNode}
    | {type: NodeType.TryNode, data: TryNode}

export enum NodeType {
    LetNode,
    TernaryNode,
    BinaryNode,
    MathNode,
    BitwiseNode,
    UnaryNode,
    PostfixNode,
    FieldAccessNode,
    LiteralNode,
    VariableNode,
    CallNode,
    StringTemplateNode,
    EnumNode,
    CodeBlock,
    IfNode,
    SwitchNode,
    SwitchCaseNode,
    SwitchDefaultNode,
    AssignmentNode,
    WhileNode,
    LoopNode,
    ForNode,
    ForInNode,
    ImportNode,
    LambdaNode,
    ArrayLiteralNode,
    BreakNode,
    ContinueNode,
    ReturnNode,
    FunctionNode,
    StructNode,
    ClassNode,
    FieldNode,
    ConstructorNode,
    InterfaceNode,
    MethodSignatureNode,
    GroupNode,
    ThrowNode,
    TryNode,
}

export interface LetNode {
    modifiers: Set<Modifier>
    variableId: number
    variableType: TypeNode
    definition?: Node
}

export interface TernaryNode {
    condition: Node
    trueOption: Node
    falseOption: Node
}

export enum ExpressionOperator {
     add,
     subtract,
     multiply,
     divide,
     modulus,
     exponentiate
}

export interface MathNode {
    operator: ExpressionOperator
    left: Node
    right: Node
}

export enum BinaryExpressionOperator{
    Or,
    And,
    Equal,
    NotEqual,
    LessThan,
    LessThanOrEqual,
    MoreThan,
    MoreThanOrEqual,
}

export interface BinaryNode {
    operator: BinaryExpressionOperator
    left: Node
    right: Node
}

export enum BitwiseOperator {
    Or,
    Xor,
    And,
    ShiftLeft,
    ShiftRight
}

export interface BitwiseNode {
    operator: BitwiseOperator
    left: Node
    right: Node
}

export enum UnaryOperator {
    increment,
    decrement,
    bitwiseNot,
    negative,
    booleanNot,
    // keyword prefix operators
    new,        // new Foo(...)   — heap/instance construction
    typeof,     // typeof x       — runtime/static type query
    await,      // await x        — suspend on an async value
    sizeof,     // sizeof x       — size in bytes of a value/type
    delete,     // delete x       — explicit destruction/free
}

export interface UnaryNode {
    operator: UnaryOperator
    operand: Node
}

export enum PostfixOperator {
    increment,
    decrement,
    index
}
export interface PostfixNode {
    operator: PostfixOperator
    operand: Node
    arguments?: Node[]
}

export interface FieldAccessNode {
    object: Node
    field: number
}

export interface CallNode {
    object: Node
    arguments: Node[]
}

export interface VariableNode {
    variableId: number
}

export enum LiteralType {
    Integer,
    Float,
    Double,
    String,
    CharLiteral,
    Boolean
}

export interface LiteralNode {
    type: LiteralType
    value: number
}

export interface StringTemplateNode {
    parts: StringTemplatePart[]
}

export enum StringTemplatePartType {
    string,
    expression
}

export type StringTemplatePart =
    | {type: StringTemplatePartType.string, value: number}
    | {type: StringTemplatePartType.expression, value: Node}

export interface EnumOptionNode {
    id: number
    value?: Node
}

export interface EnumNode {
    id: number
    modifiers: Set<Modifier>
    typeParameters: number[]
    type: TypeNode
    options: EnumOptionNode[]
}

export interface CodeBlockNode {
    body: Node[]
}

export interface IfNode {
    condition: Node
    ifNode: Node
    elseNode: Node | null
}

export interface SwitchNode {
    expression: Node
    cases: Node[]
}

export interface SwitchCaseNode {
    value: Node
    body: Node
}

export interface SwitchDefaultNode {
    body: Node
}

export enum AssignmentOperator {
    Assign,
    AddAssign,
    SubAssign,
    MulAssign,
    DivAssign,
    ModAssign,
    ExpAssign,
    ShiftLeftAssign,
    ShiftRightAssign,
    BitAndAssign,
    BitOrAssign,
    BitXorAssign,
    AndAssign,
    OrAssign,
}

export interface AssignmentNode {
    operator: AssignmentOperator
    target: Node
    value: Node
}

export interface WhileNode {
    condition: Node
    body: Node
}

export interface LoopNode {
    body: Node
}

/**
 * A C-style three-clause `for` loop: `for (init; condition; update) { ... }`.
 * Each clause is optional (`for (;;) { ... }`). `initializer` and `update` are
 * statements (`parseToken`), `condition` is an expression. The initializer's
 * declarations live in a header scope shared with the condition, update, and
 * body.
 */
export interface ForNode {
    initializer: Node | null
    condition: Node | null
    update: Node | null
    body: Node
}

/**
 * A `for (<ident> in <expr>) { ... }` iteration loop. `variableId` is the
 * interned id of the loop binding, scoped to the body; `iterable` is the
 * expression being iterated.
 */
export interface ForInNode {
    variableId: number
    iterable: Node
    body: Node
}

export enum ImportKind {
    named,     // import { a, b } from "..."
    wildcard,  // import * from "..."
}

/**
 * An `import` statement. `kind` distinguishes a named import (`names` holds the
 * interned ids of the imported symbols) from a wildcard (`names` empty). `path`
 * is the interned string-literal id of the module path, `alias` the interned id
 * of an `as` namespace (or null), and `typeOnly` marks an `import types ...`.
 */
export interface ImportNode {
    kind: ImportKind
    typeOnly: boolean
    names: number[]
    path: number
    alias: number | null
}

export enum CaptureModifier {
    copy,
    ref,
    borrow,
    move,
}

export interface CaptureEntry {
    modifier: CaptureModifier
    variableId: number | null  // null = wildcard (*)
}

export interface LambdaNode {
    captures: CaptureEntry[]
    parameters: FunctionParameter[]
    returnType: TypeNode
    body: Node
}

export interface ArrayLiteralNode {
    elements: Node[]
}

export interface BreakNode {}

export interface ContinueNode {}

export interface ReturnNode {
    value: Node | null
}

export interface FunctionParameter {
    id: number
    type: TypeNode
}

export interface FunctionNode {
    id: number
    modifiers: Set<Modifier>
    typeParameters: number[]
    parameters: FunctionParameter[]
    returnType: TypeNode
    body: Node
}

/**
 * A field declaration inside a struct or class body.
 * `modifiers` carries member-level access modifiers (`pub`/`priv`/`static`).
 */
export interface FieldNode {
    modifiers: Set<Modifier>
    id: number
    type: TypeNode
}

/**
 * A class constructor (`init`). Has no name and no return type; it implicitly
 * operates on the instance under construction.
 */
export interface ConstructorNode {
    modifiers: Set<Modifier>
    parameters: FunctionParameter[]
    body: Node
}

/**
 * A struct declaration. `fields` holds the body members: `FieldNode` field
 * declarations and `FunctionNode` methods (structs support methods but not
 * constructors or inheritance).
 */
export interface StructNode {
    id: number
    modifiers: Set<Modifier>
    typeParameters: number[]
    fields: Node[]
}

/**
 * A class declaration. `typeParameters` holds the interned ids of any generic
 * parameters declared after the name (`class Box<T> { ... }`); empty when none.
 * Inheritance is split per the COOP paradigm:
 *   - `superClass`         — single `extends` target, or null
 *   - `mixin`              — `mixin` clause targets (code-reuse, see lang/mixins.md)
 *   - `implementsTargets`  — `implements` clause targets (interfaces)
 *   - `owns` / `serves`    — protected-access clauses (see lang/owns-serves.md)
 * `members` holds `FieldNode`, `FunctionNode` (methods) and `ConstructorNode`s.
 */
export interface ClassNode {
    modifiers: Set<Modifier>
    id: number
    typeParameters: number[]
    superClass: number | null
    mixin: number[]
    implementsTargets: number[]
    owns: number[]
    serves: number | null
    members: Node[]
}

/**
 * A method signature inside an interface body: a method declaration with no
 * body (`fn name(params): ret`). Shares parameter/return-type representation
 * with `FunctionNode`, but carries no `body` — the implementing class supplies
 * one. See lang/interfaces.md.
 */
export interface MethodSignatureNode {
    modifiers: Set<Modifier>
    id: number
    typeParameters: number[]
    parameters: FunctionParameter[]
    returnType: TypeNode
}

/**
 * An interface declaration. `members` holds the contract: `FieldNode` field
 * signatures and `MethodSignatureNode` method signatures. An interface cannot be
 * instantiated or used as a value type; a class that `implements` it becomes
 * usable as that (nominal) interface. See lang/interfaces.md.
 */
export interface InterfaceNode {
    id: number
    modifiers: Set<Modifier>
    typeParameters: number[]
    members: Node[]
}

/**
 * A group declaration: a named collection of class/interface ids used to keep
 * class signatures concise when bulk-applying `extends`/`implements`/`owns`.
 * `members` holds the interned ids of the referenced types. A group is not
 * itself a type. See lang/groups.md.
 */
export interface GroupNode {
    id: number
    modifiers: Set<Modifier>
    members: number[]
}

/**
 * A `throw <expr>` statement: raises `value` as an error, unwinding to the
 * nearest enclosing `try`/`catch`. The thrown expression is mandatory (there is
 * no bare `throw` re-raise form yet). Runtime unwinding semantics are codegen's
 * job.
 */
export interface ThrowNode {
    value: Node
}

/**
 * A classic `try { ... } catch (e) { ... } finally { ... }` statement.
 *   - `tryBlock`     — the guarded block (always present)
 *   - `catchParam`   — interned id of the caught-error binding, or null when the
 *                      `catch` omits its `(binding)` (or there is no `catch`)
 *   - `catchBlock`   — the handler block, or null when only `finally` is present
 *   - `finallyBlock` — the always-run block, or null when absent
 * At least one of `catchBlock`/`finallyBlock` is present. The `catchParam`
 * binding is scoped to `catchBlock`. Exception type matching/narrowing is the
 * type checker's job (not implemented).
 */
export interface TryNode {
    tryBlock: Node
    catchParam: number | null
    catchBlock: Node | null
    finallyBlock: Node | null
}