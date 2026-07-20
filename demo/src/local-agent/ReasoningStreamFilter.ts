export type ReasoningStreamChannel = 'answer' | 'reasoning';

export interface ReasoningStreamPart {
  readonly channel: ReasoningStreamChannel;
  readonly text: string;
}

const THINK_TAG = 'think';
const XML_TAG_AT_START = /^<(\/?)((?:[A-Za-z][A-Za-z0-9_.:-]*))(?:\s[^<>]*?)?\s*(\/?)>/u;
const SPECIAL_TOKEN_AT_START = /^<\|[^<>|]+\|>/u;

const appendPart = (
  parts: ReasoningStreamPart[],
  channel: ReasoningStreamChannel,
  text: string,
): void => {
  if (!text) return;
  const previous = parts.at(-1);
  if (previous?.channel === channel) {
    parts[parts.length - 1] = { channel, text: previous.text + text };
    return;
  }
  parts.push({ channel, text });
};

const couldBeIncompleteControlTag = (value: string): boolean => {
  if (value === '<' || value === '</') return true;
  return (
    /^<\/?[A-Za-z][A-Za-z0-9_.:-]*(?:\s[^<>]*)?\/?$/u.test(value) ||
    /^<\|[^<>|]*$/u.test(value)
  );
};

/**
 * Splits a streamed model response into private reasoning and its speakable
 * answer. Any XML-like model wrapper is removed, while think-tag contents are
 * routed to the visible reasoning channel. Tags may span arbitrary tokens.
 * Incomplete control markup at end-of-stream fails closed.
 */
export class ReasoningStreamFilter {
  private thinkingDepth = 0;
  private pending = '';

  private get channel(): ReasoningStreamChannel {
    return this.thinkingDepth > 0 ? 'reasoning' : 'answer';
  }

  feed(chunk: string): ReasoningStreamPart[] {
    if (!chunk) return [];
    this.pending += chunk;
    const parts: ReasoningStreamPart[] = [];

    while (this.pending) {
      const tagStart = this.pending.indexOf('<');
      if (tagStart < 0) {
        appendPart(parts, this.channel, this.pending);
        this.pending = '';
        break;
      }
      if (tagStart > 0) {
        appendPart(parts, this.channel, this.pending.slice(0, tagStart));
        this.pending = this.pending.slice(tagStart);
        continue;
      }

      const specialToken = this.pending.match(SPECIAL_TOKEN_AT_START);
      if (specialToken) {
        this.pending = this.pending.slice(specialToken[0].length);
        continue;
      }

      const tag = this.pending.match(XML_TAG_AT_START);
      if (tag) {
        const [, closingMarker, rawName, selfClosingMarker] = tag;
        this.pending = this.pending.slice(tag[0].length);
        if (rawName.toLowerCase() === THINK_TAG && !selfClosingMarker) {
          if (closingMarker) {
            this.thinkingDepth = Math.max(0, this.thinkingDepth - 1);
          } else {
            this.thinkingDepth += 1;
          }
        }
        continue;
      }

      if (couldBeIncompleteControlTag(this.pending)) break;

      // A literal comparison such as "x < y" is not model markup.
      appendPart(parts, this.channel, '<');
      this.pending = this.pending.slice(1);
    }

    return parts;
  }

  flush(): ReasoningStreamPart[] {
    // Anything still pending is necessarily a prefix of a control tag. It is
    // unsafe to pronounce and has no useful value in the visible trace.
    this.pending = '';
    return [];
  }
}
