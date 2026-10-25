import { describe, expect, it, vi } from "vitest";
import { replyAfterPlayback } from "./playback-reply";

describe("automatic spoken reply handoff", () => {
  it("waits for playback to end and opens only one recording even if ended fires twice", () => {
    const order: string[] = [];
    const ended = replyAfterPlayback({ expectsReply: true, isCurrent: () => true, onFinished: () => order.push("finished"), onReply: () => order.push("listen") });
    expect(order).toEqual([]);
    ended();
    ended();
    expect(order).toEqual(["finished", "listen"]);
  });

  it("also supports confirmation prompts that are not phrased as questions", () => {
    const listen = vi.fn();
    const ended = replyAfterPlayback({ expectsReply: true, isCurrent: () => true, onFinished: () => undefined, onReply: listen });
    ended();
    expect(listen).toHaveBeenCalledOnce();
  });

  it("does not record after a completion statement", () => {
    const listen = vi.fn();
    const finished = vi.fn();
    replyAfterPlayback({ expectsReply: false, isCurrent: () => true, onFinished: finished, onReply: listen })();
    expect(finished).toHaveBeenCalledOnce();
    expect(listen).not.toHaveBeenCalled();
  });

  it.each(["left Voice", "pressed End", "replaced playback"])("ignores a late ended callback after the user %s", () => {
    let current = true;
    const listen = vi.fn();
    const finished = vi.fn();
    const ended = replyAfterPlayback({ expectsReply: true, isCurrent: () => current, onFinished: finished, onReply: listen });
    current = false;
    ended();
    expect(finished).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });

  it("honors cancellation that happens as playback finishes", () => {
    let current = true;
    const listen = vi.fn();
    replyAfterPlayback({ expectsReply: true, isCurrent: () => current, onFinished: () => { current = false; }, onReply: listen })();
    expect(listen).not.toHaveBeenCalled();
  });
});
