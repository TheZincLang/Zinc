import {CharType, PrettyToken, Token, TokenType} from "./lexerTypes.ts";
import {CLASSIFICATION_TABLE, IS_HEX_NUM_TABLE, IS_OCTAL_NUM_TABLE} from "./const.ts";

export function classifyCharByNumber(charNumber: number): CharType {

    if(charNumber >= 128) return CharType.OtherStuff

    const ch = String.fromCharCode(charNumber)
    if (/\p{L}/u.test(ch) || ch === '_')                    return CharType.alpha
    if (/\p{N}/u.test(ch))                                  return CharType.number
    if (/\p{Z}|\t|\n/u.test(ch))                            return CharType.whitespace
    if (/["'`]/u.test(ch))                                   return CharType.stringIndicator
    if(/\0/u.test(ch))                                      return CharType.terminator
    if (/[\r\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u.test(ch))     return CharType.ignored
    if (/[+\-*/ %=<>!&|^~?:$]/u.test(ch))                   return CharType.operator
    if (/[()\[\]{}]/u.test(ch))                             return CharType.structure
    return CharType.punctuation
}

export function classify(char: string): CharType {
    return CLASSIFICATION_TABLE[char.charCodeAt(0)]
}

export function hexVal(c: number): number {
    if (c >= 0x30 && c <= 0x39) return c - 0x30;
    if (c >= 0x41 && c <= 0x46) return c - 55;
    if (c >= 0x61 && c <= 0x66) return c - 87;
    return -1;
}

export function isHexNum(char: string): boolean {
    return (/[0-9A-Fa-f]/u.test(char))
}

export function checkIfHexDigit(char: string): boolean {
    return IS_HEX_NUM_TABLE[char.charCodeAt(0)]
}

export function isOctNum(char: string): boolean{
    return (/[0-7]/u.test(char))
}

export function checkIfOctDigit(char: string): boolean {
    return IS_OCTAL_NUM_TABLE[char.charCodeAt(0)]
}

export function makePretty(token: Token, identifierMap: Map<string, number>, stringLiteralMap: Map<string, number>): PrettyToken {
    let data: string
    if (token.type < TokenType.StringLiteral) {
        data = String(token.data)
    } else if(token.type === TokenType.StringTemplate){
        data = [...stringLiteralMap.entries()].find(([_, v]) => v === token.data)?.[0] ?? `<unknown string ${token.data}>`
    } else if (token.type === TokenType.CharLiteral) {
        data = String.fromCharCode(token.data)
    } else  if (token.type == TokenType.StringLiteral) {
        data = [...stringLiteralMap.entries()].find(([_, v]) => v === token.data)?.[0] ?? `<unknown string ${token.data}>`
    } else if (token.type == TokenType.Identifier) {
        data = [...identifierMap.entries()].find(([_, v]) => v === token.data)?.[0] ?? `<unknown identifier ${token.data}>`
    } else {
        data = String(token.data)
    }
    return {
        type: TokenType[token.type],
        data,
        line: token.line,
        column: token.column
    }
}

