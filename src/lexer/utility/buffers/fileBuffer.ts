import { BasicBuffer } from "./basicBuffer.ts"
import * as fs from "fs"
import {classify} from "../../helperFunctions.ts"
import {CharType, LexerError, LexerErrorType} from "../../lexerTypes.ts";
import {existsSync} from "node:fs";

export class FileBuffer {
    protected readonly path: string
    protected buffers: BasicBuffer[] = []
    protected readonly bufferCount
    protected offset: number = 0
    protected readonly size: number
    protected currentBuffer: number = 0
    protected iteration: number
    protected readonly fileDescriptor: number
    protected lineIndex: number = 1
    protected columnIndex: number = 1
    protected preparedBuffer = true

     constructor(path: string, size: number = 32768, bufferCount: number = 2) {
         if(!existsSync(path)) {
             console.log(path)
             throw new LexerError({
                 type: LexerErrorType.invalidImport,
                 message: "main file does not exist",
                 filePath: path
             })
         }
         this.size = size
         this.path = path
         this.bufferCount = bufferCount
         this.iteration = bufferCount
         this.fileDescriptor = fs.openSync(path, 'r')
         for (let index = 0; index < bufferCount; index++) {
             const buffer = new BasicBuffer(size, this.fileDescriptor)
             buffer.fillBuffer(index * size)
             this.buffers.push(buffer)
         }
         console.log(path)
     }

     setOffset(newOffset: number) {
        this.offset = newOffset
     }

     getLineIndex(): number {
        return this.lineIndex
     }

     getColumnIndex(): number {
        return this.columnIndex
     }

    peek(): string {
        if(this.offset === this.size) this.nextBuffer()
        if(!this.preparedBuffer && this.offset >= this.size/2) this.prepareLastBuffer()
        return this.readChar(this.offset)
    }

    getChar(): string{
        if(this.offset === this.size) this.nextBuffer()
        if(!this.preparedBuffer && this.offset >= this.size/2) this.prepareLastBuffer()
        const currentChar = this.readChar(this.offset++)
        this.columnIndex++
        if(currentChar === '\n'){
            this.lineIndex++
            this.columnIndex = 0
        } else if(currentChar === '\r'){
            return this.getChar()
        }
        return currentChar
    }

    readChar(offset: number): string{
        return this.buffers[this.currentBuffer].readChar(offset)
    }

    skipWhitespace() {
        while (classify(this.peek()) === CharType.whitespace) {
            this.getChar()
        }
    }

    readNext(length: number): string{
        const remaining: number = this.size - this.offset
        let text = ""
        if(length > remaining){
            text += this.buffers[this.currentBuffer].read(this.offset, remaining).toString("utf8")
            let nextBufferIndex:number
            if(this.currentBuffer === this.bufferCount - 1) nextBufferIndex = 0
            else nextBufferIndex = this.currentBuffer + 1
            text += this.buffers[nextBufferIndex].read(0, length - remaining).toString("utf8")
        } else {
            text += this.buffers[this.currentBuffer].read(this.offset, length).toString("utf8")
        }
        return text
    }

    offsetOffset(offset: number): number{
        for (let i = offset; i > 0; i--) {
            this.getChar()
        }
        return this.offset
    }

    nextBuffer(){
        if(this.currentBuffer === this.bufferCount - 1) this.currentBuffer = 0
        else this.currentBuffer++
        this.offset = 0
        this.iteration++
        this.preparedBuffer = false
    }

    prepareLastBuffer() {
        this.buffers[(this.currentBuffer + this.bufferCount - 1) % this.bufferCount].fillBuffer((this.iteration + 1) * this.size)
        this.preparedBuffer = true
    }

    dumpBuffer(){
        return this.buffers
    }
}