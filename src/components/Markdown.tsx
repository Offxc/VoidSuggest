import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders user-written text. This is the one place user markdown becomes
 * HTML, so it is deliberately strict:
 *  - raw HTML in the text is dropped, never rendered
 *  - only a short list of harmless elements is allowed (no images, no iframes)
 *  - links must be absolute http(s) or mailto, and open with rel="nofollow ugc"
 */
const ALLOWED = [
  "p", "br", "strong", "em", "del", "ul", "ol", "li", "code", "pre",
  "blockquote", "a", "h3", "h4", "hr", "table", "thead", "tbody", "tr", "th", "td",
];

function safeUrl(url: string): string {
  return /^(https?:\/\/|mailto:)/i.test(url) ? url : "";
}

export function Markdown({ children, className = "prose" }: { children: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        allowedElements={ALLOWED}
        unwrapDisallowed
        skipHtml
        urlTransform={safeUrl}
        components={{
          a: ({ href, children: label }) =>
            href ? (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc">
                {label}
              </a>
            ) : (
              <>{label}</>
            ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
