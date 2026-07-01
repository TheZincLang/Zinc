import path from "node:path"
import {FileManager} from "./file/fileManager/fileManager.ts";
import {printAST} from "./parser/prettyPrinter.ts";
import {BugError, BugErrorType} from "./global/types/globalTypes.ts";
import {CEmitter, compileAndRunMulti} from "./transpiler/cgen.ts";
import {NodeType} from "./parser/ParserTypes.ts";
import {DEFAULT_IMPORTS} from "./lexer/const.ts";

/** Resolves an `import ... from "path"` to the absolute path of the file it
 *  points at, or `null` for built-in/host imports that don't have one. */
function resolveImportPath(fileManager: FileManager, importPath: number): string | null {
    const rawPath = fileManager.lexer.getSymbolTable().strings?.get(importPath)
    if (rawPath === undefined) {
        throw new BugError({type: BugErrorType.reachedUnwantedState, message: "import path is not an interned string"})
    }
    if (DEFAULT_IMPORTS.has(rawPath)) return null
    return path.resolve(path.dirname(fileManager.path), rawPath)
}

export function compile(entryPath: string) {
    const files: Map<string, FileManager> = new Map()
    let uncheckedFiles = new Set<string>([entryPath])
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

    // Every file's AST (and therefore its `exports` list) exists now, so
    // imports can be resolved to the FileManager they point at. This has to
    // happen as its own pass after the loop above — a file's imports can't
    // be resolved against a target that hasn't been parsed yet.
    for(const fileManager of files.values()) {
        for (const node of fileManager.astTree!.children) {
            if (node.type !== NodeType.ImportNode) continue
            const resolved = resolveImportPath(fileManager, node.data.path)
            if (resolved === null) continue // built-in/host import — no file behind it
            const target = files.get(resolved)
            if (!target) {
                throw new BugError({
                    type: BugErrorType.reachedUnwantedState,
                    message: `import target was not discovered during file discovery: ${resolved}`,
                })
            }
            fileManager.importedFiles.push(target)
        }
    }

    const outputs = [...files.values()].map(fileManager => {
        const emitter = new CEmitter(fileManager)
        return {
            path: fileManager.path,
            cSource: emitter.emitBody(fileManager.astTree!),
            hSource: emitter.emitHeader(fileManager.astTree!),
        }
    })
    compileAndRunMulti(outputs)
}
