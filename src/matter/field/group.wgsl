// Bind group 3 as the field shares it: the bodies' four bindings (matter/core/body.wgsl) and the field's three
// (field.wgsl). field.ts hands this file to kit.shareGroup(3, …), so every shader that includes either file is served
// by the same group. Nothing here but the two includes.
#include "../core/body"
#include "./field"
