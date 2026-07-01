import {Lexer} from "../../lexer/lexer.ts"
import {Parser} from "../../parser/parser.ts";
import {BugError, BugErrorType} from "../../global/types/globalTypes.ts";
import {Node, Program} from "../../parser/ParserTypes.ts";
import {Token} from "../../lexer/lexerTypes.ts";
import {printTokens} from "../../lexer/prettyPrinter.ts";
import {makePretty} from "../../lexer/helperFunctions.ts";

export class FileManager {
    path: string
    lexer: Lexer
    parser: Parser | null = null
    tokens: Token[] = []
    astTree: Program | null = null
    exports: Node[] = []
    // Resolved by compile.ts once every file's AST has been built — the
    // FileManagers this file's `import ... from "..."` statements point to.
    importedFiles: FileManager[] = []

    constructor(path: string) {
        this.path = path
        this.lexer = new Lexer(this)
    }

    lexFile(){
        this.tokens = this.lexer.lexFile()
    }

    initializeParser(){
        this.parser = new Parser(this)
    }

    parseFile(){
        if(!this.parser){
            throw new BugError({
                type: BugErrorType.reachedUnwantedState,
                message: "called parseFile() before Parser was initialized"
            })
        }
        this.parser.parseFile()
        this.astTree = this.parser.getProgram()
    }

    buildAST(){
        this.lexFile()
        printTokens(this.tokens.map((token) => {
            return makePretty(token, this.lexer.getIdentifierMap(), this.lexer.getStringLiteralMap())
        }))
        this.initializeParser()
        this.parseFile()
    }
}