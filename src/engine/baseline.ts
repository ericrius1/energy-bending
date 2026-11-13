// WebGPU's default limits: what a device gets when it asks for nothing more, and what plenty of phones and laptops
// have exactly. weft's createKit raises a list of limits to whatever the adapter offers; `?baseline` hands it these
// instead (each is capped to the adapter, so asking for the default gets the default), so this PC's RTX 5090 runs the
// game with a phone's budget and anything over it fails here first. scripts/check-bindings.mjs counts every shader
// stage against the per-stage numbers without a GPU (npm test).
// The values are the WebGPU spec's defaults (https://www.w3.org/TR/webgpu/#limit-default).

/** the limits weft would raise (its LIMITS list), at their defaults */
export const BASELINE_LIMITS: Record<string, number> = {
  maxStorageBufferBindingSize: 134217728,
  maxBufferSize: 268435456,
  maxComputeWorkgroupStorageSize: 16384,
  maxStorageBuffersPerShaderStage: 8,
  maxStorageTexturesPerShaderStage: 4,
  maxSampledTexturesPerShaderStage: 16,
  maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupSizeX: 256,
  maxComputeWorkgroupSizeY: 256,
  maxColorAttachmentBytesPerSample: 32,
  maxTextureArrayLayers: 256,
  maxTextureDimension2D: 8192,
};

/** the per-stage and per-pipeline defaults the shaders are counted against (weft never raises these) */
export const BASELINE_STAGE = {
  uniform: 12,
  storage: 8,
  texture: 16,
  storageTexture: 4,
  sampler: 16,
  groups: 4,
  uniformBytes: 65536,
} as const;
