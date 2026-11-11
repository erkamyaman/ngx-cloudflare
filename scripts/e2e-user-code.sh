#!/bin/bash
# Adds what a user would write after ng add: a var, a KV binding, an API route and a component that reads env.
set -eu
cd "$1"
node -e '
const fs=require("fs");const {modify,applyEdits}=require("jsonc-parser");
const f="wrangler.jsonc";let t=fs.readFileSync(f,"utf8");
for (const [p,v] of [[["vars"],{GREETING:"hello from env"}],[["kv_namespaces"],[{binding:"KV"}]]]) t=applyEdits(t,modify(t,p,v,{formattingOptions:{insertSpaces:true,tabSize:2}}));
fs.writeFileSync(f,t);'
cat > src/server.ts <<'TS'
import { createCloudflareRequestHandler } from 'ngx-cloudflare/server';

interface AppEnv {
  GREETING: string;
  KV: { get(k: string): Promise<string | null>; put(k: string, v: string): Promise<void> };
}

export const reqHandler = createCloudflareRequestHandler<AppEnv>({
  api: async (request, env) => {
    if (new URL(request.url).pathname === '/api/greeting') {
      const hits = Number((await env.KV.get('hits')) ?? 0) + 1;
      await env.KV.put('hits', String(hits));
      return Response.json({ greeting: env.GREETING, hits });
    }
    return null;
  },
});

export default { fetch: reqHandler };
TS
if [ -f src/app/app.component.ts ]; then COMPONENT=src/app/app.component.ts; CLASS=AppComponent; else COMPONENT=src/app/app.ts; CLASS=App; fi
cat > "$COMPONENT" <<'TS'
import { JsonPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { injectCloudflare } from 'ngx-cloudflare';
import { catchError, of } from 'rxjs';

@Component({
  selector: 'app-root',
  template: `<p id="probe">env={{ greeting }} source={{ source }} api={{ api() | json }}</p>`,
  imports: [JsonPipe],
})
export class __CLASS__ {
  private readonly cf = injectCloudflare<{ GREETING: string }>();
  protected readonly greeting = this.cf?.env.GREETING ?? 'null';
  protected readonly source = this.cf?.source ?? 'browser';
  protected readonly api = toSignal(
    inject(HttpClient).get('/api/greeting').pipe(catchError((e) => of({ error: e.status }))),
  );
}
TS
sed -i.bak "s/__CLASS__/$CLASS/" "$COMPONENT" && rm -f "$COMPONENT.bak"
rm -f src/app/app.spec.ts src/app/app.component.spec.ts
grep -q provideHttpClient src/app/app.config.ts || { sed -i '' "s#providers: \[#providers: [provideHttpClient(withFetch()), #" src/app/app.config.ts; printf "import { provideHttpClient, withFetch } from '@angular/common/http';\n%s\n" "$(cat src/app/app.config.ts)" > src/app/app.config.ts; }
