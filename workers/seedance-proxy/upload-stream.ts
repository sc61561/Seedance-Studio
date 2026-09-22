import { normalizeGenerationRequest } from "../../src/lib/video/normalize-generation";
import { imageRole, VideoProviderError } from "../../src/lib/video/providers/seedance-core";
import { acceptedReferenceImageTypes, maxReferenceImages } from "../../src/lib/video/reference-image-limits";
import {
  maxWorkerImageBytes, maxWorkerTotalImageBytes, maxWorkerMetadataBytes,
  type UploadImageDescriptor,
} from "../../src/lib/video/worker-upload";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

// Holds only the current network chunk. No request.json(), whole-image decode,
// string concatenation or unbounded tee() of the uploaded image stream.
class UploadReader {
  private chunk: Uint8Array = new Uint8Array(0);
  private offset = 0;
  private onAbort = () => { void this.cancel(); };
  constructor(private reader: ReadableStreamDefaultReader<Uint8Array>, private signal?: AbortSignal) {
    signal?.addEventListener("abort", this.onAbort, { once: true });
    if (signal?.aborted) this.onAbort();
  }

  async take(max: number): Promise<Uint8Array> {
    while (this.offset === this.chunk.length) {
      const next = await this.reader.read();
      if (next.done) return new Uint8Array(0);
      this.chunk = next.value;
      this.offset = 0;
    }
    const part = this.chunk.subarray(this.offset, this.offset + max);
    this.offset += part.length;
    return part;
  }

  async exact(length: number): Promise<Uint8Array> {
    const result = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      const part = await this.take(length - offset);
      if (!part.length) fail("api.refInvalidFormat");
      result.set(part, offset); offset += part.length;
    }
    return result;
  }

  async header(): Promise<Record<string, unknown>> {
    const bytes = new Uint8Array(maxWorkerMetadataBytes + 1);
    let length = 0;
    // Scan bounded chunks, avoiding thousands of promises for a long prompt.
    while (length <= maxWorkerMetadataBytes) {
      const part = await this.take(bytes.length - length);
      if (!part.length) fail("api.invalidRequest");
      const newline = part.indexOf(10);
      if (newline >= 0) {
        bytes.set(part.subarray(0, newline), length);
        this.offset -= part.length - newline - 1;
        try {
          const value: unknown = JSON.parse(decoder.decode(bytes.subarray(0, length + newline)));
          if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
        } catch { /* return a stable error without reflecting submitted data */ }
        fail("api.invalidRequest");
      }
      bytes.set(part, length);
      length += part.length;
    }
    return fail("api.requestTooLarge", 413);
  }

  async cancel() {
    this.signal?.removeEventListener("abort", this.onAbort);
    try { await this.reader.cancel(); } catch { /* best effort */ }
  }
}

function fail(code: string, status = 400): never {
  throw new VideoProviderError(code, status);
}

function descriptors(value: unknown): UploadImageDescriptor[] {
  if (!Array.isArray(value) || value.length === 0) fail("api.refInvalidFormat");
  if (value.length > maxReferenceImages) throw new VideoProviderError("api.refTooMany", 400, { n: maxReferenceImages });
  let total = 0;
  return value.map((image) => {
    if (!image || typeof image !== "object" || typeof image.mimeType !== "string"
      || !acceptedReferenceImageTypes.has(image.mimeType)) fail("api.refUnsupportedType");
    if (!Number.isSafeInteger(image.byteLength) || image.byteLength <= 0) fail("api.refInvalidFormat");
    if (image.byteLength > maxWorkerImageBytes) fail("api.refTooLargeSingle");
    total += image.byteLength;
    if (total > maxWorkerTotalImageBytes) fail("api.refTooLargeTotal");
    return { mimeType: image.mimeType, byteLength: image.byteLength };
  });
}

function checkSignature(mime: string, base64: string) {
  let decoded: string;
  try { decoded = atob(base64); } catch { return fail("api.refInvalidFormat"); }
  const matches = mime === "image/png" ? decoded.startsWith("\x89PNG\r\n\x1a\n")
    : mime === "image/jpeg" ? decoded.startsWith("\xff\xd8\xff")
      : decoded.startsWith("RIFF") && decoded.slice(8, 12) === "WEBP";
  if (!matches) fail("api.refInvalidContent");
}

function validatePart(bytes: Uint8Array, final: boolean, imageSize: number) {
  const text = decoder.decode(bytes);
  if (!final) {
    if (!/^[A-Za-z0-9+/]+$/.test(text)) fail("api.refInvalidFormat");
    return text;
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) fail("api.refInvalidFormat");
  const expectedPadding = (3 - imageSize % 3) % 3;
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  if (padding !== expectedPadding) fail("api.refInvalidFormat");
  try { if (btoa(atob(text)) !== text) fail("api.refInvalidFormat"); }
  catch { fail("api.refInvalidFormat"); }
  return text;
}

export async function prepareUpload(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  const reader = new UploadReader(body.getReader(), signal);
  try {
    const metadata = await reader.header();
    if (metadata.version !== 1) fail("api.invalidRequest");
    const images = descriptors(metadata.images);
    // The same model/mode/parameter validator as the Next.js route, with only
    // the already-validated image count represented here. No URL is fetched.
    const normalized = normalizeGenerationRequest(metadata, images.map(() => "https://reference.invalid/image"));
    if ("error" in normalized) {
      throw new VideoProviderError(normalized.error.code, 400, normalized.error.params);
    }
    const input = normalized.value;
    const prefix = JSON.stringify({
      model: input.target.model, ratio: input.aspectRatio, resolution: input.resolution,
      duration: input.duration, generate_audio: input.generateAudio,
    }).slice(0, -1) + ',"content":[' + JSON.stringify({ type: "text", text: input.prompt });
    const openers = images.map((image) => ',{"type":"image_url","image_url":{"url":"data:' + image.mimeType + ';base64,');
    const closers = images.map((_, index) => '"},"role":' + JSON.stringify(imageRole(input.generationMode, index)) + '}');
    const byteLength = encoder.encode(prefix + openers.join("") + closers.join("") + "]}").length
      + images.reduce((sum, image) => sum + Math.ceil(image.byteLength / 3) * 4, 0);
    let streamError: unknown;
    let complete = false;
    async function* chunks() {
      try {
        yield encoder.encode(prefix);
        for (let index = 0; index < images.length; index++) {
          const image = images[index];
          let remaining = Math.ceil(image.byteLength / 3) * 4;
          const first = await reader.exact(Math.min(16, remaining));
          const firstText = validatePart(first, first.length === remaining, image.byteLength);
          checkSignature(image.mimeType, firstText);
          yield encoder.encode(openers[index]);
          yield first;
          remaining -= first.length;
          while (remaining > 4) {
            const part = await reader.take(Math.min(64 * 1024, remaining - 4));
            if (!part.length) fail("api.refInvalidFormat");
            validatePart(part, false, image.byteLength);
            yield part;
            remaining -= part.length;
          }
          if (remaining) {
            const tail = await reader.exact(remaining);
            validatePart(tail, true, image.byteLength);
            yield tail;
          }
          yield encoder.encode(closers[index]);
        }
        if ((await reader.take(1)).length) fail("api.refInvalidFormat");
        complete = true;
        // Only a fully validated upload gets a complete, valid upstream JSON body.
        yield encoder.encode("]}");
      } catch (error) {
        streamError = error instanceof VideoProviderError ? error : new VideoProviderError("api.refInvalidFormat", 400);
        throw streamError;
      }
    }
    const iterator = chunks();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) controller.close(); else controller.enqueue(next.value);
        } catch (error) { controller.error(error); }
      },
      async cancel() { await reader.cancel(); await iterator.return(undefined); },
    }, { highWaterMark: 0 });
    return { stream, byteLength, cancel: () => reader.cancel(), error: () => streamError, complete: () => complete };
  } catch (error) {
    await reader.cancel();
    throw error;
  }
}
