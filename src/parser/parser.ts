import {Token, TokenType} from "../lexer/lexerTypes.ts";
import {
    AssignmentOperator,
    BinaryExpressionOperator,
    BitwiseOperator,
    CodeBlockNode,
    EnumOptionNode,
    ExpressionOperator,
    FunctionParameter,
    ImportKind,
    LiteralType,
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
    _codeBlock,
    _continue,
    _enum,
    _field,
    _fieldAccess,
    _for,
    _forIn,
    _function,
    _if,
    _import,
    _literal,
    _loop,
    _math,
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
    _unary,
    _variable,
    _while,
} from "./helperFunctions.ts";
import {SymbolTable} from "./prettyPrinter.ts";
import {PRIMITIVE_TYPES, TypeKind} from "../global/types/globalTypes.ts";
import {FileManager} from "../file/fileManager/fileManager.ts";

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
            this.getToken()
            const value = this.parseAssignment()
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
                this.getToken()
                return this.parseArrayLiteral()
            case TokenType.LParen: {
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

    parseCodeBlock(initialVariables: number[] = []): CodeBlockNode {
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
        return {body}
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
                elseNode = _codeBlock(this.parseCodeBlock().body)
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

    parseSwitchCaseBody(): CodeBlockNode {
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

    // Reads a type annotation: a type name plus any number of `[]` array suffixes.
    protected parseType(): TypeNode {
        return this.parseTypeMember()
    }

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
        let type: TypeNode = _nameType(token.data, resolved)
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

        if(!this.match(TokenType.StackOpen)){
            throw new ParserError({
                type: ParserErrorType.InvalidSyntax,
                message: "missing { before struct body",
                line: this.currentToken.line,
                column: this.currentToken.column,
                filePath: this.fileManager.lexer.getPath()
            })
        }

        const fields = this.parseStructBody()

        this.declaredTypes.add(structId)

        return _struct({
            id: structId,
            modifiers: currentModifiers,
            fields
        })
    }

    protected parseStructBody(): Node[] {
        const members: Node[] = []
        const fieldIds = new Set<number>()
        while(!this.match(TokenType.StackClose)){
            if(this.match(TokenType.EOF)){
                throw new ParserError({
                    type: ParserErrorType.UnexpectedEndOfFile,
                    message: "missing } in struct body",
                    line: this.currentToken.line,
                    column: this.currentToken.column,
                    filePath: this.fileManager.lexer.getPath()
                })
            }
            let member: Node
            if(this.match(TokenType.Fn)){
                member = this.parseMethod()
            } else if(this.peek().type === TokenType.Identifier){
                member = this.parseFieldDeclaration()
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
            } else {
                const bad = this.getToken()
                throw new ParserError({
                    type: ParserErrorType.UnexpectedToken,
                    message: "expected a field or method in struct body",
                    line: bad.line,
                    column: bad.column,
                    filePath: this.fileManager.lexer.getPath()
                })
            }
            members.push(member)
        }
        return members
    }

    protected parseFieldDeclaration(): Node {
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
        return _field({modifiers: new Set(), id: fieldId, type})
    }

    protected parseMethod(): Node {
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
            modifiers: new Set(),
            parameters,
            returnType,
            body
        })
    }

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
            case TokenType.Enum: {
                this.getToken()
                return this.parseEnum()
            }
            case TokenType.Struct: {
                this.getToken()
                return this.parseStruct()
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
            default: {
                return this.parseExpression()
            }
        }
    }

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

    protected peekContextualKeyword(name: string): boolean {
        return this.peek().type === TokenType.Identifier
            && this.resolveIdentifierName(this.peek().data) === name
    }

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

    protected parseForIn(): Node {
        const variableId = this.getToken().data
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
