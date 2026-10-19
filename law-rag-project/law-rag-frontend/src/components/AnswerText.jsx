// Renders the LLM answer with a small, safe Markdown subset. Page mentions
// ("p.12", "12페이지") become links only when a retrieved citation actually
// points at that page, so the link always lands on real evidence.

const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/u;
const ORDERED_ITEM = /^\s*\d+[.)]\s+/u;
const HEADING = /^\s*#{1,4}\s+/u;
const LABEL = /^\s*\**\s*(답변|근거|요약|참고|결론|설명)\s*\**\s*[:：]\s*\**\s*(.*)$/u;
const INLINE = /(\*\*[^*]+\*\*)|(`[^`]+`)|(p\.\s?\d+)|(\d+\s?페이지)/gu;

function parseBlocks(text) {
  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: "p", lines: paragraph });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  };

  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const label = line.match(LABEL);
    if (label) {
      flushParagraph();
      flushList();
      blocks.push({ type: "label", text: label[1] });
      if (label[2].trim()) {
        paragraph.push(label[2].trim());
      }
      continue;
    }

    if (HEADING.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ type: "h", text: line.replace(HEADING, "") });
      continue;
    }

    if (LIST_ITEM.test(line)) {
      flushParagraph();
      const ordered = ORDERED_ITEM.test(line);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { type: "list", ordered, items: [] };
      }
      list.items.push(line.replace(LIST_ITEM, ""));
      continue;
    }

    if (list && /^\s{2,}/.test(raw)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  return blocks;
}

function Inline({ text, onPageRef, hasPage }) {
  const parts = [];
  let last = 0;

  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    const [token] = match;
    const key = `${match.index}-${token}`;

    if (match[1]) {
      parts.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (match[2]) {
      parts.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else {
      const page = Number(token.match(/\d+/)[0]);
      parts.push(
        hasPage(page) ? (
          <button
            key={key}
            type="button"
            className="page-ref"
            onClick={() => onPageRef(page)}
            title={`p.${page} 근거를 원문에서 보기`}
          >
            {token}
          </button>
        ) : (
          token
        ),
      );
    }
    last = match.index + token.length;
  }

  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return parts;
}

export default function AnswerText({ text, onPageRef, hasPage }) {
  const blocks = parseBlocks(text ?? "");
  const inline = (value) => <Inline text={value} onPageRef={onPageRef} hasPage={hasPage} />;

  return (
    <div className="answer-text">
      {blocks.map((block, index) => {
        if (block.type === "label") {
          return (
            <h4 key={index} className="answer-label">
              {block.text}
            </h4>
          );
        }
        if (block.type === "h") {
          return <h4 key={index}>{inline(block.text)}</h4>;
        }
        if (block.type === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return (
            <Tag key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{inline(item)}</li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={index}>
            {block.lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 && <br />}
                {inline(line)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
