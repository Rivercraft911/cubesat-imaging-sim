import { probeDownlink } from '../downlink/codec';
import { LinkTimeline } from '../downlink/channel';
import type { DownlinkConfig } from '../downlink/types';

export interface ComparisonDecode {
  image?: HTMLCanvasElement;
  bytes: number;
  arrivalMs?: number;
  codec: string;
  dropped?: string;
}

/** Independent single-keyframe experiment, starting with an empty link queue. */
export async function decodeComparisonFrame(source: ImageBitmap, config: DownlinkConfig, signal: AbortSignal): Promise<ComparisonDecode> {
  const support = await probeDownlink({ ...config, program: 'main' }, signal);
  if (!support.supported) throw new Error(support.reason);
  signal.throwIfAborted();
  const stream = support.streams[0];
  const input = document.createElement('canvas');
  input.width = stream.width; input.height = stream.height;
  input.getContext('2d')!.drawImage(source, 0, 0, input.width, input.height);
  let encoder: VideoEncoder | undefined;
  let decoder: VideoDecoder | undefined;
  let codecError: Error | undefined;
  let decoderConfig: VideoDecoderConfig | undefined;
  const chunks: EncodedVideoChunk[] = [];
  let output: HTMLCanvasElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = () => { if (encoder?.state !== 'closed') encoder?.close(); if (decoder?.state !== 'closed') decoder?.close(); };
  signal.addEventListener('abort', abort, { once: true });
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { abort(); reject(new Error('Comparison codec timed out.')); }, 10000); });
  try {
    const work = async () => {
      encoder = new VideoEncoder({ output(chunk, metadata) { chunks.push(chunk); if (metadata?.decoderConfig) decoderConfig = metadata.decoderConfig; }, error(error) { codecError = error; } });
      encoder.configure(stream.encoderConfig);
      const frame = new VideoFrame(input, { timestamp: 0, duration: Math.round(1e6 / config.fps) });
      try { encoder.encode(frame, { keyFrame: true }); } finally { frame.close(); }
      await encoder.flush();
      signal.throwIfAborted();
      if (codecError) throw codecError;
      if (!decoderConfig || chunks.length !== 1 || chunks[0].type !== 'key') throw new Error('Codec did not emit one independently decodable keyframe.');
      const descriptionBytes = decoderConfig.description?.byteLength ?? 0;
      const bytes = chunks[0].byteLength + descriptionBytes;
      const channel = new LinkTimeline<EncodedVideoChunk>(config);
      const admitted = channel.enqueue(chunks[0], bytes, 0);
      if (!admitted.accepted) return { bytes, codec: stream.codecString, dropped: admitted.reason };
      decoder = new VideoDecoder({ output(frame) {
        try {
          output = document.createElement('canvas'); output.width = frame.displayWidth; output.height = frame.displayHeight;
          output.getContext('2d')!.drawImage(frame, 0, 0);
        } finally { frame.close(); }
      }, error(error) { codecError = error; } });
      decoder.configure(decoderConfig);
      for (const delivery of channel.drain(admitted.delivery.arrivesAtMs)) decoder.decode(delivery.payload);
      await decoder.flush();
      signal.throwIfAborted();
      if (codecError) throw codecError;
      if (!output) throw new Error('Codec produced no decoded comparison frame.');
      return { image: output, bytes, arrivalMs: admitted.delivery.arrivesAtMs, codec: stream.codecString };
    };
    return await Promise.race([work(), deadline]);
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', abort); abort();
    input.width = input.height = 1;
  }
}
