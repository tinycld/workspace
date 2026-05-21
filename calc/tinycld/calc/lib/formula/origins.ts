// FORMULA_ORIGIN tags Y.Doc transactions that originate from the
// formula bridge writing back computed results. Two consumers care:
//
//   1. The realtime undo manager allowlists LOCAL_ORIGIN; tagging
//      writebacks with anything else keeps recomputed values out of
//      undo history. Undoing a user edit rewinds the user edit; the
//      bridge then re-computes and the result reappears on its own.
//
//   2. The bridge's own observeDeep callback skips events whose
//      transaction origin === FORMULA_ORIGIN, so HF -> Y.Doc writeback
//      doesn't loop back into HF.
export const FORMULA_ORIGIN = Symbol('calc.formula')
