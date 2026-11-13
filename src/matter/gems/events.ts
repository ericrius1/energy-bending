// The stones the GPU heard: sim.wgsl appends an event for every stone that lands, breaks off or clicks home
// (where, what, which specimen, how hard). They go back to the CPU through a ring of three staging buffers, each
// mapped a frame or two later, so reading them never stalls the frame; the score (audio/score.ts) rings a few.
import type { Kit, RawItem, StorageBuffer } from '@ericrius1/weft';
import { LIMITS } from '../../engine/limits';

const MAXEV = LIMITS.soundEvents;
const BYTES = 16 + MAXEV * 32;

export class SoundEvents {
  /** [0] the sparkle ring's head, [1] events this frame (zeroed before each step) */
  readonly counter: StorageBuffer;
  readonly events: StorageBuffer;
  /** the run item copying this frame's events into a free staging buffer */
  readonly copy: RawItem;
  private stage: GPUBuffer[];
  private busy = [false, false, false];
  private slot = 0;
  private copied = -1;
  private zero = new Uint32Array(1);
  /** the last read in flight (a stepped capture waits for it, so the score is complete) */
  pending: Promise<void> | null = null;

  constructor(private kit: Kit) {
    this.counter = kit.storage({ label: 'gems.counters', size: 16, usage: ['storage', 'copy-src', 'copy-dst'] });
    this.events = kit.storage({ label: 'gems.events', size: MAXEV * 32, usage: ['storage', 'copy-src'] });
    this.stage = [0, 1, 2].map((i) => kit.device.createBuffer({ label: `gems.events.read${i}`, size: BYTES, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
    this.copy = kit.raw((enc) => {
      this.copied = -1;
      if (this.busy[this.slot]) return;
      enc.copyBufferToBuffer(this.counter.gpu, 0, this.stage[this.slot], 0, 16);
      enc.copyBufferToBuffer(this.events.gpu, 0, this.stage[this.slot], 16, MAXEV * 32);
      this.copied = this.slot;
    }, 'gems.events.copy');
  }

  /** before the run: no events yet this frame */
  begin() { this.kit.queue.writeBuffer(this.counter.gpu, 4, this.zero); }

  /** after the run: map the buffer just copied into, and hand its events on (stamped with `when`) */
  read(when: number, to: (when: number, ev: Float32Array, n: number) => void) {
    if (this.copied < 0) return;
    const slot = this.copied, b = this.stage[slot];
    this.slot = (this.slot + 1) % 3;
    this.busy[slot] = true;
    this.pending = (async () => {
      await b.mapAsync(GPUMapMode.READ);
      const n = Math.min(new Uint32Array(b.getMappedRange(0, 16))[1], MAXEV);
      const ev = n ? new Float32Array(b.getMappedRange(16, n * 32)).slice() : null;
      b.unmap();
      this.busy[slot] = false;
      if (ev) to(when, ev, n);
    })();
  }
}
