import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { guardUrl, MAX_REDIRECTS } from './fetch-guard';

export interface StoredImage {
  filename: string;
  mimeType: string;
  /** Where it came from, for the trace log. Null for an uploaded file. */
  sourceUrl: string | null;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Accepted types, their extensions, and the leading bytes that must match. A
 * server claiming image/png over HTML gets dropped (§8.2).
 */
const TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 },
  'image/png': {
    ext: 'png',
    magic: (b) =>
      b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
  },
  'image/webp': {
    ext: 'webp',
    magic: (b) =>
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  'image/avif': {
    ext: 'avif',
    magic: (b) => b.subarray(4, 8).toString('ascii') === 'ftyp',
  },
  'image/gif': {
    ext: 'gif',
    magic: (b) => b.subarray(0, 3).toString('ascii') === 'GIF',
  },
};

@Injectable()
export class ImageService {
  private readonly logger = new Logger(ImageService.name);
  readonly mediaDir: string;

  constructor(config: ConfigService) {
    this.mediaDir = config.get<string>(
      'RECIPE_MEDIA_DIR',
      './var/media/recipes',
    );
  }

  /** Created at boot if missing (§10). */
  async ensureDir(): Promise<void> {
    await mkdir(this.mediaDir, { recursive: true });
  }

  path(filename: string): string {
    return join(this.mediaDir, filename);
  }

  /**
   * Downloads the recipe's picture. Failure here is never fatal: a 404 on the
   * hero image must not cost the extraction we just paid for, so this returns
   * null rather than throwing and the card shows a placeholder.
   */
  async download(
    candidateUrl: string | null,
    fallbackUrl: string | null,
    base: string,
  ): Promise<StoredImage | null> {
    for (const raw of [candidateUrl, fallbackUrl]) {
      if (!raw) continue;
      let absolute: string;
      try {
        absolute = new URL(raw, base).toString();
      } catch {
        continue;
      }
      try {
        const stored = await this.fetchAndStore(absolute);
        if (stored) return stored;
      } catch (error) {
        this.logger.warn({
          message: 'recipe image download failed',
          url: absolute,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return null;
  }

  private async fetchAndStore(rawUrl: string): Promise<StoredImage | null> {
    let current = rawUrl;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const guard = await guardUrl(current);
      if (!guard.ok) return null;

      const response = await fetch(guard.url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return null;
        current = new URL(location, guard.url).toString();
        continue;
      }
      if (!response.ok) return null;

      const mimeType = (response.headers.get('content-type') ?? '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      const type = TYPES[mimeType];
      if (!type) return null;

      const bytes = await readCappedBytes(response, MAX_IMAGE_BYTES);
      if (!bytes || !type.magic(bytes)) return null;

      const filename = await this.write(bytes, type.ext);
      return { filename, mimeType, sourceUrl: guard.url.toString() };
    }

    return null;
  }

  /** The upload path (PUT /recipes/:id/image), same validation as a download. */
  async store(buffer: Buffer, mimeType: string): Promise<StoredImage> {
    const type = TYPES[mimeType.toLowerCase()];
    if (!type || !type.magic(buffer)) {
      throw new BadRequestException("That file isn't an image we can store.");
    }
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      throw new BadRequestException('That image is too large.');
    }
    return {
      filename: await this.write(buffer, type.ext),
      mimeType: mimeType.toLowerCase(),
      sourceUrl: null,
    };
  }

  /**
   * The filename is never derived from the remote URL — that is a path traversal
   * waiting to happen.
   */
  private async write(bytes: Buffer, ext: string): Promise<string> {
    await this.ensureDir();
    const filename = `${nanoid(16)}.${ext}`;
    await writeFile(this.path(filename), bytes);
    return filename;
  }

  /** Called only after the row has been updated, never before. */
  async remove(filename: string | null): Promise<void> {
    if (!filename) return;
    await rm(this.path(filename), { force: true });
  }
}

async function readCappedBytes(
  response: Response,
  maxBytes: number,
): Promise<Buffer | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
