import { writeFileSync } from 'node:fs';
import { codeToHtml } from 'shiki';
import { samples } from './code-samples.mjs';

const out = 'src/app/guestbook/code-samples.generated.ts';

const highlighted = await Promise.all(
  samples.map(async (sample) => ({
    ...sample,
    html: await codeToHtml(sample.code, {
      lang: 'ts',
      theme: 'github-dark-default',
      transformers: [
        {
          pre(node) {
            delete node.properties.style;
            delete node.properties.tabindex;
          },
        },
      ],
    }),
  })),
);

writeFileSync(
  out,
  `export interface CodeSample {
  file: string;
  note: string;
  code: string;
  html: string;
}

export const CODE_SAMPLES: CodeSample[] = ${JSON.stringify(highlighted, null, 2)};
`,
);
console.log(`Wrote ${out}`);
