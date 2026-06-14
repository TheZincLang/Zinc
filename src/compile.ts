import {FileManager} from "./file/fileManager/fileManager.ts";
import {printAST} from "./parser/prettyPrinter.ts";
import {BugError, BugErrorType} from "./global/types/globalTypes.ts";

export function compile(path: string) {
    const files: Map<string, FileManager> = new Map()
    let uncheckedFiles = new Set<string>([path])
    while(uncheckedFiles.size !== 0) {
        const discoveredFiles: Set<string> = new Set()
        for(const uncheckedFile of uncheckedFiles.values()) {
            if(!files.has(uncheckedFile)) {
                const fileManager: FileManager = new FileManager(uncheckedFile)
                files.set(uncheckedFile, fileManager)
                fileManager.lexer.findImports().forEach((newFile: string) => {
                    if(!discoveredFiles.has(newFile)) {
                        discoveredFiles.add(newFile)
                    }
                })
            }
        }
        uncheckedFiles = discoveredFiles
    }
    for(const fileManager of files.values()) {
        fileManager.buildAST()
        if(!fileManager.astTree) {
            throw new BugError({
                type: BugErrorType.reachedUnwantedState,
                message: "buildAST() did not produce an AST",

            })
        }
        printAST(fileManager.astTree, {symbolTable: fileManager.parser?.getSymbolTable()})
    }
}
