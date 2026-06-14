export enum CharType {
    alpha,
    number,
    punctuation,
    stringIndicator,
    operator,
    structure,
    whitespace,
    ignored,
    terminator,
    //other stuff
    OtherStuff,
}

export interface LexerErrorOptions {
    type: LexerErrorType
    message?: string
    line?: number
    column?: number
    range?: number
    endLine?: number
    endColumn?: number
    filePath?: string
    thrownFromFile?: string
    thrownFromLine?: number
}

export enum LexerErrorType {
    invalidImport,
    invalidSyntax,
    unknownIdentifier
}


export class LexerError implements LexerErrorOptions {
    type: LexerErrorType
    message: string
    line: number
    column: number
    endLine: number
    endColumn: number
    filePath?: string
    thrownFromFile?: string
    thrownFromLine?: number

    constructor({type, message, line, column, endLine, endColumn, filePath, thrownFromLine, thrownFromFile}: LexerErrorOptions) {
        this.type = type
        this.message = message ?? "no message provided"
        this.filePath = filePath ?? "no path provided"
        this.line = line ?? -1
        this.column = column ?? -1
        this.endLine = endLine ?? -1
        this.endColumn = endColumn ?? -1
        this.thrownFromFile = thrownFromFile ?? "no file provided"
        this.thrownFromLine = thrownFromLine ?? -1
    }
}

export enum TokenType {
    //debug
    debug,

    // Literals
    IntLiteral,
    FloatLiteral,
    DoubleLiteral,
    StringLiteral,
    CharLiteral,
    StringTemplate,
    BoolLiteral,

    // Identifiers & keywords
    Identifier,
    smallerThanAllKeywords,
    Fn,
    Let,
    Const,
    Enum,
    Async,
    If,
    Else,
    Import,
    Export,
    Switch,
    Case,
    Default,
    For,
    biggerThanAllKeywords,
    // ...

    // Operators
    Plus,
    Increment,
    AddAssign,
    Minus,
    Decrement,
    SubAssign,
    Arrow,
    Star,
    Exponentiation,
    MulAssign,
    ExpAssign,
    Slash,
    DivAssign,
    Modulo,
    ModAssign,
    Assign,
    Equal,
    FatArrow,
    LessThan,
    LessThanOrEqual,
    ShiftLeft,
    ShiftLeftAssign,
    MoreThan,
    MoreThanOrEqual,
    ShiftRight,
    ShiftRightAssign,
    Not,
    NotEqual,
    Ampersand,
    BitAndAssign,
    And,
    AndAssign,
    Pipe,
    BitOrAssign,
    Or,
    OrAssign,
    Caret,
    BitXorAssign,
    Tilde,
    Question,
    Colon,
    DoubleColon,
    DollarSign,
    Range,
    Spread,

    //structure
    Newline,

    // Punctuation
    LBrace,
    RBrace,
    LParen,
    RParen,
    StackOpen,
    StackClose,
    Semicolon,
    Comma,
    Dot,
    Octothorpe,
    At,
    Backslash,
    Backtick,

    //functional stuff
    StringTemplateStart,
    StringTemplateEnd,

    //other stuff
    OtherStuff,

    // Meta
    SOF,
    EOF,
    Invalid,
}

export interface Token {
    type: TokenType
    data: number
    line: number
    column: number
}

export interface PrettyToken {
    type: string
    data: string
    line: number
    column: number
}

export class ScopeExitOperation {
    raw: number = 0

    setOperation(operation: ScopeExitOperations) {
        if(operation === ScopeExitOperations.none) return
        this.raw |= (1 << operation - 1)
    }

    hasOperation(operation: ScopeExitOperations): boolean {
        return (this.raw & (1 << operation)) !== 0
    }

    clearOperation(operation: ScopeExitOperations) {
        this.raw &= ~(1 << operation)
    }

    isNoOp(): boolean{
        return this.raw === 0
    }

    constructor(operation: ScopeExitOperations) {
        this.setOperation(operation)
    }
}

export enum ScopeExitOperations {
    none,
    closeStringTemplate
}