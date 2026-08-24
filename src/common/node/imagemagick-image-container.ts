import { execFile, spawn } from 'child_process';
import {
  Dimensions,
  FragmentContainer,
  FragmentContainerConfig,
  ImageContainer,
} from '@/core';
import { toBase64DataUri } from '../util';

export interface ImageContainerConfig {
  downscaleSource?: boolean;
}

/** Converts an in-memory image buffer (clipboard input) to a file on disk,
 * equivalent to sharp(buffer).toFormat('jpeg').toFile(dest). */
export function convertBufferToFile(buffer: Buffer, dest: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('magick', ['-', dest]);

    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`magick exited with code ${code}`));
      }
    });
    child.stdin.end(buffer);
  });
}

function convert(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      'magick',
      args,
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          reject(err);
        } else {
          resolve(stdout as unknown as Buffer);
        }
      }
    );
  });
}

function identify(filePath: string): Promise<Dimensions> {
  return new Promise((resolve, reject) => {
    execFile(
      'magick',
      ['identify', '-format', '%w %h', filePath],
      (err, stdout) => {
        if (err) {
          reject(err);
        } else {
          const [width, height] = stdout.trim().split(' ').map(Number);

          resolve({ width, height });
        }
      }
    );
  });
}

/** PNG dimensions live in the IHDR chunk, which starts right after the
 * fixed 8-byte signature + 4-byte length + 4-byte "IHDR" tag. */
function pngDimensions(buffer: Buffer): Dimensions {
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

class ImageMagickFragmentContainer implements FragmentContainer<string> {
  private pendingThreshold: number = null;

  constructor(
    private readonly source: string,
    private readonly args: readonly string[],
    private readonly colors?: number
  ) {}

  clone() {
    return new ImageMagickFragmentContainer(this.source, this.args, this.colors);
  }

  threshold(threshold: number) {
    // Matches sharp's threshold(): pixels >= threshold become 255, others 0.
    // convert's -threshold takes a percentage of the 0-255 range.
    this.pendingThreshold = threshold;

    return this;
  }

  async toTrimmedBase64(threshold: number) {
    try {
      const data = await convert([
        this.source,
        ...this.args,
        ...this.colorsArgs(),
        '-fuzz',
        `${threshold}%`,
        '-trim',
        '+repage',
        'png:-',
      ]);

      return {
        uri: toBase64DataUri('png', data.toString('base64')),
        dimensions: pngDimensions(data),
      };
    } catch {
      return {
        uri: toBase64DataUri('png', ''),
        dimensions: { width: 0, height: 0 },
      };
    }
  }

  async toBase64() {
    const data = await convert([this.source, ...this.buildArgs(), 'png:-']);

    return {
      uri: toBase64DataUri('png', data.toString('base64')),
      dimensions: pngDimensions(data),
    };
  }

  async toPixelData() {
    const data = await convert([this.source, ...this.buildArgs(), 'GRAY:-']);

    return new Uint8Array(data.buffer, data.byteOffset, data.length);
  }

  private colorsArgs() {
    return this.colors ? ['-colors', String(this.colors)] : [];
  }

  // -colors quantization has to run after -threshold: once the image is
  // thresholded it's already pure black/white, which is what sharp's actual
  // execution order produces (colour/format conversions are output-encode
  // steps applied last, regardless of call order in the source). Doing it
  // the other way around lets quantization pick two closely-shaded colours,
  // which then all land on the same side of a threshold cut - wiping the
  // whole fragment to solid white or black.
  private buildArgs() {
    if (this.pendingThreshold == null) {
      return [...this.args, ...this.colorsArgs()];
    }

    return [
      ...this.args,
      '-threshold',
      `${(this.pendingThreshold / 255) * 100}%`,
      ...this.colorsArgs(),
    ];
  }
}

export class ImageMagickImageContainer extends ImageContainer<string> {
  // Only downscale from 4k or higher resolutions.
  static readonly MIN_DOWNSCALE_WIDTH = 3840;

  private constructor(
    public readonly instance: string,
    public readonly dimensions: Dimensions,
    private readonly config: ImageContainerConfig
  ) {
    super();
  }

  static async create(filePath: string, config: ImageContainerConfig = {}) {
    const dimensions = await identify(filePath);

    return new ImageMagickImageContainer(filePath, dimensions, config);
  }

  toFragmentContainer(config: FragmentContainerConfig) {
    return new ImageMagickFragmentContainer(
      this.instance,
      this.process(config),
      config.colors
    );
  }

  private process({
    boundingBox: { left, top, width: cropWidth, height: cropHeight, innerWidth },
    channel,
    flop,
    width,
  }: FragmentContainerConfig) {
    const args = [
      '-crop',
      `${cropWidth}x${cropHeight}+${left}+${top}`,
      '+repage',
      '-alpha',
      'off',
    ];

    // Extracting a channel has to happen while the image still has RGB
    // data - once -colorspace Gray collapses it to a single channel there's
    // no red/green/blue plane left to pull out.
    if (channel) {
      const channelName = { red: 'Red', green: 'Green', blue: 'Blue' }[
        channel
      ];

      args.push('-channel', channelName, '-separate', '+channel');
    }

    args.push('-negate', '-colorspace', 'Gray');

    if (flop) {
      args.push('-flop');
    }

    if (
      this.config.downscaleSource &&
      typeof width === 'number' &&
      innerWidth >= ImageMagickImageContainer.MIN_DOWNSCALE_WIDTH
    ) {
      args.push('-resize', `${width}x>`);
    }

    return args;
  }
}
