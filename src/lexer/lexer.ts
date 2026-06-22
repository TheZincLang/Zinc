import {
    CharType,
    LexerError,
    LexerErrorType,
    ScopeExitOperation,
    ScopeExitOperations,
    Token,
    TokenType
} from "./lexerTypes.ts"
import {FileBuffer} from "./utility/buffers/fileBuffer.ts"
import path from "node:path"
import {existsSync} from "node:fs"
import {DEFAULT_IMPORTS, KEYWORDS_MAP} from "./const.ts"
import {checkIfHexDigit, checkIfOctDigit, classify, hexVal} from "./helperFunctions.ts";
import {SymbolTable} from "../parser/prettyPrinter.ts";
import {FileManager} from "../file/fileManager/fileManager.ts";

export class Lexer {
    protected readonly path: string
    protected readonly fileBuffer: FileBuffer
    protected identifierMap: Map<string, number> = this.makeIdentifierMap()
    protected stringLiteralMap: Map<string, number> = new Map<string, number>()

    constructor(fileManager: FileManager) {
        this.path = fileManager.path
        this.fileBuffer = new FileBuffer(this.path)
    }

    makeIdentifierMap(){
        return new Map<string, number>([

        ])
    }

    getSymbolTable(): SymbolTable {
        const identifiers = new Map([...this.identifierMap].map(([k, v]) => [v, k]))
        const strings     = new Map([...this.stringLiteralMap].map(([k, v]) => [v, k]))
        return { variables: identifiers, strings }
    }

    getPath(): string {
        return this.path
    }

    getIdentifierMap() {
        return this.identifierMap
    }

    getStringLiteralMap() {
        return this.stringLiteralMap
    }

    getChar(){
        return this.fileBuffer.getChar()
    }

    peek() {
        return this.fileBuffer.peek()
    }

    skipLine(){
        let char = this.getChar()
        while(char !== '\n' && char !== '\0'){
            char = this.getChar()
        }
    }

    handleCharLiteral(): string {
        let currentChar = this.getChar()
        let char = ""
        if(currentChar === "\\"){
            currentChar = this.getChar()
            switch(currentChar){
                case "n": {
                    char = "\n"
                    break
                }
                case "r": {
                    char = "\r"
                    break
                }
                case "t": {
                    char = "\t"
                    break
                }
                case "b": {
                    char = "\b"
                    break
                }
                case "0": {
                    char = "\0"
                    break
                }
                case "'": {
                    char = "'"
                    break
                }
                case "\"": {
                    char = "\""
                    break
                }
                case "\\": {
                    char = "\\"
                    break
                }
                default: {
                    throw new LexerError({
                        type: LexerErrorType.invalidSyntax,
                        message: "invalid escape sequence in char literal",
                        line: this.fileBuffer.getLineIndex(),
                        column: this.fileBuffer.getColumnIndex(),
                        filePath: this.path
                    })
                }
            }
        } else {
            char = currentChar
        }
        return char
    }

    lexFile(){
        let tokens: Token[] = []
        const SOFToken: Token = {
            type: TokenType.SOF,
            data: 0,
            line: -1,
            column: -1
        }
        tokens.push(SOFToken)
        let currentChar = this.getChar()
        let currentString: string = ""
        let currentToken: Token = {
            type: 0,
            data: 0,
            line: this.fileBuffer.getLineIndex(),
            column: this.fileBuffer.getColumnIndex()
        }
        let scopeStack: ScopeExitOperation[] = []
        while(currentChar !== '\0'){
            currentString = ""
            switch(classify(currentChar)){
                case CharType.punctuation: {
                    switch (currentChar) {
                        case ".": {
                            switch (this.peek()) {
                                case ".": {
                                    this.getChar()
                                    if (this.peek() === ".") {
                                        this.getChar()
                                        currentToken.type = TokenType.Spread
                                    } else {
                                        currentToken.type = TokenType.Range
                                    }
                                    break
                                }
                                default: {
                                    currentToken.type = TokenType.Dot
                                    break
                                }
                            }
                            break
                        }
                        case ",":{
                            currentToken.type = TokenType.Comma
                            break
                        }
                        case ";":{
                            currentToken.type = TokenType.Semicolon
                            break
                        }
                        case "#":{
                            currentToken.type = TokenType.Octothorpe
                            break
                        }
                        case "@":{
                            currentToken.type = TokenType.At
                            break
                        }
                        case "\\":{
                            currentToken.type = TokenType.Backslash
                            break
                        }
                        case "`":{
                            currentToken.type = TokenType.Backtick
                            break
                        }
                    }
                    tokens.push({...currentToken})
                    currentChar = this.getChar()
                    break
                }
                case CharType.stringIndicator: {
                    switch (currentChar){
                        case "\"":{
                            currentToken.line = this.fileBuffer.getLineIndex()
                            currentToken.column = this.fileBuffer.getColumnIndex()
                            currentToken.type = TokenType.StringLiteral
                            let currentString = ""
                            currentChar = this.peek()
                            while (currentChar !== "\""){
                                currentString += this.handleCharLiteral()
                                currentChar = this.peek()
                                if(this.peek() === "\0"){
                                    throw new LexerError({
                                        type: LexerErrorType.invalidSyntax,
                                        message: "missing closing \" in string literal",
                                        line: this.fileBuffer.getLineIndex(),
                                        column: this.fileBuffer.getColumnIndex(),
                                        filePath: this.path,
                                        thrownFromFile: "lexer.ts",
                                        thrownFromLine: 163
                                    })
                                }
                            }
                            this.getChar() // Consume the closing quote
                            const index = this.stringLiteralMap.has(currentString) ? this.stringLiteralMap.get(currentString)! : this.stringLiteralMap.size
                            this.stringLiteralMap.set(currentString, index)
                            currentToken.data = this.stringLiteralMap.size - 1
                            break
                        }
                        case "'": {
                            currentToken.line = this.fileBuffer.getLineIndex()
                            currentToken.column = this.fileBuffer.getColumnIndex()
                            currentToken.type = TokenType.CharLiteral
                            currentToken.data = this.handleCharLiteral().charCodeAt(0)
                            currentChar = this.getChar()
                            if(currentChar !== "'"){
                                throw new LexerError({
                                    type: LexerErrorType.invalidSyntax,
                                    message: "missing closing ' in char literal",
                                    line: this.fileBuffer.getLineIndex(),
                                    column: this.fileBuffer.getColumnIndex(),
                                    filePath: this.path
                                })
                            }
                            break
                        }
                        case "`":{
                            const templateStartLine = this.fileBuffer.getLineIndex()
                            const templateStartColumn = this.fileBuffer.getColumnIndex()
                            let templateValue = ""

                            while(true){
                                const nextChar = this.peek()
                                if(nextChar === "\0") {
                                    throw new LexerError({
                                        type: LexerErrorType.invalidSyntax,
                                        message: "missing closing ` in string template",
                                        line: this.fileBuffer.getLineIndex(),
                                        column: this.fileBuffer.getColumnIndex(),
                                        filePath: this.path
                                    })
                                }

                                if(nextChar === "`") {
                                    this.getChar()
                                    const existingTemplateId = this.stringLiteralMap.get(templateValue)
                                    if(existingTemplateId === undefined) {
                                        this.stringLiteralMap.set(templateValue, this.stringLiteralMap.size)
                                    }
                                    tokens.push({
                                        type: TokenType.StringTemplate,
                                        data: this.stringLiteralMap.get(templateValue) ?? 0,
                                        line: templateStartLine,
                                        column: templateStartColumn
                                    })
                                    currentChar = this.getChar()
                                    break
                                }

                                if(nextChar === "$") {
                                    this.getChar()
                                    if(this.peek() === "{") {
                                        this.getChar()
                                        const existingTemplateId = this.stringLiteralMap.get(templateValue)
                                        if(existingTemplateId === undefined) {
                                            this.stringLiteralMap.set(templateValue, this.stringLiteralMap.size)
                                        }
                                        tokens.push({
                                            type: TokenType.StringTemplate,
                                            data: this.stringLiteralMap.get(templateValue) ?? 0,
                                            line: templateStartLine,
                                            column: templateStartColumn
                                        })
                                        tokens.push({
                                            type: TokenType.StringTemplateStart,
                                            data: 0,
                                            line: this.fileBuffer.getLineIndex(),
                                            column: this.fileBuffer.getColumnIndex()
                                        })
                                        scopeStack.push(new ScopeExitOperation(ScopeExitOperations.closeStringTemplate))
                                        currentChar = this.getChar()
                                        break
                                    }
                                    templateValue += "$"
                                    continue
                                }

                                templateValue += this.handleCharLiteral()
                            }
                            continue
                        }
                    }
                    tokens.push({...currentToken})
                    currentChar = this.getChar()
                    break
                }
                case CharType.operator: {
                    currentToken.line = this.fileBuffer.getLineIndex()
                    currentToken.column = this.fileBuffer.getColumnIndex()
                    currentToken.data = 0
                    switch (currentChar){
                        case "+": {
                            switch (this.peek()){
                                case "+": {
                                    this.getChar()
                                    currentToken.type = TokenType.Increment
                                    break
                                }
                                case "=": {
                                    this.getChar()
                                    currentToken.type = TokenType.AddAssign
                                    break
                                }
                                default: {
                                    currentToken.type = TokenType.Plus
                                    break
                                }
                            }
                            break
                        }
                        case "-": {
                            switch (this.peek()){
                                case "-": {
                                    this.getChar()
                                    currentToken.type = TokenType.Decrement
                                    break
                                }
                                case "=": {
                                    this.getChar()
                                    currentToken.type = TokenType.SubAssign
                                    break
                                }
                                case ">": {
                                    this.getChar()
                                    currentToken.type = TokenType.Arrow
                                    break
                                }
                                default: {
                                    currentToken.type = TokenType.Minus
                                    break
                                }
                            }
                            break
                        }
                        case "*": {
                            switch (this.peek()){
                                case "=": {
                                    this.getChar()
                                    currentToken.type = TokenType.MulAssign
                                    break
                                }
                                case "*":{
                                    this.getChar()
                                    if(this.peek() === "="){
                                        this.getChar()
                                        currentToken.type = TokenType.ExpAssign
                                    } else {
                                        currentToken.type = TokenType.Exponentiation
                                    }
                                    break
                                }
                                default: {
                                    currentToken.type = TokenType.Star
                                    break
                                }
                            }
                            break
                        }
                        case "/": {
                            switch (this.peek()){
                                case "/": {
                                    this.skipLine()
                                    currentChar = this.getChar()
                                    continue
                                }
                                case "*": {
                                    this.getChar()
                                    let prevChar = ""
                                    while(true){
                                        const char = this.getChar()
                                        if(char === '\0') {
                                            throw new LexerError({
                                                type: LexerErrorType.invalidSyntax,
                                                message: "missing closing */ in block comment",
                                                line: this.fileBuffer.getLineIndex(),
                                                column: this.fileBuffer.getColumnIndex(),
                                                filePath: this.path
                                            })
                                        }
                                        if(prevChar === "*" && char === "/") break
                                        prevChar = char
                                    }
                                    currentChar = this.getChar()
                                    continue
                                }
                                case "=": {
                                    this.getChar()
                                    currentToken.type = TokenType.DivAssign
                                    break
                                }
                                default: {
                                    currentToken.type = TokenType.Slash
                                    break
                                }
                            }
                            break
                        }
                        case "%": {
                            switch (this.peek()){
                                case "=": {
                                    this.getChar()
                                    currentToken.type = TokenType.ModAssign
                                    break
                                }
                                default: {
                                    currentToken.type = TokenType.Modulo
                                    break
                                }
                            }
                            break
                        }
                        case "=": {
                            switch (this.peek()){
                                case "=": {
                                    this.getChar()
                                    currentToken.type = TokenType.Equal
                                    break
                                }
                                case ">": {
                                    this.getChar()
                                    currentToken.type = TokenType.FatArrow
                                    break
                                }
                                default: {
                                    currentToken.type = TokenType.Assign
                                    break
                                }
                            }
                            break
                        }
                        case "<": {
                            switch (this.peek()){
                                case "<": {
                                    this.getChar()
                                    if(this.peek() === "="){
                                        this.getChar()
                                        currentToken.type = TokenType.ShiftLeftAssign
                                    } else {
                                        currentToken.type = TokenType.ShiftLeft
                                    }
                                    break
                                }
                                case "=": {
                                    this.getChar()
                                    currentToken.type = TokenType.LessThanOrEqual
                                    break
                                }
                                default: {
                                    currentToken.type = TokenType.LessThan
                                    break
                                }
                            }
                            break
                        }
                        case ">": {
                            switch (this.peek()){
                                case "=": {
                                    this.getChar()
                                    currentToken.type = TokenType.MoreThanOrEqual
                                    break
                                }
                                case ">": {
                                    this.getChar()
                                    if(this.peek() === "="){
                                        this.getChar()
                                        currentToken.type = TokenType.ShiftRightAssign
                                    } else {
                                        currentToken.type = TokenType.ShiftRight
                                    }
                                    break
                                }
                                default: {
                                    currentToken.type = TokenType.MoreThan
                                    break
                                }
                            }
                            break
                        }
                        case "!": {
                            if(this.peek() === "="){
                                this.getChar()
                                currentToken.type = TokenType.NotEqual
                            } else {
                                currentToken.type = TokenType.Not
                            }
                            break
                        }
                        case "&": {
                            switch (this.peek()){
                                case "&": {
                                    this.getChar()
                                    if(this.peek() === "="){
                                        this.getChar()
                                        currentToken.type = TokenType.AndAssign
                                    } else {
                                        currentToken.type = TokenType.And
                                    }
                                    break
                                }
                                case "=": {
                                    this.getChar()
                                    currentToken.type = TokenType.BitAndAssign
                                    break
                                }
                                default: {
                                    currentToken.type = TokenType.Ampersand
                                    break
                                }
                            }
                            break
                        }
                        case "|": {
                            switch (this.peek()){
                                case "|": {
                                    this.getChar()
                                    if(this.peek() === "="){
                                        this.getChar()
                                        currentToken.type = TokenType.OrAssign
                                    } else {
                                        currentToken.type = TokenType.Or
                                    }
                                    break
                                }
                                case "=": {
                                    this.getChar()
                                    currentToken.type = TokenType.BitOrAssign
                                    break
                                }
                                default: {
                                    currentToken.type = TokenType.Pipe
                                    break
                                }
                            }
                            break
                        }
                        case "^": {
                            switch (this.peek()){
                                case "=": {
                                    this.getChar()
                                    currentToken.type = TokenType.BitXorAssign
                                    break
                                }
                                default: {
                                    currentToken.type = TokenType.Caret
                                    break
                                }
                            }
                            break
                        }
                        case "~": {
                            currentToken.type = TokenType.Tilde
                            break
                        }
                        case "?": {
                            currentToken.type = TokenType.Question
                            break
                        }
                        case ":": {
                            switch (this.peek()){
                                case ":": {
                                    this.getChar()
                                    currentToken.type = TokenType.DoubleColon
                                    break
                                }
                                default: {
                                    currentToken.type = TokenType.Colon
                                    break
                                }
                            }
                            break
                        }
                        case "$": {
                            currentToken.type = TokenType.DollarSign
                            break
                        }
                    }
                    tokens.push({...currentToken})
                    currentChar = this.getChar()
                    break
                }
                case CharType.structure: {
                    switch (currentChar){
                        case "{":{
                            scopeStack.push(new ScopeExitOperation(ScopeExitOperations.none))
                            currentToken.type = TokenType.StackOpen
                            currentChar = this.getChar()
                            break
                        }
                        case "}": {
                            const scopeStackAction = scopeStack.pop()
                            if(!scopeStackAction) {
                                throw new LexerError({
                                    type: LexerErrorType.invalidSyntax,
                                    message: "unexpected } with no corresponding {",
                                    line: this.fileBuffer.getLineIndex(),
                                    column: this.fileBuffer.getColumnIndex(),
                                    filePath: this.path
                                })
                            }
                            if(scopeStackAction.isNoOp()) {
                                currentToken.type = TokenType.StackClose
                                currentChar = this.getChar()
                            } else if(scopeStackAction.hasOperation(ScopeExitOperations.closeStringTemplate)){
                                currentToken.type =TokenType.StringTemplateEnd
                                currentChar = "`"
                            } else {
                                currentChar = this.getChar()
                            }
                            break
                        }
                        case "(": {
                            currentToken.type = TokenType.LParen
                            currentChar = this.getChar()
                            break
                        }
                        case ")": {
                            currentToken.type = TokenType.RParen
                            currentChar = this.getChar()
                            break
                        }
                        case "[": {
                            currentToken.type = TokenType.LBrace
                            currentChar = this.getChar()
                            break
                        }
                        case "]": {
                            currentToken.type = TokenType.RBrace
                            currentChar = this.getChar()
                            break
                        }
                    }
                    currentToken.line = this.fileBuffer.getLineIndex()
                    currentToken.column = this.fileBuffer.getColumnIndex()
                    tokens.push({...currentToken})
                    break
                }
                case CharType.ignored: {
                    currentChar = this.getChar()
                    break
                }
                case CharType.terminator: {
                    currentChar = this.getChar()
                    break
                }
                case CharType.whitespace: {
                    currentChar = this.getChar()
                    break
                    /*let sentNewline: boolean = false
                    while (classify(currentChar) === CharType.whitespace) {
                        if(currentChar === "\n" && !sentNewline){
                            tokens.push({
                                type: TokenType.Newline,
                                data: 0,
                                line: this.fileBuffer.getLineIndex(),
                                column: this.fileBuffer.getColumnIndex()
                            })
                            sentNewline = true
                        }
                        currentChar = this.getChar()
                    }
                    break*/
                }
                case CharType.alpha: {
                    currentString += currentChar
                    currentChar = this.getChar()
                    currentToken.line = this.fileBuffer.getLineIndex()
                    currentToken.column = this.fileBuffer.getColumnIndex()
                    while(
                            classify(currentChar) === CharType.alpha ||
                            classify(currentChar) === CharType.number ||
                            currentChar === "_"
                        ){
                        currentString += currentChar
                        currentChar = this.getChar()
                    }

                    if(currentString === "True") {
                        currentToken.type = TokenType.BoolLiteral
                        currentToken.data = 1
                    } else if(currentString === "False") {
                        currentToken.type = TokenType.BoolLiteral
                        currentToken.data = 0
                    } else {
                        const keywordData = KEYWORDS_MAP.get(currentString)
                        if(keywordData){
                            currentToken.type = keywordData
                        } else {
                            const identData = this.identifierMap.get(currentString)
                            currentToken.type = TokenType.Identifier
                            if(identData !== undefined){
                                currentToken.data = identData
                            } else {
                                currentToken.data = this.identifierMap.size
                                this.identifierMap.set(currentString, this.identifierMap.size)
                            }
                        }
                    }
                    tokens.push({...currentToken})
                    break
                }
                case CharType.number:{
                    let currentNum = 0
                    currentToken.type = TokenType.IntLiteral
                    if(currentChar === "0"){
                        currentChar = this.getChar()
                        currentToken.line = this.fileBuffer.getLineIndex()
                        currentToken.column = this.fileBuffer.getColumnIndex()
                        switch (currentChar){
                            case "x": { //Hex
                                currentChar = this.getChar()
                                let valid: boolean = false
                                if(checkIfHexDigit(currentChar)){
                                    valid = true
                                    currentNum = currentNum * 16 + hexVal(currentChar.charCodeAt(0))
                                    currentChar = this.getChar()
                                }
                                while(checkIfHexDigit(currentChar)){
                                    currentNum = currentNum * 16 + hexVal(currentChar.charCodeAt(0))
                                    currentChar = this.getChar()
                                }
                                if(!valid) {
                                    throw new LexerError({
                                        type: LexerErrorType.invalidSyntax,
                                        message: "misshaped hex notation: no digits present",
                                        line: this.fileBuffer.getLineIndex(),
                                        column: this.fileBuffer.getColumnIndex()
                                    })
                                }
                                if(currentChar === ".") {
                                    let fracInt: number = 0
                                    let digitCount: number = 0
                                    currentChar = this.getChar()
                                    while(checkIfHexDigit(currentChar)){
                                        fracInt = fracInt * 16 + hexVal(currentChar.charCodeAt(0))
                                        digitCount++
                                        currentChar = this.getChar()
                                    }
                                    currentNum += fracInt / (16 ** digitCount)
                                    currentToken.type = TokenType.FloatLiteral
                                }
                                if(currentChar === "p" || currentChar === "P") { //Hex floats
                                    let exponentSign = 0
                                    currentChar = this.getChar()
                                    if(currentChar === "+"){
                                        exponentSign = 1
                                    } else if(currentChar === "-") {
                                        exponentSign = -1
                                    } else {
                                        if(classify(currentChar) === CharType.number){
                                            exponentSign = 1
                                        } else {
                                            throw new LexerError({
                                                type: LexerErrorType.invalidSyntax,
                                                message: "misshaped hex notation: invalid exponent sign",
                                                line: this.fileBuffer.getLineIndex(),
                                                column: this.fileBuffer.getColumnIndex()
                                            })
                                        }
                                    }
                                    let exponentNum = 0
                                    currentChar = this.getChar()
                                    while(classify(currentChar) === CharType.number){
                                        exponentNum = exponentNum * 10 + currentChar.charCodeAt(0) - 0x30
                                        currentChar = this.getChar()
                                    }
                                    currentNum = currentNum * (2 ** (exponentNum * exponentSign))
                                    currentToken.type = TokenType.FloatLiteral
                                } else { //normal Hex number
                                    if(classify(currentChar) !== CharType.whitespace) {
                                        throw new LexerError({
                                            type: LexerErrorType.invalidSyntax,
                                            message: "misshaped hex notation: invalid character in hex number",
                                            line: this.fileBuffer.getLineIndex(),
                                            column: this.fileBuffer.getColumnIndex()
                                        })
                                    }
                                }
                                break
                            }
                            case "b": {
                                currentChar = this.getChar()
                                if(currentChar === "0"){
                                    currentNum *= 2
                                } else if (currentChar === "1") {
                                    currentNum *= 2
                                    currentNum += 1
                                } else {
                                    throw new LexerError({
                                        type: LexerErrorType.invalidSyntax,
                                        message: "misshaped binary notation: no digits present",
                                        line: this.fileBuffer.getLineIndex(),
                                        column: this.fileBuffer.getColumnIndex()
                                    })
                                }
                                currentChar = this.getChar()
                                while(true){
                                    if(currentChar === "0"){
                                        currentNum *= 2
                                    } else if (currentChar === "1") {
                                        currentNum *= 2
                                        currentNum += 1
                                    } else {
                                        break
                                    }
                                    currentChar = this.getChar()
                                }
                                if(classify(currentChar) === CharType.alpha) {
                                    throw new LexerError({
                                        type: LexerErrorType.invalidSyntax,
                                        message: "misshaped binary notation: invalid character in binary number",
                                        line: this.fileBuffer.getLineIndex(),
                                        column: this.fileBuffer.getColumnIndex()
                                    })
                                }
                                break
                            }
                            case "o": {
                                currentChar = this.getChar()
                                while(checkIfOctDigit(currentChar)){
                                    currentNum = currentNum * 8 + Number(currentChar[0])
                                    currentChar = this.getChar()
                                }
                                if(classify(currentChar) === CharType.alpha) {
                                    throw new LexerError({
                                        type: LexerErrorType.invalidSyntax,
                                        message: "misshaped decimal notation: invalid character in decimal number",
                                        line: this.fileBuffer.getLineIndex(),
                                        column: this.fileBuffer.getColumnIndex()
                                    })
                                }
                                break
                            }
                        }

                    } else {
                        while(classify(currentChar) === CharType.number){
                            currentNum = currentNum * 10 + currentChar.charCodeAt(0) - 0x30
                            currentChar = this.getChar()
                        }
                        // Handle decimal point for floats
                        if(currentChar === ".") {
                            currentToken.type = TokenType.DoubleLiteral
                            currentChar = this.getChar()
                            let fracPart = 0
                            let divisor = 1
                            while(classify(currentChar) === CharType.number){
                                fracPart = fracPart * 10 + currentChar.charCodeAt(0) - 0x30
                                divisor *= 10
                                currentChar = this.getChar()
                            }
                            currentNum = currentNum + fracPart / divisor
                        }
                        // Handle scientific notation (e or E)
                        if(currentChar === "e" || currentChar === "E") {
                            currentToken.type = TokenType.DoubleLiteral
                            currentChar = this.getChar()
                            let exponentSign = 1
                            if(currentChar === "+" || currentChar === "-") {
                                if(currentChar === "-") {
                                    exponentSign = -1
                                }
                                currentChar = this.getChar()
                            }
                            if(classify(currentChar) !== CharType.number) {
                                throw new LexerError({
                                    type: LexerErrorType.invalidSyntax,
                                    message: "invalid scientific notation: expected digits after exponent",
                                    line: this.fileBuffer.getLineIndex(),
                                    column: this.fileBuffer.getColumnIndex()
                                })
                            }
                            let exponentNum = 0
                            while(classify(currentChar) === CharType.number){
                                exponentNum = exponentNum * 10 + currentChar.charCodeAt(0) - 0x30
                                currentChar = this.getChar()
                            }
                            currentNum = currentNum * (10 ** (exponentNum * exponentSign))
                        }
                        // Handle double/float suffixes (f/F for float, d/D for double)
                        if(currentChar === "f" || currentChar === "F") {
                            currentToken.type = TokenType.FloatLiteral
                            currentChar = this.getChar()
                        }
                        if(currentChar === "d" || currentChar === "D") {
                            currentToken.type = TokenType.DoubleLiteral
                            currentChar = this.getChar()
                        }
                        if(classify(currentChar) === CharType.alpha) {
                            throw new LexerError({
                                type: LexerErrorType.invalidSyntax,
                                message: "misshaped decimal notation: invalid character in decimal number",
                                line: this.fileBuffer.getLineIndex(),
                                column: this.fileBuffer.getColumnIndex()
                            })
                        }
                    }
                    currentToken.data = currentNum
                    tokens.push({...currentToken})
                    break
                }
            }
        }
        tokens.push({
            type: TokenType.EOF,
            line: -1,
            column: -1,
            data: 0
        })
        return tokens
    }

    findImports(): string[] {
        let imports: string[] = []
        while (true) {
            const importStartLineIndex = this.fileBuffer.getLineIndex()
            const importStartColIndex = this.fileBuffer.getColumnIndex()
            this.fileBuffer.skipWhitespace()
            if(this.fileBuffer.readNext("import ".length) !== "import "){
                break
            }
            this.fileBuffer.offsetOffset("import ".length)
            this.fileBuffer.skipWhitespace()
            if(this.fileBuffer.readNext("types ".length) === "types ") this.fileBuffer.offsetOffset("types ".length)
            this.fileBuffer.skipWhitespace()
            switch (this.peek()) {
                case "*": {
                    this.getChar()
                    this.fileBuffer.skipWhitespace()
                    break
                }
                case "{":{
                    this.getChar()
                    const startLindIndex = this.fileBuffer.getLineIndex()
                    const startColumnIndex = this.fileBuffer.getColumnIndex()
                    let currentChar = this.getChar()
                    while (currentChar !== '}'){
                        if(currentChar === '\0') {
                            throw new LexerError({
                                type: LexerErrorType.invalidSyntax,
                                message: "missing closing } in import syntax",
                                line: startLindIndex,
                                column: startColumnIndex,
                                filePath: this.path
                            })
                        }
                        currentChar = this.getChar()
                    }
                    this.getChar()
                    this.fileBuffer.skipWhitespace()
                    break
                }
                default: {
                    let currentChar = this.getChar()
                    while (classify(currentChar) === CharType.alpha) {
                        currentChar = this.getChar()
                    }
                    this.fileBuffer.skipWhitespace()
                }
            }
            if(this.fileBuffer.readNext("as ".length) === "as ") {
                this.fileBuffer.offsetOffset("as ".length)
                this.fileBuffer.skipWhitespace()
                let currentChar = this.getChar()
                while (classify(currentChar) === CharType.alpha) {
                    currentChar = this.getChar()
                }
                this.fileBuffer.skipWhitespace()
            }
            if(this.fileBuffer.readNext("from ".length) !== "from " ) {
                throw new LexerError({
                    type: LexerErrorType.invalidSyntax,
                    message: "invalid import syntax: expected \"from\"",
                    line: this.fileBuffer.getLineIndex(),
                    column: this.fileBuffer.getColumnIndex(),
                    filePath: this.path
                })
            }
            this.fileBuffer.offsetOffset("from ".length)
            this.fileBuffer.skipWhitespace()
            if(this.getChar() !== "\"") {
                throw new LexerError({
                    type: LexerErrorType.invalidSyntax,
                    message: "invalid import syntax: misformed or missing path string",
                    column: this.fileBuffer.getColumnIndex(),
                    line: this.fileBuffer.getLineIndex(),
                    filePath: this.path
                })
            }
            const startLineIndex = this.fileBuffer.getLineIndex()
            const startColIndex = this.fileBuffer.getColumnIndex()
            let currentChar: string
            let resolvedPath = ""
            while(true){
                currentChar = this.getChar()
                if(currentChar === "\"") break
                if(currentChar === "\0"){
                    throw new LexerError({
                        type: LexerErrorType.invalidSyntax,
                        message: "missing closing \" in path string",
                        line: startLineIndex,
                        column: startColIndex,
                        filePath: this.path
                    })
                }
                resolvedPath += currentChar
            }
            this.getChar()
            if(this.peek() === ";") this.getChar()
            const absolutePath = path.resolve(path.dirname(this.path), resolvedPath)
            if(DEFAULT_IMPORTS.has(resolvedPath)) continue
            if(!existsSync(absolutePath)) {
                console.log(absolutePath)
                throw new LexerError({
                    type: LexerErrorType.invalidImport,
                    message: "file does not exist",
                    line: importStartLineIndex,
                    column: importStartColIndex,
                    endLine: this.fileBuffer.getLineIndex(),
                    endColumn: this.fileBuffer.getColumnIndex(),
                    filePath: this.path
                })
            }
            imports.push(absolutePath)
        }
        this.fileBuffer.setOffset(0)
        return imports
    }
}
