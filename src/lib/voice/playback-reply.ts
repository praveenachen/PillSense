/** Only the current playback's first ended event may open a reply recording. */
export function replyAfterPlayback(options: {
  expectsReply: boolean;
  isCurrent: () => boolean;
  onFinished: () => void;
  onReply: () => void;
}) {
  let completed = false;
  return () => {
    if (completed || !options.isCurrent()) return;
    completed = true;
    options.onFinished();
    if (options.expectsReply && options.isCurrent()) options.onReply();
  };
}
