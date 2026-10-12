import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Markdown-lite for help texts, section descriptions and info blocks: paragraphs, `- `
 * bullet lists, `1. ` numbered lists, **bold**, *italic* / _italic_, `code` and
 * [links](https://...). Renders React elements only (no HTML injection).
 */
export function Markdown({ source, className }: { source: string | null | undefined; className?: string }) {
  if (!source || source.trim() === "") return null;
  const blocks = source.replace(/\r\n?/g, "\n").trim().split(/\n{2,}/);
  return (
    <div className={cn("space-y-1.5 text-sm leading-relaxed", className)}>
      {blocks.map((block, i) => (
        <Block key={i} text={block} />
      ))}
    </div>
  );
}

function Block({ text }: { text: string }) {
  const lines = text.split("\n");
  if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
    return (
      <ul className="list-disc space-y-0.5 pl-5">
        {lines.map((l, i) => (
          <li key={i}>{inline(l.replace(/^\s*[-*]\s+/, ""))}</li>
        ))}
      </ul>
    );
  }
  if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
    return (
      <ol className="list-decimal space-y-0.5 pl-5">
        {lines.map((l, i) => (
          <li key={i}>{inline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>
        ))}
      </ol>
    );
  }
  return (
    <p>
      {lines.map((l, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {inline(l)}
        </Fragment>
      ))}
    </p>
  );
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<strong key={k++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) out.push(<code key={k++} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      const href = lm?.[2] ?? "";
      if (lm && /^(https?:|mailto:)/i.test(href)) {
        out.push(
          <a key={k++} href={href} target="_blank" rel="noreferrer noopener" className="text-brand underline underline-offset-2">
            {lm[1]}
          </a>,
        );
      } else out.push(lm?.[1] ?? tok);
    } else out.push(<em key={k++}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
