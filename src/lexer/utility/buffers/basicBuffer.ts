import { readSync } from "fs"

export class BasicBuffer {
    readonly size: number
    private buffer: Buffer
    private readonly fileDescriptor: number

    constructor(size: number, fileDescriptor: number) {
        this.size = size
        this.buffer = Buffer.alloc(size)
        this.fileDescriptor = fileDescriptor
    }

    fillBuffer(offset: number = 0) {
        const bytesRead = readSync(this.fileDescriptor, this.buffer, 0, this.size, offset)
        if(bytesRead < this.size) {
            this.buffer.fill("\0", bytesRead, this.size)
        }
    }

    read(position: number = 0, size: number = 0) {
        return this.buffer.subarray(position, position + size)
    }

    readChar(position: number = 0) {
        return String.fromCharCode(this.buffer[position])
    }
}