/**
 * Min-heap priority queue for continuous-time event scheduling.
 * Events are ordered by ascending `.time`.
 */
export class EventQueue {
  constructor() {
    this._heap = [];
  }

  get size() { return this._heap.length; }

  push(event) {
    this._heap.push(event);
    this._bubbleUp(this._heap.length - 1);
  }

  peek() {
    return this._heap[0] ?? null;
  }

  pop() {
    const top = this._heap[0];
    const last = this._heap.pop();
    if (this._heap.length > 0) {
      this._heap[0] = last;
      this._siftDown(0);
    }
    return top;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._heap[parent].time <= this._heap[i].time) break;
      [this._heap[parent], this._heap[i]] = [this._heap[i], this._heap[parent]];
      i = parent;
    }
  }

  _siftDown(i) {
    const n = this._heap.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this._heap[l].time < this._heap[smallest].time) smallest = l;
      if (r < n && this._heap[r].time < this._heap[smallest].time) smallest = r;
      if (smallest === i) break;
      [this._heap[smallest], this._heap[i]] = [this._heap[i], this._heap[smallest]];
      i = smallest;
    }
  }
}
