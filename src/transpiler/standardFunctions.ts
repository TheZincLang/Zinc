// Maps Zinc built-in function names to their C equivalents.
// The emitter looks up a call target here; if found, substitutes the C name.
// Headers required by these functions are emitted unconditionally at the top of every file:
//   #include <stdio.h>   — printf, scanf, fgets, fflush
//   #include <stdlib.h>  — exit, malloc, free, atoi, atof, rand, srand
//   #include <math.h>    — sqrt, pow, fabs, floor, ceil, round, fmod  (link with -lm)
//   #include <string.h>  — strlen, strcmp, strcpy, strcat, strncpy, strncmp
//   #include <stdint.h>  — fixed-width integer types (always included)
//   #include <stdbool.h> — bool (always included)

export const standardFunctions = new Map<string, string>([
    // I/O
    ["print",   "printf"],
    ["println", "printf"],   // emitter appends "\n" to the format string
    ["eprint",  "fprintf"],  // emitter prepends stderr as first arg
    ["scan",    "scanf"],

    // process
    ["exit",    "exit"],

    // math  (requires -lm at link time)
    ["sqrt",    "sqrt"],
    ["pow",     "pow"],
    ["abs",     "fabs"],     // use fabs; emitter can specialize to abs for integers
    ["floor",   "floor"],
    ["ceil",    "ceil"],
    ["round",   "round"],
    ["mod",     "fmod"],
    ["log",     "log"],
    ["log2",    "log2"],
    ["log10",   "log10"],
    ["sin",     "sin"],
    ["cos",     "cos"],
    ["tan",     "tan"],

    // memory
    ["malloc",  "malloc"],
    ["free",    "free"],

    // strings
    ["strlen",  "strlen"],
    ["strcmp",  "strcmp"],
    ["strcpy",  "strcpy"],
    ["strcat",  "strcat"],

    // random
    ["rand",    "rand"],
    ["srand",   "srand"],
])
