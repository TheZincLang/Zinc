import {
    AssignmentOperator,
    BinaryExpressionOperator,
    BitwiseOperator,
    ClassNode,
    ConstructorNode,
    EnumNode,
    ExpressionOperator,
    FieldNode,
    FunctionNode,
    GroupNode,
    ImportNode,
    InterfaceNode,
    LambdaNode,
    LiteralType,
    MethodSignatureNode,
    Node,
    NodeType,
    PostfixOperator,
    StringTemplatePart,
    StringTemplatePartType,
    StructNode,
    TypeNode,
    TypeNodeKind,
    UnaryOperator
} from "./ParserTypes.ts";
import {TypeKind} from "../global/types/globalTypes.ts";

export function _binary(op: BinaryExpressionOperator, left: Node, right: Node): Node {
    return { type: NodeType.BinaryNode, data: { operator: op, left: left, right: right } }
}
export function _math(op: ExpressionOperator, left: Node, right: Node): Node {
    return { type: NodeType.MathNode, data: { operator: op, left: left, right: right } }
}

export function _bitwise(op: BitwiseOperator, left: Node, right: Node): Node {
    return { type: NodeType.BitwiseNode, data: { operator: op, left: left, right: right } }
}

export function _unary(op: UnaryOperator, operand: Node): Node {
    return { type: NodeType.UnaryNode, data: { operator: op, operand: operand } }
}

export function _postfix(op: PostfixOperator, operand: Node, args: Node[] = []): Node {
    return { type: NodeType.PostfixNode, data: { operator: op, operand: operand, arguments: args } }
}

export function _fieldAccess(object: Node, field: number): Node {
    return { type: NodeType.FieldAccessNode, data: { object: object, field: field } }
}

export function _literal(type: LiteralType, value: number): Node {
    return {type: NodeType.LiteralNode, data: {type: type, value: value}}
}

export function _variable(id: number): Node {
    return {type: NodeType.VariableNode, data: {variableId: id}}
}

export function _call(object: Node, args: Node[] = []): Node {
    return {type: NodeType.CallNode, data: {object, arguments: args}}
}

export function _stringTemplate(parts: StringTemplatePart[] = []): Node {
    return {type: NodeType.StringTemplateNode, data: {parts: parts}}
}

export function _stringTemplateStringPart(literalId: number): StringTemplatePart {
    return {type: StringTemplatePartType.string, value: literalId}
}

export function _stringTemplateExpressionPart(expression: Node): StringTemplatePart {
    return {type: StringTemplatePartType.expression, value: expression}
}

export function _enum(data: EnumNode): Node {
    return {type: NodeType.EnumNode, data}
}

export function _codeBlock(body: Node[]): Node{
    return {type: NodeType.CodeBlock, data: {body}}
}

export function _if(condition: Node, ifNode: Node, elseNode: Node | null = null): Node {
    return {type: NodeType.IfNode, data: {condition: condition, ifNode: ifNode, elseNode: elseNode}}
}

export function _switch(expression: Node, cases: Node[]): Node {
    return {type: NodeType.SwitchNode, data: {expression: expression, cases: cases}}
}

export function _switchCase(value: Node, body: Node): Node {
    return {type: NodeType.SwitchCaseNode, data: {value: value, body: body}}
}

export function _switchDefault(body: Node): Node {
    return {type: NodeType.SwitchDefaultNode, data: {body: body}}
}

export function _assignment(op: AssignmentOperator, target: Node, value: Node): Node {
    return {type: NodeType.AssignmentNode, data: {operator: op, target: target, value: value}}
}

export function _while(condition: Node, body: Node): Node {
    return {type: NodeType.WhileNode, data: {condition: condition, body: body}}
}

export function _loop(body: Node): Node {
    return {type: NodeType.LoopNode, data: {body}}
}

export function _for(initializer: Node | null, condition: Node | null, update: Node | null, body: Node): Node {
    return {type: NodeType.ForNode, data: {initializer, condition, update, body}}
}

export function _forIn(variableId: number, iterable: Node, body: Node): Node {
    return {type: NodeType.ForInNode, data: {variableId, iterable, body}}
}

export function _import(data: ImportNode): Node {
    return {type: NodeType.ImportNode, data}
}

export function _lambda(data: LambdaNode): Node {
    return {type: NodeType.LambdaNode, data}
}

export function _arrayLiteral(elements: Node[]): Node {
    return {type: NodeType.ArrayLiteralNode, data: {elements}}
}

export function _break(): Node {
    return {type: NodeType.BreakNode, data: {}}
}

export function _continue(): Node {
    return {type: NodeType.ContinueNode, data: {}}
}

export function _return(value: Node | null = null): Node {
    return {type: NodeType.ReturnNode, data: {value: value}}
}

export function _function(data: FunctionNode): Node {
    return {type: NodeType.FunctionNode, data}
}

export function _struct(data: StructNode): Node {
    return {type: NodeType.StructNode, data}
}

export function _class(data: ClassNode): Node {
    return {type: NodeType.ClassNode, data}
}

export function _field(data: FieldNode): Node {
    return {type: NodeType.FieldNode, data}
}

export function _constructor(data: ConstructorNode): Node {
    return {type: NodeType.ConstructorNode, data}
}

export function _interface(data: InterfaceNode): Node {
    return {type: NodeType.InterfaceNode, data}
}

export function _methodSignature(data: MethodSignatureNode): Node {
    return {type: NodeType.MethodSignatureNode, data}
}

export function _group(data: GroupNode): Node {
    return {type: NodeType.GroupNode, data}
}

export function _throw(value: Node): Node {
    return {type: NodeType.ThrowNode, data: {value}}
}

export function _try(
    tryBlock: Node,
    catchParam: number | null,
    catchBlock: Node | null,
    finallyBlock: Node | null
): Node {
    return {type: NodeType.TryNode, data: {tryBlock, catchParam, catchBlock, finallyBlock}}
}

export function _nameType(id: number, resolved: TypeKind): TypeNode {
    return {kind: TypeNodeKind.Name, id, resolved}
}

export function _arrayType(element: TypeNode): TypeNode {
    return {kind: TypeNodeKind.Array, element}
}

export function _unionType(members: TypeNode[]): TypeNode {
    return {kind: TypeNodeKind.Union, members}
}

export function _genericType(id: number, resolved: TypeKind, args: TypeNode[]): TypeNode {
    return {kind: TypeNodeKind.Generic, id, resolved, arguments: args}
}

/** Structural equality on TypeNodes — used to reject duplicate union members. */
export function typeNodesEqual(a: TypeNode, b: TypeNode): boolean {
    if (a.kind !== b.kind) return false
    switch (a.kind) {
        case TypeNodeKind.Name:
            return b.kind === TypeNodeKind.Name && a.id === b.id && a.resolved === b.resolved
        case TypeNodeKind.Array:
            return b.kind === TypeNodeKind.Array && typeNodesEqual(a.element, b.element)
        case TypeNodeKind.Union:
            return b.kind === TypeNodeKind.Union
                && a.members.length === b.members.length
                && a.members.every((m, i) => typeNodesEqual(m, b.members[i]))
        case TypeNodeKind.Generic:
            return b.kind === TypeNodeKind.Generic
                && a.id === b.id
                && a.resolved === b.resolved
                && a.arguments.length === b.arguments.length
                && a.arguments.every((arg, i) => typeNodesEqual(arg, b.arguments[i]))
    }
}