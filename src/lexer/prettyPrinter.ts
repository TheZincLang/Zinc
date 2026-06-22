import { PrettyToken } from "./lexerTypes.ts" // adjust path

const RESET  = "\x1b[0m"
const DIM    = "\x1b[2m"
const BOLD   = "\x1b[1m"

const TYPE_COLORS: Partial<Record<string, string>> = {
    // literals
    IntLiteral:     "\x1b[33m", // yellow
    FloatLiteral:   "\x1b[33m",
    DoubleLiteral:  "\x1b[33m",
    BoolLiteral:    "\x1b[33m",
    StringLiteral:  "\x1b[32m", // green
    CharLiteral:    "\x1b[32m",
    StringTemplate: "\x1b[32m",
    // identifiers
    Identifier:     "\x1b[36m", // cyan
    // keywords (smallerThan..biggerThan range)
    Fn: "\x1b[35m", Let: "\x1b[35m", Const: "\x1b[35m",
    Enum: "\x1b[35m", Async: "\x1b[35m", If: "\x1b[35m",
    Else: "\x1b[35m", Import: "\x1b[35m", Export: "\x1b[35m",
    Struct: "\x1b[35m", Class: "\x1b[35m",
    Interface: "\x1b[35m", Group: "\x1b[35m",
    // meta
    SOF:     "\x1b[2m",
    EOF:     "\x1b[2m",
    Newline: "\x1b[2m",
    Invalid: "\x1b[31m", // red
}

export function printTokens(
    tokens: PrettyToken[],
    opts: {
        hideNewlines?: boolean
        hideSOFEOF?:   boolean
        filter?:       (t: PrettyToken) => boolean
        label?:        string
    } = {}
) {
    const { hideNewlines = true, hideSOFEOF = true, filter, label } = opts

    const filtered = tokens.filter(t => {
        if (hideNewlines && t.type === "Newline") return false
        if (hideSOFEOF  && (t.type === "SOF" || t.type === "EOF")) return false
        return !(filter && !filter(t));

    })

    if (label) console.log(`\n${BOLD}── ${label} ──${RESET}`)

    const maxType = Math.max(...filtered.map(t => t.type.length), 4)
    const maxData = Math.max(...filtered.map(t => t.data.length), 4)

    // header
    console.log(
        DIM +
        "idx".padEnd(5) +
        "type".padEnd(maxType + 2) +
        "data".padEnd(maxData + 2) +
        "line".padEnd(6) +
        "col" +
        RESET
    )

    tokens.forEach((t, i) => {
        const color = TYPE_COLORS[t.type] ?? "\x1b[37m"
        const idx   = String(i).padEnd(5)
        const type  = (color + t.type + RESET).padEnd(maxType + 2 + color.length + RESET.length)
        const data  = t.data.padEnd(maxData + 2)
        const line  = String(t.line).padEnd(6)
        const col   = String(t.column)
        console.log(DIM + idx + RESET + type + data + DIM + line + col + RESET)
    })

    console.log(DIM + `\n${filtered.length} tokens` + (tokens.length !== filtered.length ? ` (${tokens.length - filtered.length} hidden)` : "") + RESET)
}