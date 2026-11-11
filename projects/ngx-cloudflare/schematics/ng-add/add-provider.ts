function closingBracket(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '[' || char === '(' || char === '{') depth++;
    else if (char === ']' || char === ')' || char === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function addProvider(
  text: string,
  expression: string,
  importLines: string[],
): string | null {
  const call = text.indexOf('provideServerRendering(');
  const providers = text.lastIndexOf('providers', call);
  const open = providers === -1 ? -1 : text.indexOf('[', providers);
  const close = open === -1 ? -1 : closingBracket(text, open);
  if (call === -1 || close === -1 || close < call) {
    return null;
  }
  const inner = text.slice(open + 1, close);
  const before = text.slice(0, close).replace(/[\s,]*$/, '');
  const tail = text.slice(before.length, close);
  let insertion = `, ${expression}`;
  if (inner.includes('\n')) {
    const indent = /\n([ \t]*)\S/.exec(inner)?.[1] ?? '  ';
    const closingIndent = /\n([ \t]*)$/.exec(tail)?.[1] ?? '';
    insertion = `,\n${indent}${expression},\n${closingIndent}`;
  }
  let result = before + insertion + text.slice(close);
  const imports = [...result.matchAll(/^import[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm)];
  const last = imports.at(-1);
  const insertAt = last ? last.index! + last[0].length : 0;
  const missing = importLines.filter((line) => !result.includes(line));
  if (missing.length) {
    result = `${result.slice(0, insertAt)}\n${missing.join('\n')}${result.slice(insertAt)}`;
  }
  return result;
}
