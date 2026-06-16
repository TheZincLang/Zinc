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
    // future: Optional (T?), Reference (&T), Pointer (*T), Generic (Foo<T>)
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
 */
export type TypeNode =
    | {kind: TypeNodeKind.Name; id: number; resolved: TypeKind}
    | {kind: TypeNodeKind.Array; element: TypeNode}

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
    booleanNot
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
    fields: Node[]
}

/**
 * A class declaration. Inheritance is split per the COOP paradigm:
 *   - `superClass`         — single `extends` target, or null
 *   - `implementsTargets`  — `implements` clause targets (classes or interfaces)
 *   - `owns` / `serves`    — protected-access clauses (see lang/owns-serves.md)
 * `members` holds `FieldNode`, `FunctionNode` (methods) and `ConstructorNode`s.
 */
export interface ClassNode {
    modifiers: Set<Modifier>
    id: number
    superClass: number | null
    implementsTargets: number[]
    owns: number[]
    serves: number | null
    members: Node[]
}