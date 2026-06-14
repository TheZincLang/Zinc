import {Token, TokenType} from "../lexer/lexerTypes.ts";
import {
    BinaryExpressionOperator,
    BitwiseOperator,
    EnumOptionNode,
    ExpressionOperator,
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
    UnaryOperator
} from "./ParserTypes.ts"
import {
    _binary,
    _bitwise,
    _call,
    _codeBlock,
    _enum,
    _fieldAccess,
    _if,
    _literal,
    _math,
    _postfix,
    _stringTemplate,
    _stringTemplateExpressionPart,
    _stringTemplateStringPart,
    _switch,
    _switchCase,
    _switchDefault,
    _unary,
    _variable
} from "./helperFunctions.ts";
import {printNode, SymbolTable} from "./prettyPrinter.ts";
import {TypeKind} from "../global/types/globalTypes.ts";
import {FileManager} from "../file/fileManager/fileManager.ts";

export class Parser{
    protected tokens: Token[]
    protected fileManager: FileManager
    protected stack: StackEntry[] = [{
        declaredVariables: new Set<number>(),
    }]
    protected declaredFunctions = new Set<number>()
    protected declaredTypes = new Set<number>()
    protected stackIndex: number = 0
    protected currentTokenIndex: number = 0
    protected currentModifiers: Set<Modifier> = new Set()
    protected program: Program = {children: []}
    protected currentToken: Token

    initializeParser(tokens: Token[]){
        this.tokens = tokens
    }

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
        return table
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

    protected parseLet(): Node{
        const IdToken = this.getToken()
        const variableId = IdToken.data
        let variableType: TypeKind
        let currentModifiers: Set<Modifier> = new Set<Modifier>(this.currentModifiers)
        this.currentModifiers.clear()
        let definition: Node | undefined
        if(this.match(TokenType.Colon)){
            variableType = this.getToken().data
            if(this.match(TokenType.LBrace) && this.match(TokenType.RBrace)){
                currentModifiers.add(Modifier.array)
            }
        } else {
            variableType = TypeKind.Unknown
        }
        if(this.match(TokenType.Assign)){
            definition = this.parseExpression()
        }
        if(this.stack[this.stackIndex].declaredVariables.has(variableId)){
            throw new Error(`Redeclaration of variable "${variableId}"`)
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

        let enumType: TypeKind = TypeKind.Unknown
        if(this.match(TokenType.Colon)){
            enumType = this.getToken().data
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
        return this.parseTernary()
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
                throw new Error("Unrecognized expression")
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
        while (true){
            if(this.match(TokenType.Equal)){
                left = _binary(BinaryExpressionOperator.Equal, left, this.parseComparison())
            } else if (this.match(TokenType.NotEqual)){
                left = _binary(BinaryExpressionOperator.NotEqual, left, this.parseComparison())
            } else {
                break
            }
        }
        return left
    }

    parseComparison(): Node {
        let left = this.parseBitwiseOr()
        while (true){
            if(this.match(TokenType.LessThan)){
                left = _binary(BinaryExpressionOperator.LessThan, left, this.parseBitwiseOr())
            } else if (this.match(TokenType.LessThanOrEqual)){
                left = _binary(BinaryExpressionOperator.LessThanOrEqual, left, this.parseBitwiseOr())
            } else if (this.match(TokenType.MoreThan)){
                left = _binary(BinaryExpressionOperator.MoreThan, left, this.parseBitwiseOr())
            } else if (this.match(TokenType.MoreThanOrEqual)){
                left = _binary(BinaryExpressionOperator.MoreThanOrEqual, left, this.parseBitwiseOr())
            } else {
                break
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
        let left = this.parseTerm()
        while (this.match(TokenType.Ampersand)){
            const right = this.parseTerm()
            left = _bitwise(BitwiseOperator.And, left, right)
        }
        return left
    }

    parseTerm(): Node {
        let left = this.parseFactor()
        while (true){
            if(this.match(TokenType.Plus)){
                left = _math(ExpressionOperator.add, left, this.parseFactor())
            } else if (this.match(TokenType.Minus)){
                left = _math(ExpressionOperator.subtract, left, this.parseFactor())
            } else {
                break
            }
        }
        return left
    }

    parseFactor(): Node {
        let left = this.parseExponent()
        while (true){
            if(this.match(TokenType.Star)){
                left = _math(ExpressionOperator.multiply, left, this.parseExponent())
            } else if (this.match(TokenType.Slash)){
                left = _math(ExpressionOperator.divide, left, this.parseExponent())
            } else if (this.match(TokenType.Modulo)){
                left = _math(ExpressionOperator.modulus, left, this.parseExponent())
            } else {
                break
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
        if(this.match(TokenType.Not)){
            return _unary(UnaryOperator.booleanNot, this.parseUnary())
        } else if (this.match(TokenType.Minus)){
            return _unary(UnaryOperator.negative, this.parseUnary())
        } else if (this.match(TokenType.Tilde)){
            return _unary(UnaryOperator.bitwiseNot, this.parseUnary())
        } else if (this.match(TokenType.Increment)){
            return _unary(UnaryOperator.increment, this.parseUnary())
        } else if (this.match(TokenType.Decrement)){
            return _unary(UnaryOperator.decrement, this.parseUnary())
        } else {
            return this.parsePostfix()
        }
    }

    parsePostfix(): Node {
        let left = this.parsePrimary()
        while (true){
            if(this.match(TokenType.Increment)){
                left = _postfix(PostfixOperator.increment, left)
            } else if (this.match(TokenType.Decrement)){
                left = _postfix(PostfixOperator.decrement, left)
            } else if (this.match(TokenType.LParen)){
                left = this.parseFunctionCall(left)
            } else if(this.match(TokenType.LBrace)){
                if(this.match(TokenType.RBrace)){
                    throw new ParserError({
                        type: ParserErrorType.InvalidSyntax,
                        message: "expected index expression",
                        line: this.currentToken.line,
                        column: this.currentToken.column,
                    })
                } else {
                    left = _postfix(PostfixOperator.index, left, [this.parseExpression()])
                    if(!this.match(TokenType.RBrace)){
                        throw new ParserError({
                            type: ParserErrorType.InvalidSyntax,
                            message: "expected a ]",
                            line: this.currentToken.line,
                            column: this.currentToken.column,
                        })
                    }
                }
            } else if (this.match(TokenType.Dot)){
                printNode(left)
                left = this.parseFieldAccess(left)
            } else {
                break
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
        if(this.match(TokenType.IntLiteral)){
            return _literal(LiteralType.Integer, this.currentToken.data)
        } else if (this.match(TokenType.FloatLiteral)){
            return _literal(LiteralType.Float, this.currentToken.data)
        } else if (this.match(TokenType.DoubleLiteral)){
            return _literal(LiteralType.Double, this.currentToken.data)
        } else if (this.match(TokenType.StringLiteral)){
            return _literal(LiteralType.String, this.currentToken.data)
        } else if (this.match(TokenType.CharLiteral)){
            return _literal(LiteralType.CharLiteral, this.currentToken.data)
        } else if (this.match(TokenType.StringTemplate)){
            return this.parseStringTemplate()
        } else if (this.match(TokenType.BoolLiteral)){
            return _literal(LiteralType.Boolean, this.currentToken.data)
        } else if (this.match(TokenType.LParen)){
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
        } else if (this.match(TokenType.Identifier)){
            return this.parseIdentifier()
        } else {
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
        if(this.match(TokenType.LParen)){
            return this.parseFunctionCall(identifier)
        } else if(this.match(TokenType.Dot)) {
            printNode(identifier, {symbolTable: this.getSymbolTable()})
            return this.parseFieldAccess(identifier)
        } else {
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
            args.push(this.parseToken())
            if(this.match(TokenType.Comma)){
                this.getToken()
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
                parts.push(_stringTemplateExpressionPart(this.parseCodeBlock()))
                if(!this.match(TokenType.StringTemplateEnd)){
                    throw new Error("expected end of string template expression")
                }
            } else {
                break
            }
        }
        return _stringTemplate(parts)
    }

    parseCodeBlock(): Node {
        const body: Node[] = []
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
        if(!this.match(TokenType.LParen)){
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

    protected parseToken(): Node{
        this.getToken()
        switch (this.currentToken.type){
            case TokenType.Fn:
                break;
            case TokenType.Import:
                break;
            case TokenType.For:
                break;
            case TokenType.Let: {
                return this.parseLet()
            }
            case TokenType.Const: {
                this.currentModifiers.add(Modifier.const)
                if(this.peek().type === TokenType.Enum){
                    return this.parseEnum()
                } else {
                    return this.parseLet()
                }
            }
            case TokenType.Async: {
                this.currentModifiers.add(Modifier.async)
                break
            }
            case TokenType.IntLiteral:
            case TokenType.FloatLiteral:
            case TokenType.DoubleLiteral:{
                return this.parseExpression()
            }
            case TokenType.BoolLiteral: {
                return _literal(LiteralType.Boolean, this.currentToken.data)
            }
            case TokenType.StringLiteral: {
                return _literal(LiteralType.String, this.currentToken.data)
            }
            case TokenType.Enum: {
                return this.parseEnum()
            }
            case TokenType.Export: {
                this.getToken()
                const definition = this.parseToken()
                this.fileManager.exports.push(definition)
                return definition
            }
            case TokenType.If: {
                return this.parseIf()
            }
            case TokenType.Switch: {
                return this.parseSwitch()
            }
            default: {
                return this.parseExpression()
            }
        }
    }

    parseFile(){
        while(this.tokens[this.currentTokenIndex + 1].type !== TokenType.EOF){
            this.program.children.push(this.parseToken()!)
        }
    }
}