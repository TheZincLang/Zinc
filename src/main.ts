import {compile} from "./compile.ts";
import {fileURLToPath} from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url))
compile(path.resolve(__dirname, "../testFiles/main.zn"))