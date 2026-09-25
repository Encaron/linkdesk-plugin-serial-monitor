/**
 * RingBuffer——帧缓冲根件（接收流的数据入口）。
 * 判据：容量上界 / 写满一圈后的覆盖顺序 / 取出即清空 / 容量 0 的静默丢弃。
 */
import { describe, it, expect } from "vitest";
import { RingBuffer } from "../utils/RingBuffer";

describe("RingBuffer", () => {
  it("默认容量 512——未写满时 size 逐条递增，drainAll 按写入序返回", () => {
    const rb = new RingBuffer<number>();
    for (let i = 1; i <= 512; i++) rb.write(i);

    expect(rb.size).toBe(512);
    const out = rb.drainAll();
    expect(out).toHaveLength(512);
    expect(out[0]).toBe(1);
    expect(out[511]).toBe(512);
  });

  it("容量上界：写超过容量后 size 不再增长（满则覆盖最老）", () => {
    const rb = new RingBuffer<number>(3);
    for (let i = 1; i <= 5; i++) rb.write(i); // 1..5，只应留最后 3 条

    expect(rb.size).toBe(3);
    expect(rb.drainAll()).toEqual([3, 4, 5]);
  });

  it("写满两圈：只留最后 capacity 条，且顺序仍是写入序（最老在前）", () => {
    const rb = new RingBuffer<number>(3);
    for (let i = 1; i <= 7; i++) rb.write(i); // 1..7，留 5/6/7

    expect(rb.size).toBe(3);
    expect(rb.drainAll()).toEqual([5, 6, 7]);
  });

  it("drainAll 取出即清空——第二次为空", () => {
    const rb = new RingBuffer<string>(4);
    rb.write("a");
    rb.write("b");

    expect(rb.drainAll()).toEqual(["a", "b"]);
    expect(rb.size).toBe(0);
    expect(rb.drainAll()).toEqual([]);
  });

  it("drainAll 之后继续写入不错位（head/tail 相对位置保持）", () => {
    const rb = new RingBuffer<number>(3);
    for (let i = 1; i <= 5; i++) rb.write(i);
    expect(rb.drainAll()).toEqual([3, 4, 5]);

    rb.write(6);
    rb.write(7);
    expect(rb.size).toBe(2);
    expect(rb.drainAll()).toEqual([6, 7]);
  });

  it("容量 1：后写覆盖先写，size 恒为 1", () => {
    const rb = new RingBuffer<number>(1);
    rb.write(1);
    expect(rb.size).toBe(1);
    rb.write(2);

    expect(rb.size).toBe(1);
    expect(rb.drainAll()).toEqual([2]);
  });

  it("容量 0：写入被静默丢弃，size 恒 0，不抛错（现状即契约）", () => {
    const rb = new RingBuffer<number>(0);

    expect(() => rb.write(1)).not.toThrow();
    expect(rb.size).toBe(0);
    expect(rb.drainAll()).toEqual([]);
  });

  it("空缓冲区：size 0 且 drainAll 返回空数组", () => {
    const rb = new RingBuffer<number>(8);
    expect(rb.size).toBe(0);
    expect(rb.drainAll()).toEqual([]);
  });
});
