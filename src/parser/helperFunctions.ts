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
    LambdaNode,
    LiteralType,
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

export function _nameType(id: number, resolved: TypeKind): TypeNode {
    return {kind: TypeNodeKind.Name, id, resolved}
}

export function _arrayType(element: TypeNode): TypeNode {
    return {kind: TypeNodeKind.Array, element}
}