import {CharType, TokenType} from "./lexerTypes.ts";
import {classifyCharByNumber, isHexNum, isOctNum} from "./helperFunctions.ts";

export const CLASSIFICATION_TABLE: CharType[] = [... Array(256)]. map((_, index) => classifyCharByNumber(index))

export const DEFAULT_IMPORTS: Set<string> = new Set(["web utilities", "fs", "node:path", "node:fs"])

export const KEYWORDS_MAP = new Map<string, TokenType>([
    ["fn", TokenType.Fn],
    ["func", TokenType.Fn],
    ["function", TokenType.Fn],
    ["let", TokenType.Let],
    ["if", TokenType.If],
    ["else", TokenType.Else],
    ["import", TokenType.Import],
    ["export", TokenType.Export],
    ["async", TokenType.Async],
    ["const", TokenType.Const],
    ["enum", TokenType.Enum],
    ["struct", TokenType.Struct],
    ["class", TokenType.Class],
    ["interface", TokenType.Interface],
    ["group", TokenType.Group],
    ["extends", TokenType.Extends],
    ["mixin", TokenType.Mixin],
    ["implements", TokenType.Implements],
    ["owns", TokenType.Owns],
    ["serves", TokenType.Serves],
    ["init", TokenType.Init],
    ["public", TokenType.Public],
    ["private", TokenType.Private],
    ["static", TokenType.Static],
    ["override", TokenType.Override],
    ["protected", TokenType.Protected],
    ["switch", TokenType.Switch],
    ["case", TokenType.Case],
    ["default", TokenType.Default],
    ["for", TokenType.For],
    ["while", TokenType.While],
    ["loop", TokenType.Loop],
    ["break", TokenType.Break],
    ["continue", TokenType.Continue],
    ["return", TokenType.Return],
    ["new", TokenType.New],
    ["typeof", TokenType.Typeof],
    ["await", TokenType.Await],
    ["sizeof", TokenType.Sizeof],
    ["delete", TokenType.Delete],
    ["throw", TokenType.Throw],
    ["try", TokenType.Try],
    ["catch", TokenType.Catch],
    ["finally", TokenType.Finally],
])


export const IS_HEX_NUM_TABLE: boolean[] = [...Array(128)].map((_, index) => isHexNum(String.fromCharCode(index)))
export const IS_OCTAL_NUM_TABLE: boolean[] = [...Array(128)].map((_, index) => isOctNum(String.fromCharCode(index)))