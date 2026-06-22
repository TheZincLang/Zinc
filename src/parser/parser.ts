import {Token, TokenType} from "../lexer/lexerTypes.ts";
import {
    AssignmentOperator,
    BinaryExpressionOperator,
    BitwiseOperator,
    CaptureEntry,
    CaptureModifier,
    EnumOptionNode,
    ExpressionOperator,
    FunctionParameter,
    ImportKind,
    LiteralType,
    MethodSignatureNode,
    Modifier,
    Node,
    NodeType,
    ParserError,
    ParserErrorType,
    PostfixOperator,
    Program,
    StackEntry,
    StringTemplatePart,
    TypeNode,
    UnaryOperator
} from "./ParserTypes.ts"
import {
    _arrayLiteral,
    _arrayType,
    _assignment,
    _binary,
    _bitwise,
    _break,
    _call,
    _class,
    _codeBlock,
    _constructor,
    _continue,
    _enum,
    _field,
    _fieldAccess,
    _for,
    _forIn,
    _function,
    _genericType,
    _group,
    _if,
    _import,
    _interface,
    _lambda,
    _literal,
    _loop,
    _math,
    _methodSignature,
    _nameType,
    _postfix,
    _return,
    _stringTemplate,
    _stringTemplateExpressionPart,
    _stringTemplateStringPart,
    _struct,
    _switch,
    _switchCase,
    _switchDefault,
    _throw,
    _try,
    _unary,
    _unionType,
    _variable,
    _while,
    typeNodesEqual
} from "./helperFunctions.ts";
import {SymbolTable} from "./prettyPrinter.ts";
import {PRIMITIVE_TYPES, TypeKind} from "../global/types/globalTypes.ts";
import {FileManager} from "../file/fileManager/fileManager.ts";

const CAPTURE_MODIFIER_NAMES = new Map<string, CaptureModifier>([
    ["copy",   CaptureModifier.copy],
    ["ref",    CaptureModifier.ref],
    ["borrow", CaptureModifier.borrow],
    ["bor",    CaptureModifier.borrow],
    ["move",   CaptureModifier.move],
])

export class Parser{
    protected tokens: Token[]
    protected fileManager: FileManager
    protected stack: StackEntry[] = [{
        declaredVariables: new Set<number>(),
    }]
    protected declaredFunctions = new Set<number>()
    protected declaredTypes = new Set<number>()
    protected identifierNames?: Map<number, string>
    protected stackIndex: number = 0
    protected currentTokenIndex: number = 0
    protected currentModifiers: Set<Modifier> = new Set()
    protected program: Program = {children: []}
    protected currentToken: Token

    constructor(fileManager: FileManager) {
        this.fileManager = fileManager
        this.tokens = this.fileManager.tokens
        this.currentToken = this.tokens[1]
    }

    getSymbolTable(): SymbolTable {
        const table = this.fileManager.lexer.getSymbolTable()
        table.functions = new Map(
            [...this.declaredFunctions]
                .filter(id => table.variables?.has(id))
                .map(id => [id, table.variables!.get(id)!])
        )
        table.types = new Map(
            [...this.declaredTypes]
                .filter(id => table.variables?.has(id))
                .map(id => [id, table.variables!.get(id)!])
        )
        return table
    }

    // Reverse-lookup an interned identifier id to its source spelling. The
    // identifier map is fully populated by the time parsing runs, so the
    // reverse map is built once and cached.
    protected resolveIdentifierName(id: number): string | undefined {
        if(!this.identifierNames){
            this.identifierNames = new Map(
                [...this.fileManager.lexer.getIdentifierMap()].map(([name, index]) => [index, name])
            )
        }
        return this.identifierNames.get(id)
    }

    getProgram(): Program {
        return this.program
    }

    protected isGlobalScope(): boolean {
        return this.stackIndex === 0
    }

    protected getToken(){
        this.currentToken = this.tokens[++this.currentTokenIndex]
        return this.currentToken
    }

    protected match(Token: TokenType){
        if(this.peek().type === Token){
            this.getToken()
            return true
        } else {
            return false
        }
    }

    protected peek(){
        return this.tokens[this.currentTokenIndex + 1]
    }

    protected peekAt(offset: number): Token {
        return this.tokens[this.currentTokenIndex + offset]
    }

    protected parseLet(): Node{
        const IdToken = this.getToken()
        const variableId = IdToken.data
        let variableType: TypeNode
        let currentModifiers: Set<Modifier> = new Set<Modifier>(this.currentModifiers)
        this.currentModifiers.clear()
        let definition: Node | undefined
        if(this.match(TokenType.Colon)){
            variableType = this.parseType()
        } else {
            variableType = _nameType(-1, TypeKind.Unknown)
        }
        if(this.match(TokenType.Assign)){
            definition = this.parseExpression()
        }
        if(this.stack[this.stackIndex].declaredVariables.has(variableId)){
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: `redeclaration of variable "${this.resolveIdentifierName(variableId) ?? variableId}"`,
                line: IdToken.line,
                column: IdToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        } else {
            this.stack[this.stackIndex].declaredVariables.add(variableId)
        }
        return {
            type: NodeType.LetNode,
            data: {
                modifiers: currentModifiers,
                variableId: variableId,
                variableType: variableType,
                definition: definition
            }
        }
    }

    protected parseEnum(): Node {
        if(!this.isGlobalScope()){
            throw new ParserError({
                type: ParserErrorType.InvalidDeclarationScope,
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }

        const currentModifiers = new Set<Modifier>(this.currentModifiers)
        this.currentModifiers.clear()

        const nameToken = this.getToken()
        if(nameToken.type !== TokenType.Identifier){
            throw new ParserError({
                type: ParserErrorType.UnexpectedToken,
                line: nameToken.line,
                column: nameToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }
        const enumId = nameToken.data

        const typeParameters = this.parseTypeParameters()

        let enumType: TypeNode = _nameType(-1, TypeKind.Unknown)
        if(this.match(TokenType.Colon)){
            enumType = this.parseType()
        }

        if(!this.match(TokenType.StackOpen)){
            throw new ParserError({
                type: ParserErrorType.UnexpectedToken,
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }

        const options: EnumOptionNode[] = []
        while(!this.match(TokenType.StackClose)){
            if(this.match(TokenType.EOF)){
                throw new ParserError({
                    type: ParserErrorType.UnexpectedEndOfFile,
                    line: this.currentToken.line,
                    column: this.currentToken.column,
                    filePath: this.fileManager.lexer.getPath()
                })
            }
            const memberToken = this.getToken()
            if(memberToken.type !== TokenType.Identifier){
                throw new ParserError({
                    type: ParserErrorType.UnexpectedToken,
                    line: memberToken.line,
                    column: memberToken.column,
                    filePath: this.fileManager.lexer.getPath()
                })
            }
            const option: EnumOptionNode = {id: memberToken.data}
            if(this.match(TokenType.Assign)){
                option.value = this.parseExpression()
            }
            options.push(option)
            this.match(TokenType.Comma)
        }

        this.declaredTypes.add(enumId)

        return _enum({
            id: enumId,
            modifiers: currentModifiers,
            typeParameters,
            type: enumType,
            options
        })
    }

    protected parseExpression(): Node{
        return this.parseAssignment()
    }

    protected assignmentOperatorFor(type: TokenType): AssignmentOperator | null {
        switch (type) {
            case TokenType.Assign:           return AssignmentOperator.Assign
            case TokenType.AddAssign:        return AssignmentOperator.AddAssign
            case TokenType.SubAssign:        return AssignmentOperator.SubAssign
            case TokenType.MulAssign:        return AssignmentOperator.MulAssign
            case TokenType.DivAssign:        return AssignmentOperator.DivAssign
            case TokenType.ModAssign:        return AssignmentOperator.ModAssign
            case TokenType.ExpAssign:        return AssignmentOperator.ExpAssign
            case TokenType.ShiftLeftAssign:  return AssignmentOperator.ShiftLeftAssign
            case TokenType.ShiftRightAssign: return AssignmentOperator.ShiftRightAssign
            case TokenType.BitAndAssign:     return AssignmentOperator.BitAndAssign
            case TokenType.BitOrAssign:      return AssignmentOperator.BitOrAssign
            case TokenType.BitXorAssign:     return AssignmentOperator.BitXorAssign
            case TokenType.AndAssign:        return AssignmentOperator.AndAssign
            case TokenType.OrAssign:         return AssignmentOperator.OrAssign
            default:                         return null
        }
    }

    protected isAssignable(node: Node): boolean {
        return node.type === NodeType.VariableNode
            || node.type === NodeType.FieldAccessNode
            || (node.type === NodeType.PostfixNode && node.data.operator === PostfixOperator.index)
    }

    parseAssignment(): Node {
        const left = this.parseTernary()
        const operator = this.assignmentOperatorFor(this.peek().type)
        if(operator !== null){
            if(!this.isAssignable(left)){
                throw new ParserError({
                    type: ParserErrorType.InvalidSyntax,
                    message: "invalid assignment target",
                    line: this.peek().line,
                    column: this.peek().column,
                    filePath: this.fileManager.lexer.getPath()
                })
            }
            this.getToken() // consume the assignment operator
            const value = this.parseAssignment() // right-associative
            return _assignment(operator, left, value)
        }
        return left
    }

    protected parseTernary(): Node {
        const left = this.parseLogicalOr()
        let leftOption
        let rightOption
        if(this.match(TokenType.Question)){
            leftOption = this.parseTernary()
            if(this.match(TokenType.Colon)){
                rightOption = this.parseTernary()
            } else {
                throw new ParserError({
                    type: ParserErrorType.UnexpectedToken,
                    message: "expected ':' in ternary expression",
                    line: this.peek().line,
                    column: this.peek().column,
                    filePath: this.fileManager.lexer.getPath()
                })
            }
            return {
                type: NodeType.TernaryNode,
                data: {
                    condition: left,
                    trueOption: leftOption,
                    falseOption: rightOption
                }
            }

        }
        return left
    }

    parseLogicalOr(): Node {
        let left = this.parseLogicalAnd()
        while (this.match(TokenType.Or)){
            const right = this.parseLogicalAnd()
            left = _binary(BinaryExpressionOperator.Or, left, right)
        }
        return left
    }

    parseLogicalAnd(): Node {
        let left = this.parseEquality()
        while (this.match(TokenType.And)){
            const right = this.parseEquality()
            left = _binary(BinaryExpressionOperator.And, left, right)
        }
        return left
    }

    parseEquality(): Node {
        let left = this.parseComparison()
        loop: while (true){
            switch (this.peek().type){
                case TokenType.Equal:
                    this.getToken()
                    left = _binary(BinaryExpressionOperator.Equal, left, this.parseComparison())
                    break
                case TokenType.NotEqual:
                    this.getToken()
                    left = _binary(BinaryExpressionOperator.NotEqual, left, this.parseComparison())
                    break
                default:
                    break loop
            }
        }
        return left
    }

    parseComparison(): Node {
        let left = this.parseBitwiseOr()
        loop: while (true){
            switch (this.peek().type){
                case TokenType.LessThan:
                    this.getToken()
                    left = _binary(BinaryExpressionOperator.LessThan, left, this.parseBitwiseOr())
                    break
                case TokenType.LessThanOrEqual:
                    this.getToken()
                    left = _binary(BinaryExpressionOperator.LessThanOrEqual, left, this.parseBitwiseOr())
                    break
                case TokenType.MoreThan:
                    this.getToken()
                    left = _binary(BinaryExpressionOperator.MoreThan, left, this.parseBitwiseOr())
                    break
                case TokenType.MoreThanOrEqual:
                    this.getToken()
                    left = _binary(BinaryExpressionOperator.MoreThanOrEqual, left, this.parseBitwiseOr())
                    break
                default:
                    break loop
            }
        }
        return left
    }

    parseBitwiseOr(): Node {
        let left = this.parseBitwiseXor()
        while (this.match(TokenType.Pipe)){
            const right = this.parseBitwiseXor()
            left = _bitwise(BitwiseOperator.Or, left, right)
        }
        return left
    }

    parseBitwiseXor(): Node {
        let left = this.parseBitwiseAnd()
        while (this.match(TokenType.Caret)){
            const right = this.parseBitwiseAnd()
            left = _bitwise(BitwiseOperator.Xor, left, right)
        }
        return left
    }

    parseBitwiseAnd(): Node {
        let left = this.parseShift()
        while (this.match(TokenType.Ampersand)){
            const right = this.parseShift()
            left = _bitwise(BitwiseOperator.And, left, right)
        }
        return left
    }

    parseShift(): Node {
        let left = this.parseTerm()
        loop: while (true){
            switch (this.peek().type){
                case TokenType.ShiftLeft:
                    this.getToken()
                    left = _bitwise(BitwiseOperator.ShiftLeft, left, this.parseTerm())
                    break
                case TokenType.ShiftRight:
                    this.getToken()
                    left = _bitwise(BitwiseOperator.ShiftRight, left, this.parseTerm())
                    break
                default:
                    break loop
            }
        }
        return left
    }

    parseTerm(): Node {
        let left = this.parseFactor()
        loop: while (true){
            switch (this.peek().type){
                case TokenType.Plus:
                    this.getToken()
                    left = _math(ExpressionOperator.add, left, this.parseFactor())
                    break
                case TokenType.Minus:
                    this.getToken()
                    left = _math(ExpressionOperator.subtract, left, this.parseFactor())
                    break
                default:
                    break loop
            }
        }
        return left
    }

    parseFactor(): Node {
        let left = this.parseExponent()
        loop: while (true){
            switch (this.peek().type){
                case TokenType.Star:
                    this.getToken()
                    left = _math(ExpressionOperator.multiply, left, this.parseExponent())
                    break
                case TokenType.Slash:
                    this.getToken()
                    left = _math(ExpressionOperator.divide, left, this.parseExponent())
                    break
                case TokenType.Modulo:
                    this.getToken()
                    left = _math(ExpressionOperator.modulus, left, this.parseExponent())
                    break
                default:
                    break loop
            }
        }
        return left
    }

    parseExponent(): Node {
        let left = this.parseUnary()
        while (this.match(TokenType.Exponentiation)){
            const right = this.parseUnary()
            left = _math(ExpressionOperator.exponentiate, left, right)
        }
        return left
    }

    parseUnary(): Node {
        switch (this.peek().type){
            case TokenType.Not:
                this.getToken()
                return _unary(UnaryOperator.booleanNot, this.parseUnary())
            case TokenType.Minus:
                this.getToken()
                return _unary(UnaryOperator.negative, this.parseUnary())
            case TokenType.Tilde:
                this.getToken()
                return _unary(UnaryOperator.bitwiseNot, this.parseUnary())
            case TokenType.Increment:
                this.getToken()
                return _unary(UnaryOperator.increment, this.parseUnary())
            case TokenType.Decrement:
                this.getToken()
                return _unary(UnaryOperator.decrement, this.parseUnary())
            case TokenType.New:
                this.getToken()
                return _unary(UnaryOperator.new, this.parseUnary())
            case TokenType.Typeof:
                this.getToken()
                return _unary(UnaryOperator.typeof, this.parseUnary())
            case TokenType.Await:
                this.getToken()
                return _unary(UnaryOperator.await, this.parseUnary())
            case TokenType.Sizeof:
                this.getToken()
                return _unary(UnaryOperator.sizeof, this.parseUnary())
            case TokenType.Delete:
                this.getToken()
                return _unary(UnaryOperator.delete, this.parseUnary())
            default:
                return this.parsePostfix()
        }
    }

    parsePostfix(): Node {
        let left = this.parsePrimary()
        loop: while (true){
            switch (this.peek().type){
                case TokenType.Increment:
                    this.getToken()
                    left = _postfix(PostfixOperator.increment, left)
                    break
                case TokenType.Decrement:
                    this.getToken()
                    left = _postfix(PostfixOperator.decrement, left)
                    break
                case TokenType.LParen:
                    this.getToken()
                    left = this.parseFunctionCall(left)
                    break
                case TokenType.LBrace: {
                    this.getToken()
                    if(this.match(TokenType.RBrace)){
                        throw new ParserError({
                            type: ParserErrorType.InvalidSyntax,
                            message: "expected index expression",
                            line: this.currentToken.line,
                            column: this.currentToken.column,
                        })
                    }
                    left = _postfix(PostfixOperator.index, left, [this.parseExpression()])
                    if(!this.match(TokenType.RBrace)){
                        throw new ParserError({
                            type: ParserErrorType.InvalidSyntax,
                            message: "expected a ]",
                            line: this.currentToken.line,
                            column: this.currentToken.column,
                        })
                    }
                    break
                }
                case TokenType.Dot:
                    this.getToken()
                    left = this.parseFieldAccess(left)
                    break
                default:
                    break loop
            }
        }
        return left
    }

    parseFieldAccess(object: Node): Node {
        if(!this.match(TokenType.Identifier)) {
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "misformed field access",
                line: this.currentToken.line,
                column: this.currentToken.column,
            })
        }
        const fieldAccess = _fieldAccess(object, this.currentToken.data)
        if(this.match(TokenType.Dot)) {
            return this.parseFieldAccess(fieldAccess)
        } else {
            return fieldAccess
        }
    }

    parsePrimary(): Node {
        switch (this.peek().type){
            case TokenType.IntLiteral:
                this.getToken()
                return _literal(LiteralType.Integer, this.currentToken.data)
            case TokenType.FloatLiteral:
                this.getToken()
                return _literal(LiteralType.Float, this.currentToken.data)
            case TokenType.DoubleLiteral:
                this.getToken()
                return _literal(LiteralType.Double, this.currentToken.data)
            case TokenType.StringLiteral:
                this.getToken()
                return _literal(LiteralType.String, this.currentToken.data)
            case TokenType.CharLiteral:
                this.getToken()
                return _literal(LiteralType.CharLiteral, this.currentToken.data)
            case TokenType.StringTemplate:
                return this.parseStringTemplate()
            case TokenType.BoolLiteral:
                this.getToken()
                return _literal(LiteralType.Boolean, this.currentToken.data)
            case TokenType.LBrace:
                // `[…](` is a lambda capture list; any other `[…]` is an array literal.
                if(this.looksLikeLambdaCapture()){
                    return this.parseLambda()
                }
                this.getToken()
                return this.parseArrayLiteral()
            case TokenType.LParen: {
                // `(params) =>` / `(params): T =>` is a lambda; otherwise a grouped expression.
                if(this.looksLikeLambda()){
                    return this.parseLambda()
                }
                this.getToken()
                const expression = this.parseExpression()
                if (!this.match(TokenType.RParen)){
                    throw new ParserError({
                        type: ParserErrorType.InvalidSyntax,
                        message: "expected )",
                        line: this.currentToken.line,
                        column: this.currentToken.column,
                    })
                }
                return expression
            }
            case TokenType.Identifier:
                this.getToken()
                return this.parseIdentifier()
            default:
                this.getToken()
                throw new ParserError({
                    type: ParserErrorType.UnexpectedToken,
                    message: "unexpected token in expression: " + TokenType[this.currentToken.type],
                    line: this.currentToken.line,
                    column: this.currentToken.column,
                })
        }
    }

    parseIdentifier(): Node {
        const identifier = _variable(this.currentToken.data)
        switch (this.peek().type){
            case TokenType.LParen:
                this.getToken()
                return this.parseFunctionCall(identifier)
            case TokenType.Dot:
                this.getToken()
                return this.parseFieldAccess(identifier)
            default:
                return identifier
        }
    }

    parseFunctionCall(callee: Node): Node{
        const args: Node[] = []
        while (!this.match(TokenType.RParen)){
            if(this.match(TokenType.EOF)){
                throw new ParserError({
                    type: ParserErrorType.InvalidSyntax,
                    message: "missing ) in function arguments",
                    line: this.currentToken.line,
                    column: this.currentToken.column
                })
            }
            args.push(this.parseExpression())
            if(this.match(TokenType.Comma)){
                // comma consumed, continue to the next argument
            } else {
                if(this.peek().type !==TokenType.RParen) {
                    throw new ParserError({
                        type: ParserErrorType.InvalidSyntax,
                        message: "expected a comma or )",
                        line: this.currentToken.line,
                        column: this.currentToken.column
                    })
                }
            }
        }
        return _call(callee, args)
    }

    parseStringTemplate(): Node {
        let parts: StringTemplatePart[] = []
        while (true) {
            if(this.match(TokenType.StringTemplate)){
                parts.push(_stringTemplateStringPart(this.currentToken.data))
            } else if (this.match(TokenType.StringTemplateStart)){
                parts.push(_stringTemplateExpressionPart(this.parseExpression()))
                if(!this.match(TokenType.StringTemplateEnd)){
                    throw new ParserError({
                        type: ParserErrorType.InvalidSyntax,
                        message: "expected end of string template expression",
                        line: this.currentToken.line,
                        column: this.currentToken.column,
                        filePath: this.fileManager.lexer.getPath()
                    })
                }
            } else {
                break
            }
        }
        return _stringTemplate(parts)
    }

    parseCodeBlock(initialVariables: number[] = []): Node {
        const body: Node[] = []
        this.stack.push({declaredVariables: new Set<number>(initialVariables)})
        this.stackIndex++
        while(!this.match(TokenType.StackClose)){
            if(this.match(TokenType.EOF)){
                throw new ParserError({
                    type: ParserErrorType.InvalidSyntax,
                    message: "missing } in code block",
                    line: this.currentToken.line,
                    column: this.currentToken.column
                })
            }
            body.push(this.parseToken())
        }
        this.stack.pop()
        this.stackIndex--
        return _codeBlock(body)
    }

    parseIf(): Node {
        if(!this.match(TokenType.LParen)){
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "missing ( after if",
                line: this.currentToken.line,
                column: this.currentToken.column
            })
        }
        const condition = this.parseExpression()
        if(!this.match(TokenType.RParen)){
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "missing ) after if condition",
                line: this.currentToken.line,
                column: this.currentToken.column
            })
        }
        if(!this.match(TokenType.StackOpen)){
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "missing { after expression",
                line: this.currentToken.line,
                column: this.currentToken.column
            })
        }
        const ifNode = this.parseCodeBlock()
        let elseNode: Node | null = null
        if(this.match(TokenType.Else)) {
            if(this.match(TokenType.If)) {
                elseNode = this.parseIf()
            } else {
                if(!this.match(TokenType.StackOpen)){
                    throw new ParserError({
                        type: ParserErrorType.InvalidSyntax,
                        message: "missing { after else",
                        line: this.currentToken.line,
                        column: this.currentToken.column
                    })
                }
                elseNode = this.parseCodeBlock()
            }
        }
        return _if(condition, ifNode, elseNode)
    }

    parseSwitch(): Node{
        if(!this.match(TokenType.LParen)) {
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "expected ( after \"switch\"",
                line: this.currentToken.line,
                column: this.currentToken.column
            })
        }
        const switchExpression: Node = this.parseExpression()
        if(!this.match(TokenType.RParen)) {
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "expected ) after expression",
                line: this.currentToken.line,
                column: this.currentToken.column
            })
        }
        if(!this.match(TokenType.StackOpen)) {
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "expected {",
                line: this.currentToken.line,
                column: this.currentToken.column
            })
        }
        let defaultSet = false
        const switchCases: Node[] = []
        while(!this.match(TokenType.StackClose)) {
            const switchCase = this.parseSwitchCase()
            if(switchCase.type === NodeType.SwitchDefaultNode) {
                if(defaultSet) {
                    throw new ParserError({
                        type: ParserErrorType.InvalidSyntax,
                        message: "a switch can only have one default case",
                        line: this.currentToken.line,
                        column: this.currentToken.column
                    })
                } else {
                    defaultSet = true
                }
            }
            switchCases.push(switchCase)
        }
        return _switch(switchExpression, switchCases)
    }

    parseSwitchCase(): Node {
        switch(this.peek().type){
            case TokenType.Case: {
                this.getToken()
                const value = this.parseExpression()
                const body = this.parseSwitchCaseBody()
                return _switchCase(value, body)
            }
            case TokenType.Default: {
                this.getToken()
                const body = this.parseSwitchCaseBody()
                return _switchDefault(body)
            }
            default: {
                this.getToken()
                throw new ParserError({
                    type: ParserErrorType.InvalidSyntax,
                    message: "invalid token, expected \"case\" or \"default\"",
                    line: this.currentToken.line,
                    column: this.currentToken.column
                })
            }
        }
    }

    parseSwitchCaseBody(): Node {
        if(!this.match(TokenType.Colon)) {
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "expected :",
                line: this.currentToken.line,
                column: this.currentToken.column
            })
        }
        if(!this.match(TokenType.StackOpen)) {
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "expected {",
                line: this.currentToken.line,
                column: this.currentToken.column
            })
        }
        return this.parseCodeBlock()
    }

    parseWhile(): Node {
        if(!this.match(TokenType.LParen)){
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "missing ( after while",
                line: this.currentToken.line,
                column: this.currentToken.column
            })
        }
        const condition = this.parseExpression()
        if(!this.match(TokenType.RParen)){
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "missing ) after while condition",
                line: this.currentToken.line,
                column: this.currentToken.column
            })
        }
        if(!this.match(TokenType.StackOpen)){
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "missing { after while condition",
                line: this.currentToken.line,
                column: this.currentToken.column
            })
        }
        return _while(condition, this.parseCodeBlock())
    }

    parseReturn(): Node {
        const next = this.peek().type
        if(next === TokenType.StackClose || next === TokenType.EOF || next === TokenType.Semicolon){
            return _return(null)
        }
        return _return(this.parseExpression())
    }

    // `throw <expr>`. The thrown value is mandatory; a trailing `;` is optional.
    parseThrow(): Node {
        const value = this.parseExpression()
        this.match(TokenType.Semicolon)
        return _throw(value)
    }

    // `try <block> [catch [(<ident>)] <block>] [finally <block>]`. The `try`
    // keyword has already been consumed. At least one of `catch`/`finally` must
    // follow. The catch binding (when written) is scoped to the catch block.
    parseTry(): Node {
        if(!this.match(TokenType.StackOpen)){
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "expected { after try",
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }
        const tryBlock = this.parseCodeBlock()

        let catchParam: number | null = null
        let catchBlock: Node | null = null
        if(this.match(TokenType.Catch)){
            const initialVariables: number[] = []
            if(this.match(TokenType.LParen)){
                catchParam = this.expectIdentifier("expected a catch binding name")
                initialVariables.push(catchParam)
                if(!this.match(TokenType.RParen)){
                    throw new ParserError({
                        type: ParserErrorType.InvalidSyntax,
                        message: "missing ) after catch binding",
                        line: this.currentToken.line,
                        column: this.currentToken.column,
                        filePath: this.fileManager.lexer.getPath()
                    })
                }
            }
            if(!this.match(TokenType.StackOpen)){
                throw new ParserError({
                    type: ParserErrorType.InvalidSyntax,
                    message: "expected { after catch",
                    line: this.currentToken.line,
                    column: this.currentToken.column,
                    filePath: this.fileManager.lexer.getPath()
                })
            }
            catchBlock = this.parseCodeBlock(initialVariables)
        }

        let finallyBlock: Node | null = null
        if(this.match(TokenType.Finally)){
            if(!this.match(TokenType.StackOpen)){
                throw new ParserError({
                    type: ParserErrorType.InvalidSyntax,
                    message: "expected { after finally",
                    line: this.currentToken.line,
                    column: this.currentToken.column,
                    filePath: this.fileManager.lexer.getPath()
                })
            }
            finallyBlock = this.parseCodeBlock()
        }

        if(catchBlock === null && finallyBlock === null){
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "try requires a catch or finally block",
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }

        return _try(tryBlock, catchParam, catchBlock, finallyBlock)
    }

    // Reads a type annotation. A single member is a type name plus any number of
    // `[]` array suffixes; two or more `|`-separated members form a union
    // (`int | string`). `?`/`&`/generics can hang off the same routine later.
    protected parseType(): TypeNode {
        const first = this.parseTypeMember()
        if(this.peek().type !== TokenType.Pipe){
            return first
        }
        // union: collect the `|`-separated members, rejecting duplicates. The
        // minimum-two-members rule is automatic — a union only forms once a `|`
        // is seen. Narrowing/runtime semantics belong to the type checker.
        const members: TypeNode[] = [first]
        while(this.match(TokenType.Pipe)){
            const next = this.parseTypeMember()
            if(members.some(member => typeNodesEqual(member, next))){
                throw new ParserError({
                    type: ParserErrorType.InvalidSyntax,
                    message: "duplicate member in union type",
                    line: this.currentToken.line,
                    column: this.currentToken.column,
                    filePath: this.fileManager.lexer.getPath()
                })
            }
            members.push(next)
        }
        return _unionType(members)
    }

    // A single union member: a type name followed by any number of `[]` array
    // suffixes. Primitive names resolve to their TypeKind; every other name is
    // recorded as a user-defined type to be resolved by a later pass.
    protected parseTypeMember(): TypeNode {
        const token = this.getToken()
        if(token.type !== TokenType.Identifier){
            throw new ParserError({
                type: ParserErrorType.UnexpectedToken,
                message: "expected a type name",
                line: token.line,
                column: token.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }
        const name = this.resolveIdentifierName(token.data)
        const resolved = name !== undefined && PRIMITIVE_TYPES.has(name)
            ? PRIMITIVE_TYPES.get(name)!
            : TypeKind.Unknown
        // A `<` after the name applies type arguments (`Box<int>`, `Map<K, V>`),
        // producing a Generic node; array suffixes then wrap the whole thing.
        let type: TypeNode = this.peek().type === TokenType.LessThan
            ? _genericType(token.data, resolved, this.parseTypeArguments())
            : _nameType(token.data, resolved)
        while(this.match(TokenType.LBrace)){
            if(!this.match(TokenType.RBrace)){
                throw new ParserError({
                    type: ParserErrorType.InvalidSyntax,
                    message: "expected ] to close array type",
                    line: this.currentToken.line,
                    column: this.currentToken.column,
                    filePath: this.fileManager.lexer.getPath()
                })
            }
            type = _arrayType(type)
        }
        return type
    }

    // Parse a type-argument list `"<" <type> {"," <type>} ">"` (the `<` must be
    // the next token). Each argument is a full type (so unions and nested
    // generics work: `Box<int | string>`, `Map<K, Box<V>>`). At least one
    // argument is required. The closing `>` is consumed via consumeGenericClose
    // so a glued `>>`/`>=`/`>>=` from nested generics is split correctly.
    protected parseTypeArguments(): TypeNode[] {
        this.getToken() // consume `<`
        const args: TypeNode[] = [this.parseType()]
        while(this.match(TokenType.Comma)){
            args.push(this.parseType())
        }
        if(!this.consumeGenericClose()){
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "expected > to close type arguments",
                line: this.peek().line,
                column: this.peek().column,
                filePath: this.fileManager.lexer.getPath()
            })
        }
        return args
    }

    // Parse a binder's generic type-parameter declaration
    // `"<" <ident> {"," <ident>} ">"` (e.g. `Box<T>`, `fn pick<T, F, C>`).
    // Returns the interned ids of the declared parameters, or an empty list when
    // no `<` follows. Duplicate names are rejected. Parameter names are recorded
    // in `declaredTypes` so references to them inside the body resolve by name —
    // scope enforcement and arity/constraint checks are the type checker's job.
    // See lang/generics.md.
    protected parseTypeParameters(): number[] {
        if(!this.match(TokenType.LessThan)){
            return []
        }
        const params: number[] = []
        const seen = new Set<number>()
        do {
            const id = this.expectIdentifier("expected a type parameter name")
            if(seen.has(id)){
                throw new ParserError({
                    type: ParserErrorType.InvalidSyntax,
                    message: "duplicate type parameter name",
                    line: this.currentToken.line,
                    column: this.currentToken.column,
                    filePath: this.fileManager.lexer.getPath()
                })
            }
            seen.add(id)
            params.push(id)
        } while(this.match(TokenType.Comma))
        if(!this.consumeGenericClose()){
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "expected > to close type parameters",
                line: this.peek().line,
                column: this.peek().column,
                filePath: this.fileManager.lexer.getPath()
            })
        }
        for(const id of params){
            this.declaredTypes.add(id)
        }
        return params
    }

    // Consume the `>` closing a type-argument or type-parameter list. The lexer
    // greedily forms `>>`, `>=`, and `>>=`, so a closing `>` may be glued to a
    // following operator (notably in nested generics like `Box<Map<K, V>>`). In
    // that case the token is rewritten in place to its remainder and left
    // unconsumed, so the enclosing level closes against it. Returns false if the
    // next token is not a closing `>` in any form.
    protected consumeGenericClose(): boolean {
        const next = this.peek()
        switch(next.type){
            case TokenType.MoreThan:           // >
                this.getToken()
                return true
            case TokenType.ShiftRight:         // >>  → close one, leave >
                this.tokens[this.currentTokenIndex+1].type = TokenType.MoreThan
                this.tokens[this.currentTokenIndex+1].column += 1
                return true
            case TokenType.MoreThanOrEqual:    // >=  → close one, leave =
                this.tokens[this.currentTokenIndex+1].type = TokenType.Assign
                this.tokens[this.currentTokenIndex+1].column += 1
                return true
            case TokenType.ShiftRightAssign:   // >>= → close one, leave >=
                this.tokens[this.currentTokenIndex+1].type = TokenType.MoreThanOrEqual
                this.tokens[this.currentTokenIndex+1].column += 1
                return true
            default:
                return false
        }
    }

    protected parseStruct(): Node {
        if(!this.isGlobalScope()){
            throw new ParserError({
                type: ParserErrorType.InvalidDeclarationScope,
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }

        const currentModifiers = new Set<Modifier>(this.currentModifiers)
        this.currentModifiers.clear()

        const nameToken = this.getToken()
        if(nameToken.type !== TokenType.Identifier){
            throw new ParserError({
                type: ParserErrorType.UnexpectedToken,
                message: "expected a struct name",
                line: nameToken.line,
                column: nameToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }
        const structId = nameToken.data

        const typeParameters = this.parseTypeParameters()

        if(!this.match(TokenType.StackOpen)){
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "missing { before struct body",
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }

        // structs support fields and methods, but not constructors or
        // inheritance clauses (see lang/structs.md).
        const fields = this.parseMemberBlock("struct body", false)

        this.declaredTypes.add(structId)

        return _struct({
            id: structId,
            modifiers: currentModifiers,
            typeParameters,
            fields
        })
    }

    protected parseClass(): Node {
        if(!this.isGlobalScope()){
            throw new ParserError({
                type: ParserErrorType.InvalidDeclarationScope,
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }

        const currentModifiers = new Set<Modifier>(this.currentModifiers)
        this.currentModifiers.clear()

        const nameToken = this.getToken()
        if(nameToken.type !== TokenType.Identifier){
            throw new ParserError({
                type: ParserErrorType.UnexpectedToken,
                message: "expected a class name",
                line: nameToken.line,
                column: nameToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }
        const classId = nameToken.data

        const typeParameters = this.parseTypeParameters()

        // Inheritance clauses, in fixed order: extends, mixin, implements, owns, serves.
        let superClass: number | null = null
        if(this.match(TokenType.Extends)){
            superClass = this.expectIdentifier("expected a class name after extends")
        }

        let mixin: number[] = []
        if(this.match(TokenType.Mixin)){
            mixin = this.parseIdentifierList("expected a class name after mixin")
        }

        let implementsTargets: number[] = []
        if(this.match(TokenType.Implements)){
            implementsTargets = this.parseIdentifierList("expected an interface name after implements")
        }

        let owns: number[] = []
        if(this.match(TokenType.Owns)){
            owns = this.parseIdentifierList("expected a type name after owns")
        }

        let serves: number | null = null
        if(this.match(TokenType.Serves)){
            serves = this.expectIdentifier("expected exactly one target after serves")
        }

        if(!this.match(TokenType.StackOpen)){
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "missing { before class body",
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }

        // classes additionally support `init` constructors.
        const members = this.parseMemberBlock("class body", true)

        this.declaredTypes.add(classId)

        return _class({
            id: classId,
            modifiers: currentModifiers,
            typeParameters,
            superClass,
            mixin,
            implementsTargets,
            owns,
            serves,
            members
        })
    }

    protected parseInterface(): Node {
        if(!this.isGlobalScope()){
            throw new ParserError({
                type: ParserErrorType.InvalidDeclarationScope,
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }

        const currentModifiers = new Set<Modifier>(this.currentModifiers)
        this.currentModifiers.clear()

        const nameToken = this.getToken()
        if(nameToken.type !== TokenType.Identifier){
            throw new ParserError({
                type: ParserErrorType.UnexpectedToken,
                message: "expected an interface name",
                line: nameToken.line,
                column: nameToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }
        const interfaceId = nameToken.data

        const typeParameters = this.parseTypeParameters()

        if(!this.match(TokenType.StackOpen)){
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "missing { before interface body",
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }

        // Interfaces hold a contract only: field signatures and bodyless method
        // signatures (see lang/interfaces.md). No constructors, no method bodies.
        const members: Node[] = []
        const memberIds = new Set<number>()
        while(!this.match(TokenType.StackClose)){
            if(this.match(TokenType.EOF)){
                throw new ParserError({
                    type: ParserErrorType.UnexpectedEndOfFile,
                    message: "missing } in interface body",
                    line: this.currentToken.line,
                    column: this.currentToken.column,
                    filePath: this.fileManager.lexer.getPath()
                })
            }
            const member = this.parseInterfaceMember()
            const id = member.type === NodeType.FieldNode ? member.data.id : (member.data as MethodSignatureNode).id
            if(memberIds.has(id)){
                throw new ParserError({
                    type: ParserErrorType.InvalidSyntax,
                    message: "duplicate interface member name",
                    line: this.currentToken.line,
                    column: this.currentToken.column,
                    filePath: this.fileManager.lexer.getPath()
                })
            }
            memberIds.add(id)
            members.push(member)
        }

        this.declaredTypes.add(interfaceId)

        return _interface({
            id: interfaceId,
            modifiers: currentModifiers,
            typeParameters,
            members
        })
    }

    // Parse a single interface member: a bodyless method signature
    // (`fn name(params): ret`) or a field signature (`name: type`).
    protected parseInterfaceMember(): Node {
        if(this.match(TokenType.Fn)){
            const nameToken = this.getToken()
            if(nameToken.type !== TokenType.Identifier){
                throw new ParserError({
                    type: ParserErrorType.UnexpectedToken,
                    message: "expected a method name",
                    line: nameToken.line,
                    column: nameToken.column,
                    filePath: this.fileManager.lexer.getPath()
                })
            }
            const typeParameters = this.parseTypeParameters()
            const parameters = this.parseParameterList()
            let returnType: TypeNode = _nameType(-1, TypeKind.Void)
            if(this.match(TokenType.Colon)){
                returnType = this.parseType()
            }
            this.match(TokenType.Comma)
            this.match(TokenType.Semicolon)
            return _methodSignature({
                modifiers: new Set<Modifier>(),
                id: nameToken.data,
                typeParameters,
                parameters,
                returnType
            })
        }
        if(this.peek().type === TokenType.Identifier){
            return this.parseFieldDeclaration(new Set<Modifier>())
        }
        const bad = this.getToken()
        throw new ParserError({
            type: ParserErrorType.UnexpectedToken,
            message: "expected a field or method signature",
            line: bad.line,
            column: bad.column,
            filePath: this.fileManager.lexer.getPath()
        })
    }

    protected parseGroup(): Node {
        if(!this.isGlobalScope()){
            throw new ParserError({
                type: ParserErrorType.InvalidDeclarationScope,
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }

        const currentModifiers = new Set<Modifier>(this.currentModifiers)
        this.currentModifiers.clear()

        const nameToken = this.getToken()
        if(nameToken.type !== TokenType.Identifier){
            throw new ParserError({
                type: ParserErrorType.UnexpectedToken,
                message: "expected a group name",
                line: nameToken.line,
                column: nameToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }
        const groupId = nameToken.data

        if(!this.match(TokenType.StackOpen)){
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "missing { before group body",
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }

        const members: number[] = []
        const seen = new Set<number>()
        while(!this.match(TokenType.StackClose)){
            if(this.match(TokenType.EOF)){
                throw new ParserError({
                    type: ParserErrorType.UnexpectedEndOfFile,
                    message: "missing } in group body",
                    line: this.currentToken.line,
                    column: this.currentToken.column,
                    filePath: this.fileManager.lexer.getPath()
                })
            }
            const memberId = this.expectIdentifier("expected a type name in group body")
            if(seen.has(memberId)){
                throw new ParserError({
                    type: ParserErrorType.InvalidSyntax,
                    message: "duplicate group member",
                    line: this.currentToken.line,
                    column: this.currentToken.column,
                    filePath: this.fileManager.lexer.getPath()
                })
            }
            seen.add(memberId)
            members.push(memberId)
            this.match(TokenType.Comma)
        }

        // A group is not a type, but its name must resolve when referenced in an
        // `extends`/`implements`/`owns` clause, so it is recorded alongside types
        // for name resolution (see lang/groups.md).
        this.declaredTypes.add(groupId)

        return _group({
            id: groupId,
            modifiers: currentModifiers,
            members
        })
    }

    // Consume the `{ ... }` body of a struct or class (the opening `{` must
    // already have been matched) and return the parsed member nodes. When
    // `allowConstructor` is false, `init` constructors are rejected.
    protected parseMemberBlock(context: string, allowConstructor: boolean): Node[] {
        const members: Node[] = []
        const fieldIds = new Set<number>()
        while(!this.match(TokenType.StackClose)){
            if(this.match(TokenType.EOF)){
                throw new ParserError({
                    type: ParserErrorType.UnexpectedEndOfFile,
                    message: `missing } in ${context}`,
                    line: this.currentToken.line,
                    column: this.currentToken.column,
                    filePath: this.fileManager.lexer.getPath()
                })
            }
            const member = this.parseMember(allowConstructor)
            if(member.type === NodeType.FieldNode){
                if(fieldIds.has(member.data.id)){
                    throw new ParserError({
                        type: ParserErrorType.InvalidSyntax,
                        message: "duplicate field name",
                        line: this.currentToken.line,
                        column: this.currentToken.column,
                        filePath: this.fileManager.lexer.getPath()
                    })
                }
                fieldIds.add(member.data.id)
            }
            members.push(member)
        }
        return members
    }

    // Parse a single struct/class member: an optional run of access modifiers
    // followed by a field declaration, a method, or (classes only) a constructor.
    protected parseMember(allowConstructor: boolean): Node {
        const modifiers = new Set<Modifier>()
        let modifier: Modifier | undefined
        while((modifier = this.peekMemberModifier()) !== undefined){
            this.getToken()
            modifiers.add(modifier)
        }

        switch(this.peek().type){
            case TokenType.Fn: {
                this.getToken()
                return this.parseMethod(modifiers)
            }
            case TokenType.Init: {
                this.getToken()
                if(!allowConstructor){
                    throw new ParserError({
                        type: ParserErrorType.InvalidSyntax,
                        message: "constructors (init) are only allowed in classes",
                        line: this.currentToken.line,
                        column: this.currentToken.column,
                        filePath: this.fileManager.lexer.getPath()
                    })
                }
                return this.parseConstructor(modifiers)
            }
            case TokenType.Identifier:
                return this.parseFieldDeclaration(modifiers)
            default: {
                const bad = this.getToken()
                throw new ParserError({
                    type: ParserErrorType.UnexpectedToken,
                    message: "expected a field, method, or constructor",
                    line: bad.line,
                    column: bad.column,
                    filePath: this.fileManager.lexer.getPath()
                })
            }
        }
    }

    // Map a member-modifier keyword token to its Modifier, or undefined if the
    // next token is not a member modifier.
    protected peekMemberModifier(): Modifier | undefined {
        switch(this.peek().type){
            case TokenType.Public:     return Modifier.public
            case TokenType.Private:    return Modifier.private
            case TokenType.Protected:  return Modifier.protected
            case TokenType.Static:     return Modifier.static
            case TokenType.Override:   return Modifier.override
            default:                 return undefined
        }
    }

    protected parseFieldDeclaration(modifiers: Set<Modifier>): Node {
        const fieldToken = this.getToken()
        const fieldId = fieldToken.data
        if(!this.match(TokenType.Colon)){
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "expected : after field name",
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }
        const type = this.parseType()
        this.match(TokenType.Comma)
        this.match(TokenType.Semicolon)
        return _field({modifiers, id: fieldId, type})
    }

    protected parseMethod(modifiers: Set<Modifier>): Node {
        const nameToken = this.getToken()
        if(nameToken.type !== TokenType.Identifier){
            throw new ParserError({
                type: ParserErrorType.UnexpectedToken,
                message: "expected a method name",
                line: nameToken.line,
                column: nameToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }
        const methodId = nameToken.data

        const typeParameters = this.parseTypeParameters()

        const parameters = this.parseParameterList()

        let returnType: TypeNode = _nameType(-1, TypeKind.Void)
        if(this.match(TokenType.Colon)){
            returnType = this.parseType()
        }

        if(!this.match(TokenType.StackOpen)){
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "missing { before method body",
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }

        this.declaredFunctions.add(methodId)
        const body = this.parseCodeBlock(parameters.map(p => p.id))

        return _function({
            id: methodId,
            modifiers,
            typeParameters,
            parameters,
            returnType,
            body
        })
    }

    protected parseConstructor(modifiers: Set<Modifier>): Node {
        const parameters = this.parseParameterList()

        if(!this.match(TokenType.StackOpen)){
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "missing { before constructor body",
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }

        const body = this.parseCodeBlock(parameters.map(p => p.id))

        return _constructor({modifiers, parameters, body})
    }

    // Read a `( <param> {"," <param>} )` parameter list, consuming both parens.
    protected parseParameterList(): FunctionParameter[] {
        if(!this.match(TokenType.LParen)){
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "missing ( before parameter list",
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }

        const parameters: FunctionParameter[] = []
        const parameterIds = new Set<number>()
        while(!this.match(TokenType.RParen)){
            if(this.match(TokenType.EOF)){
                throw new ParserError({
                    type: ParserErrorType.UnexpectedEndOfFile,
                    message: "missing ) in parameter list",
                    line: this.currentToken.line,
                    column: this.currentToken.column,
                    filePath: this.fileManager.lexer.getPath()
                })
            }
            const paramToken = this.getToken()
            if(paramToken.type !== TokenType.Identifier){
                throw new ParserError({
                    type: ParserErrorType.UnexpectedToken,
                    message: "expected a parameter name",
                    line: paramToken.line,
                    column: paramToken.column,
                    filePath: this.fileManager.lexer.getPath()
                })
            }
            const paramId = paramToken.data
            if(!this.match(TokenType.Colon)){
                throw new ParserError({
                    type: ParserErrorType.InvalidSyntax,
                    message: "expected : after parameter name",
                    line: this.currentToken.line,
                    column: this.currentToken.column,
                    filePath: this.fileManager.lexer.getPath()
                })
            }
            const type = this.parseType()
            if(parameterIds.has(paramId)){
                throw new ParserError({
                    type: ParserErrorType.InvalidSyntax,
                    message: "duplicate parameter name",
                    line: paramToken.line,
                    column: paramToken.column,
                    filePath: this.fileManager.lexer.getPath()
                })
            }
            parameterIds.add(paramId)
            parameters.push({id: paramId, type})
            this.match(TokenType.Comma)
        }
        return parameters
    }

    // Read a single identifier, throwing `message` if the next token isn't one.
    protected expectIdentifier(message: string): number {
        const token = this.getToken()
        if(token.type !== TokenType.Identifier){
            throw new ParserError({
                type: ParserErrorType.UnexpectedToken,
                message,
                line: token.line,
                column: token.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }
        return token.data
    }

    // Read a comma-separated list of one or more identifiers.
    protected parseIdentifierList(message: string): number[] {
        const ids: number[] = [this.expectIdentifier(message)]
        while(this.match(TokenType.Comma)){
            ids.push(this.expectIdentifier(message))
        }
        return ids
    }

    parseFunction(): Node {
        const currentModifiers = new Set<Modifier>(this.currentModifiers)
        this.currentModifiers.clear()

        const nameToken = this.getToken()
        if(nameToken.type !== TokenType.Identifier){
            throw new ParserError({
                type: ParserErrorType.UnexpectedToken,
                message: "expected a function name",
                line: nameToken.line,
                column: nameToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }
        const functionId = nameToken.data

        const typeParameters = this.parseTypeParameters()

        const parameters = this.parseParameterList()

        let returnType: TypeNode = _nameType(-1, TypeKind.Void)
        if(this.match(TokenType.Colon)){
            returnType = this.parseType()
        }

        if(!this.match(TokenType.StackOpen)){
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "missing { before function body",
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }

        this.declaredFunctions.add(functionId)

        const body = this.parseCodeBlock(parameters.map(p => p.id))

        return _function({
            id: functionId,
            modifiers: currentModifiers,
            typeParameters,
            parameters,
            returnType,
            body
        })
    }

    protected parseToken(): Node{
        switch (this.peek().type){
            case TokenType.Fn: {
                this.getToken()
                return this.parseFunction()
            }
            case TokenType.Import: {
                this.getToken()
                return this.parseImport()
            }
            case TokenType.For: {
                this.getToken()
                return this.parseFor()
            }
            case TokenType.Loop: {
                this.getToken()
                return this.parseLoop()
            }
            case TokenType.Let: {
                this.getToken()
                return this.parseLet()
            }
            case TokenType.Const: {
                this.getToken()
                this.currentModifiers.add(Modifier.const)
                if(this.peek().type === TokenType.Enum){
                    this.getToken()
                    return this.parseEnum()
                } else {
                    return this.parseLet()
                }
            }
            case TokenType.Async: {
                this.getToken()
                this.currentModifiers.add(Modifier.async)
                return this.parseToken()
            }
            case TokenType.Enum: {
                this.getToken()
                return this.parseEnum()
            }
            case TokenType.Struct: {
                this.getToken()
                return this.parseStruct()
            }
            case TokenType.Class: {
                this.getToken()
                return this.parseClass()
            }
            case TokenType.Interface: {
                this.getToken()
                return this.parseInterface()
            }
            case TokenType.Group: {
                this.getToken()
                return this.parseGroup()
            }
            case TokenType.Export: {
                this.getToken()
                const definition = this.parseToken()
                this.fileManager.exports.push(definition)
                return definition
            }
            case TokenType.If: {
                this.getToken()
                return this.parseIf()
            }
            case TokenType.Switch: {
                this.getToken()
                return this.parseSwitch()
            }
            case TokenType.While: {
                this.getToken()
                return this.parseWhile()
            }
            case TokenType.Break: {
                this.getToken()
                return _break()
            }
            case TokenType.Continue: {
                this.getToken()
                return _continue()
            }
            case TokenType.Return: {
                this.getToken()
                return this.parseReturn()
            }
            case TokenType.Throw: {
                this.getToken()
                return this.parseThrow()
            }
            case TokenType.Try: {
                this.getToken()
                return this.parseTry()
            }
            default: {
                return this.parseExpression()
            }
        }
    }

    // Returns true if the upcoming tokens look like a lambda parameter list
    // starting with `(`. Handles: `()` or `(ident:` patterns.
    protected looksLikeLambda(): boolean {
        const t2 = this.peekAt(2)  // first token inside (
        if (t2.type === TokenType.RParen) {
            return this.peekAt(3).type === TokenType.FatArrow
        }
        if (t2.type === TokenType.Identifier) {
            return this.peekAt(3).type === TokenType.Colon
        }
        return false
    }

    // Returns true if the upcoming `[` is a lambda capture list (i.e. the
    // matching `]` is immediately followed by `(`). Scans forward without
    // consuming any tokens.
    protected looksLikeLambdaCapture(): boolean {
        let depth = 0
        let i = this.currentTokenIndex + 1
        while (i < this.tokens.length) {
            const t = this.tokens[i]
            if (t.type === TokenType.LBrace) depth++
            else if (t.type === TokenType.RBrace) {
                depth--
                if (depth === 0) return this.tokens[i + 1]?.type === TokenType.LParen
            } else if (t.type === TokenType.EOF) break
            i++
        }
        return false
    }

    protected parseCaptureEntry(): CaptureEntry {
        let modifier = CaptureModifier.copy

        // Check if next identifier is a capture modifier keyword
        if (this.peek().type === TokenType.Identifier) {
            const name = this.resolveIdentifierName(this.peekAt(1).data)
            const m = CAPTURE_MODIFIER_NAMES.get(name ?? "")
            if (m !== undefined) {
                const after = this.peekAt(2)
                if (after.type === TokenType.Identifier || after.type === TokenType.Star) {
                    this.getToken()
                    modifier = m
                }
            }
        }

        if (this.match(TokenType.Star)) {
            return {modifier, variableId: null}
        }

        const identToken = this.getToken()
        if (identToken.type !== TokenType.Identifier) {
            throw new ParserError({
                type: ParserErrorType.UnexpectedToken,
                message: "expected a capture variable name or *",
                line: identToken.line,
                column: identToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }
        return {modifier, variableId: identToken.data}
    }

    protected parseLambda(): Node {
        const captures: CaptureEntry[] = []

        // Optional capture list [...]
        if (this.match(TokenType.LBrace)) {
            while (!this.match(TokenType.RBrace)) {
                if (this.match(TokenType.EOF)) {
                    throw new ParserError({
                        type: ParserErrorType.UnexpectedEndOfFile,
                        message: "missing ] in capture list",
                        line: this.currentToken.line,
                        column: this.currentToken.column,
                        filePath: this.fileManager.lexer.getPath()
                    })
                }
                captures.push(this.parseCaptureEntry())
                this.match(TokenType.Comma)
            }
        }

        const parameters = this.parseParameterList()

        // Optional return type annotation: (params): returnType => { ... }
        let returnType: TypeNode = _nameType(-1, TypeKind.Void)
        if (this.match(TokenType.Colon)) {
            returnType = this.parseType()
        }

        if (!this.match(TokenType.FatArrow)) {
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "expected => after lambda parameter list",
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }

        if (!this.match(TokenType.StackOpen)) {
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "expected { after =>",
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }

        return _lambda({
            captures,
            parameters,
            returnType,
            body: this.parseCodeBlock(parameters.map(p => p.id))
        })
    }

    // Parse an array literal `[ <expr> {"," <expr>} [","] ]`. The opening `[`
    // must already have been consumed. Indexing (`arr[i]`) is handled separately
    // in parsePostfix; an array literal only appears in primary position, so the
    // two never collide.
    protected parseArrayLiteral(): Node {
        const elements: Node[] = []
        while (!this.match(TokenType.RBrace)) {
            if (this.match(TokenType.EOF)) {
                throw new ParserError({
                    type: ParserErrorType.UnexpectedEndOfFile,
                    message: "missing ] in array literal",
                    line: this.currentToken.line,
                    column: this.currentToken.column,
                    filePath: this.fileManager.lexer.getPath()
                })
            }
            elements.push(this.parseExpression())
            if (!this.match(TokenType.Comma) && this.peek().type !== TokenType.RBrace) {
                throw new ParserError({
                    type: ParserErrorType.InvalidSyntax,
                    message: "expected a comma or ] in array literal",
                    line: this.currentToken.line,
                    column: this.currentToken.column,
                    filePath: this.fileManager.lexer.getPath()
                })
            }
        }
        return _arrayLiteral(elements)
    }

    protected parseLoop(): Node {
        if (!this.match(TokenType.StackOpen)) {
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "expected { after loop",
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }
        return _loop(this.parseCodeBlock())
    }

    // Returns true if the next token is an identifier spelled `name` — used to
    // recognise contextual keywords (`in`, `from`, `as`, `types`) that are not
    // reserved in the lexer.
    protected peekContextualKeyword(name: string): boolean {
        return this.peek().type === TokenType.Identifier
            && this.resolveIdentifierName(this.peek().data) === name
    }

    // Dispatches between the two `for` forms once the `(` is in view. A for-in
    // loop is `for (<ident> in <expr>)`; anything else is the C-style
    // three-clause form.
    protected parseFor(): Node {
        if (!this.match(TokenType.LParen)) {
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "missing ( after for",
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }
        if (this.peek().type === TokenType.Identifier
            && this.peekAt(2).type === TokenType.Identifier
            && this.resolveIdentifierName(this.peekAt(2).data) === "in") {
            return this.parseForIn()
        }
        return this.parseClassicFor()
    }

    // `for (<ident> in <expr>) <block>`. The `(` has already been consumed; the
    // loop variable is scoped to the body.
    protected parseForIn(): Node {
        const variableId = this.getToken().data  // loop variable
        this.getToken()                          // consume the `in` contextual keyword
        const iterable = this.parseExpression()
        if (!this.match(TokenType.RParen)) {
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "missing ) after for-in clause",
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }
        if (!this.match(TokenType.StackOpen)) {
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "missing { after for(...)",
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }
        return _forIn(variableId, iterable, this.parseCodeBlock([variableId]))
    }

    // `for (init; condition; update) <block>`. The `(` has already been
    // consumed. Each clause is optional. A header scope holds the initializer's
    // declarations so they remain visible to the condition, update, and body.
    protected parseClassicFor(): Node {
        this.stack.push({declaredVariables: new Set<number>()})
        this.stackIndex++

        let initializer: Node | null = null
        if (this.peek().type !== TokenType.Semicolon) {
            initializer = this.parseToken()
        }
        if (!this.match(TokenType.Semicolon)) {
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "expected ; after for initializer",
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }

        let condition: Node | null = null
        if (this.peek().type !== TokenType.Semicolon) {
            condition = this.parseExpression()
        }
        if (!this.match(TokenType.Semicolon)) {
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "expected ; after for condition",
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }

        let update: Node | null = null
        if (this.peek().type !== TokenType.RParen) {
            update = this.parseToken()
        }
        if (!this.match(TokenType.RParen)) {
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "missing ) after for clauses",
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }
        if (!this.match(TokenType.StackOpen)) {
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "missing { after for(...)",
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }

        const body = this.parseCodeBlock([...this.stack[this.stackIndex].declaredVariables])

        this.stack.pop()
        this.stackIndex--
        return _for(initializer, condition, update, body)
    }

    // `import [types] (* | "{" <name> {"," <name>} "}") [as <ident>] from <string>`.
    // The `import` keyword has already been consumed. `from`/`as`/`types` are
    // contextual keywords (plain identifiers in the lexer). The clause order
    // mirrors `lexer.findImports`, which drives import discovery.
    protected parseImport(): Node {
        if (!this.isGlobalScope()) {
            throw new ParserError({
                type: ParserErrorType.InvalidDeclarationScope,
                message: "imports are only allowed at the top level",
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }

        let typeOnly = false
        if (this.peekContextualKeyword("types")) {
            this.getToken()
            typeOnly = true
        }

        let kind: ImportKind
        const names: number[] = []
        if (this.match(TokenType.Star)) {
            kind = ImportKind.wildcard
        } else if (this.match(TokenType.StackOpen)) {
            kind = ImportKind.named
            while (!this.match(TokenType.StackClose)) {
                if (this.match(TokenType.EOF)) {
                    throw new ParserError({
                        type: ParserErrorType.UnexpectedEndOfFile,
                        message: "missing } in import list",
                        line: this.currentToken.line,
                        column: this.currentToken.column,
                        filePath: this.fileManager.lexer.getPath()
                    })
                }
                const nameToken = this.getToken()
                if (nameToken.type !== TokenType.Identifier) {
                    throw new ParserError({
                        type: ParserErrorType.UnexpectedToken,
                        message: "expected an imported name",
                        line: nameToken.line,
                        column: nameToken.column,
                        filePath: this.fileManager.lexer.getPath()
                    })
                }
                names.push(nameToken.data)
                this.match(TokenType.Comma)
            }
        } else {
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: `expected "{" or "*" after import`,
                line: this.peek().line,
                column: this.peek().column,
                filePath: this.fileManager.lexer.getPath()
            })
        }

        let alias: number | null = null
        if (this.peekContextualKeyword("as")) {
            this.getToken()
            alias = this.expectIdentifier("expected a namespace name after as")
        }

        if (!this.peekContextualKeyword("from")) {
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: `expected "from" in import`,
                line: this.peek().line,
                column: this.peek().column,
                filePath: this.fileManager.lexer.getPath()
            })
        }
        this.getToken() // consume `from`

        if (!this.match(TokenType.StringLiteral)) {
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "expected a module path string after from",
                line: this.peek().line,
                column: this.peek().column,
                filePath: this.fileManager.lexer.getPath()
            })
        }
        const path = this.currentToken.data
        this.match(TokenType.Semicolon)

        return _import({kind, typeOnly, names, path, alias})
    }

    parseFile(){
        while(this.tokens[this.currentTokenIndex + 1].type !== TokenType.EOF){
            this.program.children.push(this.parseToken())
        }
    }
}