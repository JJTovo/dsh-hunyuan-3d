/**
 * Raw JSON Schema declarations for the two agent tools.
 *
 * dsh's `defineTool` compiles its schema DSL into exactly this wire format, so a
 * plugin that registers a raw definition must hand-build it: `required` is an
 * array on the enclosing object, never a boolean on the property.
 */

/** Result file entry shared by both tools. */
const fileSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string', description: 'File format reported by the service (OBJ, GLB, STL, USDZ, FBX, MP4).' },
    path: { type: 'string', description: 'Absolute path of the downloaded file.' },
    bytes: { type: 'integer', description: 'Downloaded size in bytes.' },
    source_url: { type: 'string', description: 'Service URL the file was fetched from (valid 24 hours after generation).' },
    preview_image_url: { type: 'string', description: 'Service URL of the rendered preview image.' },
  },
  required: ['path', 'bytes'],
}

/** Canonical result both tools return. */
export const resultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    job_id: { type: 'string', description: 'Hunyuan 3D JobId.' },
    mode: { type: 'string', description: 'The ai3d endpoint family that owns the job: pro or rapid.' },
    status: { type: 'string', description: 'WAIT, RUN, FAIL or DONE.' },
    message: { type: 'string', description: 'Human-readable next step.' },
    request_id: { type: 'string', description: 'Tencent Cloud RequestId, for support tickets.' },
    error_code: { type: 'string', description: 'Service error code when the job failed.' },
    error_message: { type: 'string', description: 'Service error message when the job failed.' },
    credits_consumed: { type: 'number', description: 'Credits billed by the service.' },
    credit_details: { type: 'string', description: 'Per-feature credit breakdown.' },
    result_directory: { type: 'string', description: 'Directory holding the downloaded files.' },
    concurrency: {
      type: 'object',
      additionalProperties: false,
      description: 'Service slots this call left occupied.',
      properties: {
        active: { type: 'integer', description: 'Jobs currently holding a service slot.' },
        queued: { type: 'integer', description: 'Calls waiting for a slot.' },
        maxConcurrency: { type: 'integer', description: 'Configured slot limit.' },
      },
      required: ['active', 'queued', 'maxConcurrency'],
    },
    files: { type: 'array', description: 'Downloaded assets.', items: fileSchema },
  },
  required: ['job_id', 'mode', 'status', 'message', 'files'],
}

/** `hunyuan_3d_model` parameters, compiled to the implicit open object root. */
export const modelParameters = {
  type: 'object',
  properties: {
    prompt: { type: 'string', description: 'Chinese or English description of the object to model (max 1024 UTF-8 characters).' },
    mode: { type: 'string', description: '"pro" (default: 3.0/3.1 models, multiview, face-count control) or "rapid" (fast draft).' },
    model: { type: 'string', description: 'Pro model version: "3.0" (default) or "3.1".' },
    generate_type: { type: 'string', description: 'Pro generation type: Normal (default, textured), LowPoly (decimated), Geometry (white model), Sketch (from a drawing).' },
    image_url: { type: 'string', description: 'Reference image URL (jpg/png/jpeg/webp, 128-5000 px per side, <= 8 MB) for image-to-3D.' },
    image_base64: { type: 'string', description: 'Reference image as base64 (a data URL prefix is accepted) for image-to-3D.' },
    image_path: { type: 'string', description: 'Local reference image path, read and inlined by the plugin. Use this to feed back an asset generated earlier.' },
    multi_view_images: {
      type: 'array',
      description: 'Pro-only multi-view reference images; each entry needs view_type and exactly one image source.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          view_type: { type: 'string', description: 'left, right, back, top, bottom, left_front or right_front (top/bottom/45-degree views need model 3.1).' },
          image_url: { type: 'string', description: 'View image URL.' },
          image_base64: { type: 'string', description: 'View image base64.' },
        },
        required: ['view_type'],
      },
    },
    enable_pbr: { type: 'boolean', description: 'Generate PBR materials. Defaults to the service default (false).' },
    enable_geometry: { type: 'boolean', description: 'Rapid mode only: also keep the untextured geometry.' },
    face_count: { type: 'integer', description: 'Pro mode target face count, 3000-1500000 (default 500000). Ignored by LowPoly.' },
    polygon_type: { type: 'string', description: 'Pro LowPoly only: "triangle" (default) or "quadrilateral".' },
    result_format: { type: 'string', description: 'Preferred output format: OBJ, GLB, STL, USDZ, FBX or MP4. Defaults to OBJ plus GLB.' },
    wait: { type: 'boolean', description: 'Poll until the job finishes and download the assets. Defaults to true; set false to return the job_id immediately.' },
    timeout_ms: { type: 'integer', description: 'Maximum time to wait for completion; default 900000 ms, cap 3600000 ms.' },
  },
}

/** `hunyuan_3d_query` parameters, compiled to the implicit open object root. */
export const queryParameters = {
  type: 'object',
  properties: {
    job_id: { type: 'string', description: 'JobId returned by hunyuan_3d_model.' },
    mode: { type: 'string', description: 'The mode the job was submitted with: "pro" (default) or "rapid".' },
    download: { type: 'boolean', description: 'Download finished assets to disk. Defaults to true.' },
    wait: { type: 'boolean', description: 'Poll until the job finishes before returning. Defaults to false, which reports the current status immediately.' },
    timeout_ms: { type: 'integer', description: 'Maximum time to wait when wait is true; default 900000 ms, cap 3600000 ms.' },
  },
  required: ['job_id'],
}
