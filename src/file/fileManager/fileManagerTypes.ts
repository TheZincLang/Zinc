export interface Import {
    importType: ImportType

}

export enum ImportType {
    function,
    class,
    variable,
    constant,
    enum,
    type,

}