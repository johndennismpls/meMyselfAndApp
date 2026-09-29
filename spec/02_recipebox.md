# 02 — Recipe Box

A personal recipe library at `/recipes`. You type what you want — *"give me a homemade
pancakes recipe"* — and the app finds a real recipe on the web, rewrites it into one fixed
house format, saves it, and lets you edit every field afterwards.

Pasting a URL directly is still supported, but it is the secondary path. The primary input
is a request in plain English.

Unlike Word Search, this app is **not** client-side. It needs the network, a secret
(`ANTHROPIC_API_KEY`), durable storage, and image bytes. All of that lives in the API; the
web app is a thin client over it.

## 1. Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Primary input | A plain-English request, not a URL | The ask. Typing "pancakes" beats going and finding a page yourself. |
| Finding the recipe | Claude with the `web_search` / `web_fetch` server tools | Anthropic runs the search loop; we get real URLs back and pay no scraping infrastructure. |
| **Recipes are never model-generated** | **Two separate calls, and the extraction call cannot see your request** | This is the load-bearing decision. See §1.1. |
| Extraction | Claude on page text we fetched ourselves, every time | One prompt, one shape. A JSON-LD fast path would be cheaper but copies the source site's voice, and the point is that every recipe reads the same. |
| Model | `claude-opus-5` for both stages, hardcoded | Not a setting. Discovery needs judgment about which of ten results is a real recipe, and extraction quality is the product — neither is a knob worth exposing. One constant, in one file. See §5.4. |
| Output contract | Structured outputs via `messages.parse()` + Zod | The schema *is* the format guarantee. No prompt-and-pray JSON parsing. |
| Images | Downloaded and stored on the API filesystem | Source images rot, move, and block hotlinking. Owning the bytes makes "use my own photo" a file upload, not a special case. |
| Auth | None. One shared recipe box. | Matches the rest of this toolbox. Accounts are out of scope, not deferred-with-hooks — nothing here is shaped around a future user model. |
| Edit history | None. Edits overwrite. | Recovery means finding the recipe again, or reading the page text back out of the trace log (§6.4) — the record itself no longer points anywhere. Revisions deferred (§13). |
| Ingredients/steps storage | `jsonb` columns, not child tables | v1 has no cross-recipe ingredient query. Ordered lists in `jsonb` reorder with one `UPDATE`. §6.2 records what a future search costs. |
| Commit point | Saves immediately, then you edit | Per the ask: commit, *then* edit. No preview-before-save step. |
| Identifier | The serial `id`. `/recipes/42`. | No slug table, no collision suffixes, no slug-vs-title drift. A renamed recipe keeps its link for free because the link never contained the title. |
| Source attribution | Logged, not stored | Per the ask. The source URL, site, and the page text extraction ran on go to the trace log (§6.4); no column holds them. Consequence in §1.3. |

### 1.1 Why two calls — the anti-fabrication design

The requirement is that the recipe comes from a real page, not from the model's memory of
pancake recipes. That requirement cannot be met by prompt instruction alone.

**The one-call version fails quietly.** If a single call does search, fetch, *and*
extraction, then by the time the model writes the ingredient list its context holds both
the fetched page text and its own latent knowledge of how pancakes work, with no boundary
between them. Asked for a recipe and holding a page that's 80% present, the most natural
completion is to fill the gaps from memory. The output is well-formed, the page it cites is
real, the recipe is half-invented, and **nothing in the response distinguishes that from a
clean extraction.** You would never catch it.

**The two-call version makes it structural:**

```
Stage 1 — DISCOVERY     input: your request ("homemade pancakes")
                        tools: web_search, web_fetch
                        output: ranked candidate URLs. No recipe content.

        ── the only thing that crosses this line is a URL ──

Stage 2 — EXTRACTION    input: page text WE fetched from that URL
                        tools: none
                        output: the recipe, in house format
```

The extraction call never sees your request. It is not told you wanted pancakes. It is
handed a wall of text and asked what recipe is in it. There is nothing to fabricate
*toward* — the failure mode that produces an invented recipe requires knowing what was
wanted, and that information is not in the call.

Two further guards on top of the structure:

- Stage 1's candidate URLs are **checked against the URLs that actually appeared in the
  search and fetch result blocks** (§3.4). A URL the model wrote from memory is dropped.
- Stage 2 extracts from bytes we fetched, over our own connection, through our own cleaner
  (§4). It is the same code path a pasted URL takes.

The cost is a second API call and a slower flow (§9.2). It buys the only version of this
feature that actually does what was asked.

### 1.2 Ingredients are a section, even though the brief didn't list one

The requested sections were title, picture, steps, description, notes, origin. A recipe
without ingredients isn't usable, so **ingredients** is specified here as a first-class
section (§5.1). To genuinely exclude it, cut `ingredients` from the schema and the column;
nothing else depends on it.

### 1.3 No stored attribution

The record holds no source URL or site name — they go to the trace log (§6.4) instead.
Two consequences worth having said out loud:

- **The UI cannot link back to the original.** A saved recipe stands alone; the only route
  back to the source is the log.
- **Duplicate detection goes away** (§7.2). There is nothing to compare on, so asking for
  pancakes twice gives you two pancake recipes. Deferred in §13.

Fine for a private box. It would need revisiting if these were ever shared or published.

## 2. The two ways in

```
POST /recipes/find { request: "give me a homemade pancakes recipe" }
  │
  ├─ 3.  DISCOVERY: Claude + web_search/web_fetch → up to 3 candidate URLs
  │      422 if the request isn't food, or if nothing real came back
  │
  └──────┐
POST /recipes/scrape { url }          ← the URL path skips straight to here
         │
         ├─ 4.1  validate + SSRF guard ──────── 400 on a blocked or malformed URL
         ├─ 4.2  fetch HTML  ────────────────── 502 / 413 / 415 on fetch trouble
         ├─ 4.3  clean to text  ─────────────── 422 if nothing readable survives
         ├─ 5.   EXTRACTION: Claude, no tools ─ 422 if it isn't a recipe
         ├─ 8.   download the image  ────────── non-fatal; recipe saves without one
         └─ 6.3  insert  ───────────────────── 201 with the full RecipeDto
```

`/recipes/find` walks its candidate list in rank order, running the lower half of the
pipeline on each, and returns the first that yields a recipe. A candidate that 403s or
turns out to be a listicle costs one failed attempt, not the whole request.

## 3. Stage 1 — Discovery

`api/src/apps/recipes/discovery.service.ts`.

### 3.1 Tools

```ts
tools: [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 5 },
]
```

The `_20260209` variants carry dynamic filtering — Claude filters results before they hit
the context window — which is exactly right when a recipe search returns ten near-identical
SEO pages. **Do not also declare `code_execution`**; these tools run it internally and a
second execution environment confuses the model.

`web_fetch` can only fetch URLs already in the conversation, which here means URLs that
came back from `web_search`. That constraint is helpful: it is one more thing keeping the
model on pages it actually found.

### 3.2 Schema

```ts
const Candidate = z.object({
  url: z.string(),
  site_name: z.string(),
  title: z.string(),
  why: z.string(),          // one line: why this one fits the request
})

export const Discovery = z.object({
  is_food_request: z.boolean(),
  rejection_reason: z.string().nullable(),
  interpreted_as: z.string(),          // "homemade buttermilk pancakes" — echoed to the UI
  candidates: z.array(Candidate),      // ranked, best first, up to 3
})
```

No recipe fields. Stage 1 returns *where to look*, never *what was found* — if this schema
ever grows an `ingredients` array, the guarantee in §1.1 is gone.

### 3.3 The call

```ts
const response = await this.client.messages.parse({
  model: RECIPE_MODEL,                    // 'claude-opus-5', from models.ts
  max_tokens: 16000,
  system: [{ type: 'text', text: DISCOVERY_SYSTEM, cache_control: { type: 'ephemeral' } }],
  thinking: { type: 'adaptive' },
  tools: [ /* §3.1 */ ],
  output_config: {
    effort: 'medium',
    format: zodOutputFormat(Discovery, 'discovery'),
  },
  messages: [{ role: 'user', content: discoveryTurn(userRequest, preferences) }],
})
```

`discoveryTurn` is the one place the standing preferences (§9.4) enter the pipeline. They
ride in the **user turn**, above the request, as a `<standing_preferences>` block of one
line each — never in the system prompt, which has to stay byte-identical to keep the cache
prefix (§5.5). With no preferences saved, the turn is the bare request, exactly as before.

The system prompt tells it to:

- Search for the dish the user described, honouring every constraint they gave (vegan,
  no buttermilk, sheet-pan, Serious Eats) — in the request *or* in the standing
  preferences, which are hard constraints on which pages it may propose. Where the two
  genuinely conflict, today's request wins and the `why` line says so.
- Prefer pages that are **a single recipe with an ingredient list and numbered steps**.
  Reject roundups ("23 Best Pancake Recipes"), video-only pages, and store pages.
- Open promising results with `web_fetch` to confirm there is a real recipe on the page
  before proposing it — a search snippet is not evidence.
- Return up to 3, ranked, each a *different* site.
- **Never write a recipe.** If it cannot find one, return zero candidates rather than
  falling back on what it knows. The prompt says this in those words, and §3.4 enforces it.

`effort: 'medium'` — search-and-judge is genuinely harder than extraction, and `low` here
tends to grab the first result without opening it.

### 3.4 Grounding enforcement

After the call, before anything else, `assertGrounded(response, candidates)`:

1. Walk `response.content` and collect every URL appearing in a `web_search_tool_result`
   or `web_fetch_tool_result` block. That's the **observed set** — URLs the tools actually
   returned.
2. **If the observed set is empty, fail.** No search ran, so whatever came back was written
   from memory. 422, regardless of how good the candidates look.
3. Drop any candidate whose URL is not in the observed set, compared on normalised
   host + path (scheme, `www.`, trailing slash, and tracking params ignored).
4. If nothing survives, 422: *"Couldn't find that one online."*

This is a dozen lines of code and it is the difference between a stated policy and an
enforced one. It gets its own unit test with a recorded response fixture where the model
returns a plausible-but-unsearched URL.

`web_search` and `web_fetch` errors arrive as **HTTP 200** with an error object in the
result block's `content` — for search, a success `content` is a list and an error
`content` is an object, so branch on that before indexing. A tool error means an empty
observed set, which rule 2 already handles.

### 3.5 Not a food request

`is_food_request: false` → 422 with the model's own `rejection_reason`. This catches
"write me a poem" and, more usefully, "how do I fix my sourdough starter" — a real
question with no recipe page behind it.

### 3.6 Handoff

`interpreted_as` and the winning candidate's `why` are returned with the created recipe so
the UI can say *"Found buttermilk pancakes on Serious Eats"*. The runner-up candidates come
back too (§7.1), so "try a different one" costs no second discovery call.

## 4. Fetch and clean

Shared by both entry paths. A discovered URL gets no more trust than a pasted one — it came
from a model reading the open web.

### 4.1 URL validation and the SSRF guard

The server fetches a URL that traces back to user input. Unguarded, that's a request
forgery primitive pointed at whatever else is on the host or the LAN.

| Rule | Behaviour |
| --- | --- |
| Scheme | `http:` and `https:` only. Else 400. |
| DNS | Resolve the host; reject if **any** resolved address is loopback, private (`10/8`, `172.16/12`, `192.168/16`), link-local (`169.254/16`, `fe80::/10`), unique-local (`fc00::/7`), or unspecified. |
| Redirects | Max 3, and the guard re-runs on **every** hop — a public URL redirecting to `127.0.0.1` is the whole attack. |
| Timeout | 10s total (`AbortSignal.timeout`). |
| Response size | 5 MB cap on HTML, enforced while streaming, not after. |
| Content type | `text/html` or `application/xhtml+xml`, else 415. |

Lives in `fetch-guard.ts` as a pure function, unit-tested against a table of hostile URLs
without touching the network.

### 4.2 Cleaning — `cleanHtml(html: string): CleanedPage`

`cheerio`, not a readability port. Recipe pages routinely park the ingredient list in a
sidebar `aside` that readability heuristics discard; a whitelist strip keeps everything and
drops only what is definitely chrome.

1. Remove `script`, `style`, `noscript`, `svg`, `iframe`, `form`, `button`, `nav`,
   `header`, `footer`, `aside[role=complementary]`, and comment nodes.
2. Capture `<title>`, `og:title`, `og:image`, `og:site_name`, and `link[rel=canonical]`
   before stripping.
3. Convert the remaining body to text: block elements become newlines, `li` gets a leading
   `- `, consecutive blank lines collapse, entities decoded.
4. Return `{ text, title, ogImageUrl, siteName, canonicalUrl }`.

**No silent truncation.** Over `RECIPE_MAX_PAGE_CHARS` (default 250_000, ~60k tokens) →
413 naming the size. A cleaned recipe page is typically 3–15k characters; a quarter-million
isn't a recipe page and shouldn't be quietly half-fed to the model. Under 200 characters →
422, *"That page had no readable text — it may need JavaScript to render."*

### 4.3 When our fetch fails but the page is real

Cloudflare and friends will 403 our fetch on pages Anthropic's `web_fetch` reached
comfortably. When every candidate fails at §4.1–4.2, fall back **once** to the page text
`web_fetch` already returned in the stage 1 response, extracting from that instead.

This stays inside the §1.1 guarantee: that text is a real fetch of a real page, not model
output. The trace log records that the text came via `web_fetch` rather than our own fetch
(§6.4), and the fallback is skipped entirely for the pasted-URL path — there, a fetch
failure is a fetch failure and the user gets the honest 502.

## 5. Stage 2 — Extraction

`api/src/apps/recipes/extraction.service.ts`. Identical for both entry paths.

### 5.1 Schema

Zod, in `extraction.schema.ts`, the source of truth for the whole app — Drizzle columns,
Nest DTOs, and the web client's types all mirror it.

```ts
const IngredientGroup = z.object({
  heading: z.string().nullable(),   // null for the ungrouped default list
  items: z.array(z.string()),
})

export const ExtractedRecipe = z.object({
  is_recipe: z.boolean(),
  rejection_reason: z.string().nullable(),

  title: z.string(),
  description: z.string().nullable(),
  ingredients: z.array(IngredientGroup),
  steps: z.array(z.string()),
  notes: z.array(z.string()),
  origin: z.string().nullable(),

  servings: z.number().int().positive().nullable(),
  yield_text: z.string().nullable(),      // "24 cookies", when servings doesn't fit
  prep_minutes: z.number().int().positive().nullable(),
  cook_minutes: z.number().int().positive().nullable(),
  total_minutes: z.number().int().positive().nullable(),

  image_url: z.string().nullable(),       // the model's pick from the page
})
```

### 5.2 The prompt and the format contract

`extraction.prompt.ts` exports a frozen system prompt — a module constant with no
interpolation, which keeps it a stable cache prefix (§5.5) and keeps page content strictly
in the user turn, where it is data rather than instruction.

The rules the format guarantee rests on:

- **Never invent a value.** Anything the page doesn't state is `null` or an empty array.
  The single most important rule: a plausible fabricated oven temperature is worse than a
  missing one.
- **Extract only what is in the text below.** Stated explicitly, even though §1.1 already
  removes the motive.
- **Title**: the dish, title case, stripped of site branding, superlatives, and SEO
  padding. `"The BEST Ever Fluffy Pancakes! | Sally's Baking"` → `"Fluffy Pancakes"`.
- **Description**: 1–3 plain sentences about the dish. Not the author's childhood, not
  marketing copy. `null` if the page offers only a life story.
- **Ingredients**: one line each, `"<quantity> <unit> <item>, <prep>"`, units as written,
  fractions as `1/2` not `½`. Grouped only where the source groups them, using the source's
  own heading ("For the buttermilk substitute").
- **Steps**: imperative, present tense, one coherent action group each. No `"Step 4:"`
  prefixes, no numbering in the text — order is the array's job. Inline the source's
  timings and temperatures.
- **Notes**: substitutions, storage, make-ahead, equipment. One line each. Empty when the
  page has none; do not manufacture tips.
- **Origin**: only when the page explicitly states a cuisine, region, family, or
  publication of origin. Inferring "Italian" from the presence of basil is exactly the
  failure this rule prevents. `null` by default.

#### 5.2.1 The not-a-recipe discriminator

`is_recipe: boolean` is the schema's first field. Without it the model will dutifully
extract a "recipe" from a roundup page or a news article, because that is what it was
asked to do. When false, it fills `rejection_reason` with one sentence, every other field
is ignored, and `/recipes/find` moves to the next candidate rather than failing outright.

### 5.3 The call

```ts
const response = await this.client.messages.parse({
  model: RECIPE_MODEL,                    // the same constant — see §5.4
  max_tokens: 16000,
  system: [{ type: 'text', text: EXTRACTION_SYSTEM, cache_control: { type: 'ephemeral' } }],
  thinking: { type: 'adaptive' },
  output_config: {
    effort: 'low',
    format: zodOutputFormat(ExtractedRecipe, 'recipe'),
  },
  messages: [{ role: 'user', content: userTurn(page) }],
})
```

- **No `tools` array.** Not an omission — stage 2 has no business touching the network, and
  an empty tool set is what makes that unambiguous.
- `effort: 'low'`. Reading a page you were handed is routine. Raise it only if measurement
  shows a real failure rate.
- `max_tokens: 16000`, non-streaming. Output is one recipe; streaming buys nothing here and
  complicates the Nest handler.
- `parsed_output` is `null` when parsing fails. Guard it — a null there is a 502, not a
  crash.
- Check `stop_reason === 'refusal'` **before** reading content. Recipes are not a
  refusal-prone domain, so server-side `fallbacks` are deliberately not wired up: the
  `messages.parse()` helper is on the stable namespace and `fallbacks` on the beta one, and
  the complexity doesn't pay for itself. A refusal maps to 422.

The user turn is:

```
Source URL: <url>
Page title: <title>
Site: <siteName>

<cleaned text>
```

Page text goes last and carries no authority — the system prompt states that content inside
the page is data to extract from, never instructions to follow. A recipe blog containing
the words "ignore your previous instructions" gets extracted, not obeyed. **The user's
original request does not appear here** (§1.1).

### 5.4 What a find costs

Rough, and worth replacing with measurements:

| Stage | Tokens | At Opus 5 ($5/$25 per MTok) |
| --- | --- | --- |
| Discovery | search results + fetched pages in context, 15–40k in, 1–2k out | ~$0.10–0.25, **plus per-search charges** |
| Extraction | 4–15k in, 1–3k out | ~$0.10–0.20 |

So **roughly $0.25–0.50 per find**, and a pasted URL is the extraction row alone. Web search
is billed per search on top of tokens — check current pricing rather than trusting a number
written here.

**The model is hardcoded.** `api/src/apps/recipes/models.ts` exports a single
`RECIPE_MODEL = 'claude-opus-5'` that both stages import. It is not an env var, not a
request parameter, and not a user setting — changing models changes output quality in ways
only a prompt-and-eval pass can judge (§11.3's golden script), so it should be a commit,
not a config change someone makes at runtime.

`usage` from both stages is logged (input, output, cache read, model) so the table above
can be replaced with real numbers. If that ever argues for a cheaper extraction stage,
split the constant in two and commit that — the call sites already read from one module.

### 5.5 Caching

Each stage's system prompt plus schema is a stable prefix marked with `cache_control`, with
volatile content after it. Note both prompts are likely **under the minimum cacheable
prefix** (512–4096 tokens, model-dependent), in which case caching silently does nothing.
Check `usage.cache_read_input_tokens` on a second run before believing in it; zero is
expected and not worth chasing.

## 6. Persistence

### 6.1 Table

```ts
export const recipes = pgTable('recipes', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  ingredients: jsonb('ingredients').$type<IngredientGroup[]>().notNull().default([]),
  steps: jsonb('steps').$type<string[]>().notNull().default([]),
  notes: jsonb('notes').$type<string[]>().notNull().default([]),
  origin: text('origin'),

  servings: integer('servings'),
  yieldText: text('yield_text'),
  prepMinutes: integer('prep_minutes'),
  cookMinutes: integer('cook_minutes'),
  totalMinutes: integer('total_minutes'),

  imageFilename: text('image_filename'),     // relative to RECIPE_MEDIA_DIR
  imageMimeType: text('image_mime_type'),

  requestText: text('request_text'),         // what you typed, for the find path

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

`requestText` is the one provenance-ish field that stays, because it's about your intent
rather than the source: it's the input to the deferred "more like this" (§13) and it reads
well in the UI. Cut it too if you'd rather the record hold nothing but the recipe.

No indexes beyond the primary key. There is no duplicate check to support (§7.2) and the
list query is a single unfiltered `ORDER BY created_at DESC`.

#### `recipe_settings` — the standing preferences

```ts
export const recipeSettings = pgTable('recipe_settings', {
  id: integer('id').primaryKey().default(1),   // one row, always id 1
  preferences: jsonb('preferences').$type<string[]>().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

One row, because this is one person's recipe box and there is no user to key on. Lines
rather than one blob, so the UI can count them and the prompt can render them as bullets.
The migration creates the table, not the row, so `GET /recipes/settings` answers with the
empty default until the first save; the write is an upsert on `id`.

Nothing here is ever written onto a recipe: these are constraints on *searching* (§9.4).

### 6.2 Why `jsonb`, and what it costs later

Ingredients and steps are ordered lists, always read and written whole; reordering them in
child tables means rewriting every row's position. `jsonb` makes an edit one `UPDATE`.

The bill comes due for *lexical* lookup — "which recipes contain the literal string
miso" — which wants a GIN index plus a containment query, or a flattened
`recipe_ingredients` table. Both are additive migrations. Not v1.

It does **not** come due for the cook-from-my-pantry question (§13), and that is worth
being explicit about, because it's the case that looks like it argues for child tables and
doesn't. See §6.2.1.

#### 6.2.1 Why pantry matching doesn't change this

The planned *"I have tomatoes, chicken, and jasmine rice — do I have a recipe for this?"*
feature (§13) reads like a query problem and isn't one, at this scale.

The matching it needs is fuzzy in ways SQL is bad at: `tomatoes` must match *cherry
tomatoes*, `jasmine rice` must match *rice*, `chicken` must match *2 lbs boneless thighs*,
and a recipe needing nine things you don't have should rank below one needing two. A GIN
index gets lexical containment and none of that. Structured `{quantity, unit, item}`
columns would get a little closer and still miss the hypernyms.

A model call gets all of it, and a personal box is small enough to feed it whole:

| Box size | Ingredient text | Cost per query |
| --- | --- | --- |
| 200 recipes | ~30k tokens | ~$0.15 |
| 1000 recipes | ~150k tokens | ~$0.75 |

Against a 1M context window that holds to roughly 2–3k recipes before cost, not capacity,
forces a retrieve-then-rerank shape (cheap lexical prefilter for recall, model call to
rank). A personal recipe box does not get there.

`jsonb` is the better fit for that design, not merely an acceptable one: the input the
matcher wants is every recipe's ingredient text, which is one column read. Child tables
would mean joining and re-aggregating to rebuild what was already there.

Two things this does rely on, both already specified:

- **§5.2's format rules.** Because every ingredient is normalized to
  `<quantity> <unit> <item>, <prep>`, one per line, the matcher reads consistent input
  instead of each source site's markup. The house format earns its keep twice.
- **Nothing extra stored.** No pantry table, no staples list, no embeddings. Salt and olive
  oil being assumed-present is a judgment the model makes at query time, not a fact the
  schema needs to hold.

If the box ever does outgrow this, the fix is additive — a denormalized `ingredients_text`
column maintained app-side (a Postgres generated column can't flatten a nested `jsonb`
array, so don't plan on one) plus a full-text index, feeding the prefilter. That is a
migration, not a reshape.

### 6.3 Identifiers

The serial `id`, everywhere — routes, DTOs, and image filenames' correlation. `/recipes/42`.
No slug column, no slugify, no collision handling, and no chance of the identifier drifting
from a title that gets edited.

Route params parse with Nest's `ParseIntPipe`; a non-numeric `:id` is a 400 before the
service is reached, and a valid-but-absent one is a 404.

### 6.4 Tracing — what gets logged instead

Everything the record no longer holds goes to the log, at `info`, through a Nest `Logger`
with the context `RecipeTrace`. Every line carries `traceId` (a nanoid minted when the
request arrives) and, once known, `recipeId`, so a saved recipe can be walked back to the
page it came from.

| Event | Fields |
| --- | --- |
| `recipe.request` | `traceId`, `path` (`find` \| `scrape`), `requestText` or `url` |
| `recipe.discovery` | `traceId`, `interpretedAs`, `candidates[] {url, siteName, title, why}`, `groundingDropped[]` (§3.4), `usage` |
| `recipe.fetch` | `traceId`, `url`, `outcome` (`ok` \| status code \| `blocked` \| `timeout`), `via` (`fetch` \| `web_fetch`), `bytes`, `ms` |
| `recipe.pageText` | `traceId`, `url`, `chars`, `text` — **the full cleaned text extraction ran on** |
| `recipe.extraction` | `traceId`, `isRecipe`, `rejectionReason`, `title`, `usage`, `stopReason` |
| `recipe.saved` | `traceId`, `recipeId`, `sourceUrl`, `sourceName`, `imageSourceUrl`, `via` |
| `recipe.failed` | `traceId`, `stage`, `status`, `message` |

`recipe.pageText` is the verbose one: 3–15k characters per extraction, and on a find that
fires once per candidate attempted. That is the cost of having the source text to look at
when a recipe comes out wrong, which is the whole reason for logging it. If the volume
becomes a problem, that one event is the thing to drop — the rest is small.

These are the only records of where a recipe came from, so a log rotation policy that
discards them is also discarding the provenance (§1.3). Worth knowing before pointing this
at a log shipper with a short retention window.

Page text is logged as a structured field, never interpolated into the message string, so
a recipe page containing log-shaped text can't forge a line.

## 7. HTTP API

`api/src/apps/recipes/` — module, controller, service, plus `discovery.service.ts`,
`scrape.service.ts`, `extraction.service.ts`, `image.service.ts`. Registered in
`AppModule`, documented under a `recipes` Swagger tag like `apps` is.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| `POST` | `/recipes/find` | `{ request }` | `201` + `FindResultDto` |
| `POST` | `/recipes/scrape` | `{ url }` | `201` + `RecipeDto` |
| `POST` | `/recipes` | `CreateRecipeDto` | `201` + `RecipeDto` — hand-entered |
| `GET` | `/recipes` | — | `RecipeSummaryDto[]`, newest first |
| `GET` | `/recipes/:id` | — | `RecipeDto` |
| `PATCH` | `/recipes/:id` | `UpdateRecipeDto`, all fields optional | `RecipeDto` |
| `DELETE` | `/recipes/:id` | — | `204` |
| `PUT` | `/recipes/:id/image` | multipart, field `image` | `RecipeDto` |
| `DELETE` | `/recipes/:id/image` | — | `RecipeDto` |
| `GET` | `/recipes/:id/image` | — | bytes, `Cache-Control: public, max-age=31536000, immutable` |
| `GET` | `/recipes/settings` | — | `RecipeSettingsDto` — `{ preferences, updatedAt }` |
| `PUT` | `/recipes/settings` | `{ preferences: string[] }` | `RecipeSettingsDto` |

Both settings routes are declared **above** `GET /recipes/:id` in the controller: Nest
matches in declaration order, and the `:id` route would otherwise swallow `settings` and
400 on its `ParseIntPipe`.

`FindResultDto` is `{ recipe: RecipeDto, interpretedAs, why, alternates: Candidate[] }` —
the saved recipe plus the runners-up, so "try a different source" is one click and no
second discovery call.

`RecipeSummaryDto` is `{ id, title, description, origin, totalMinutes, hasImage }` —
enough for a card without shipping every step to the index page.

`UpdateRecipeDto` reuses the extraction Zod shapes (minus `is_recipe` and
`rejection_reason`), so a hand-edit can't put a record into a state the extractor couldn't
produce.

### 7.1 `/recipes/find` control flow

0. Read the standing preferences (§9.4) and hand them to discovery. They shape the search
   only: `requestText` on the row stays exactly what you typed.
1. Discovery (§3). 422 on not-food, empty observed set, or no surviving candidate.
2. For each candidate in rank order, up to 3: SSRF guard → fetch → clean → extract. On
   success, go to 4. On `is_recipe: false` or any fetch failure, log it and take the next.
3. All candidates exhausted → §4.3 fallback on the best candidate's `web_fetch` text; if
   that also fails, 422 with the list of what was tried.
4. Image (§8), insert, return `FindResultDto`.

Each attempt is logged with the URL and the reason it failed, because "why did it pick
that one" is the question you'll actually have.

### 7.2 Duplicates — there is no check

Dropping `source_url` (§1.3) removes the only thing a duplicate check could compare on, so
there isn't one. Asking for pancakes twice saves two pancake recipes, and re-pasting a URL
saves it again. Delete the extra by hand.

This is a real cost of the simpler record, not an oversight: it also means a find can spend
a full discovery call on a page already in the box. Restoring the check means storing a
`source_url`, or a hash of one, and §13 records that.

### 7.3 Error table

| Condition | Status | Message |
| --- | --- | --- |
| Empty or overlong request text | 400 | `Tell me what you'd like to cook.` |
| `is_food_request: false` | 422 | the model's `rejection_reason` |
| Observed set empty (§3.4 rule 2) | 422 | `Couldn't search for that. Try again.` |
| No candidate survived grounding, or all failed | 422 | `Couldn't find that one online.` |
| Malformed URL or non-HTTP scheme | 400 | `That doesn't look like a web address.` |
| Blocked by the SSRF guard | 400 | `That URL isn't reachable from the server.` |
| Fetch failed, timed out, or non-2xx | 502 | `Couldn't fetch that page (503 from example.com).` |
| Over 5 MB, or cleaned text over the char cap | 413 | `That page is too large to process.` |
| Non-HTML content type | 415 | `That link isn't a web page.` |
| Under 200 chars of readable text | 422 | `That page had no readable text — it may need JavaScript to render.` |
| `is_recipe: false` (pasted URL) | 422 | the model's `rejection_reason` |
| `stop_reason: "refusal"` | 422 | `Couldn't extract a recipe from that page.` |
| `parsed_output === null`, or the SDK threw | 502 | `The extraction service failed. Try again.` |

Every one renders verbatim in the UI, so they're written as user-facing copy, not log
lines.

## 8. Images

`image.service.ts`. Files live under `RECIPE_MEDIA_DIR` (default `api/var/media/recipes`,
gitignored).

The URL to try is the model's `image_url`, falling back to the page's `og:image`, resolved
against the canonical URL. Then:

1. Same SSRF guard and redirect limit as §4.1.
2. `Content-Type` must be `image/jpeg`, `image/png`, `image/webp`, `image/avif`, or
   `image/gif`, **and** the leading bytes must match it. A server claiming `image/png` over
   HTML gets dropped.
3. 10 MB cap, enforced while streaming.
4. Written as `<nanoid>.<ext>`; filename and mime type recorded. Never derive the filename
   from the remote URL — that's a path traversal waiting to happen.

**Failure here is never fatal.** A recipe with no picture saves fine and the card shows a
placeholder. A 404 on the hero image must not cost you the extraction you just paid for.

**Replacing** is `PUT /recipes/:id/image`, same type and size validation
(`FileInterceptor` from `@nestjs/platform-express`). The old file is deleted after the row
updates, never before.

No resizing or re-encoding in v1 — that means `sharp` and a native build headache for a
personal app. Deferred (§13).

## 9. Web

### 9.1 Routes

```
/recipes           -> RecipeListPage
/recipes/settings  -> SettingsPage
/recipes/$id       -> RecipePage
```

`/recipes/settings` is a static path, so it outranks `/recipes/$id` however the two are
ordered in the route tree.

Added to `web/src/router.tsx` in the existing code-based style. The home tile links to
`/recipes`, which needs a `recipebox` row in the `apps` table — a small seed migration,
since tiles come from `GET /apps`.

This app **does** use React Query (unlike Word Search, which derives everything from the
URL): `useQuery` for list and detail, `useMutation` + `invalidateQueries` for find, scrape,
patch, delete, and image upload. Fetch wrappers live in `web/src/apps/recipebox/api.ts`;
components never call `fetch` directly.

### 9.2 `/recipes` — the ask box

The top of the page is a single text input, wide, with placeholder *"give me a homemade
pancakes recipe"*, and an **Add** button. Enter submits.

**One box, two behaviours.** If the text parses as an http(s) URL, it posts to
`/recipes/scrape`; otherwise to `/recipes/find`. No mode toggle, no second field — pasting
a link just works, and the button label switches to *"Fetch"* on a detected URL so the
behaviour is visible before you commit.

**The pending state carries real weight here.** A find is two Opus calls plus a search loop
plus our own fetch: **plan for 30–60 seconds**, notably slower than the URL path. There is
no progress signal from a non-streaming call, so the button disables and a status line
advances on a timer through the stages we know it's in:

> Searching for pancake recipes… → Reading 3 pages… → Writing it up…

A silent 45-second hang reads as broken. This line is not decoration; it is the difference
between "working" and "hung".

On success the page navigates to the new recipe with a dismissible line: *"Found **Fluffy
Buttermilk Pancakes** on Serious Eats"* plus a **Try a different source** link that runs
the next alternate (§7.1) without a new discovery call.

Below the box, a card grid: image or placeholder, title, origin badge, total time. A
client-side filter box over title, origin, and ingredient text — a personal recipe box is
dozens of rows, not thousands, so no server search in v1. The empty state explains the ask
box rather than showing a blank grid.

### 9.3 `/recipes/$id`

View mode by default, with an **Edit** toggle that swaps the page into one form.

- Title, description, origin: text inputs / textarea.
- Ingredients: one textarea per group, one ingredient per line, plus an editable group
  heading and add/remove group buttons. Line-per-item is the fastest thing to hand-edit and
  round-trips to `string[]` with a `split('\n')`.
- Steps: same shape — a textarea, one step per line, blank lines dropped.
- Notes: same.
- Servings / yield / times: number and text inputs.
- Image: current image with **Replace** (file picker) and **Remove**.
- Provenance line: when `requestText` is set, *"Found for: give me a homemade pancakes
  recipe"*, shown in both modes. There is no link back to the source — it isn't stored
  (§1.3). The trace log is the only route back.

One **Save** (`PATCH` of changed fields only), one **Cancel** (discards, back to view).
Navigating away dirty prompts — TanStack Router's `onLeave` blocker plus a dirty check
against the loaded record.

**Delete** sits at the bottom of edit mode behind a confirm, styled as ordinary text with
`--danger` copy. Per the styleguide, red marks errors — it is not a destructive-action
color here, so delete gets no red button.

### 9.4 `/recipes/settings` — standing preferences

The things that are true every time you ask for a recipe — *"No tree nuts"*, *"I only have
a microwave"*, *"Nothing that takes more than 30 minutes"* — instead of retyping them into
every request.

One textarea, one preference per line, matching how steps and notes are edited on the
recipe form (§9.3). **Save** is a `PUT` of the whole list: what you leave out is what you
removed. Blank lines and surrounding space are dropped on save, and the cap is 20 — past
that the request is refused with the copy the page already shows. Leaving with unsaved
edits asks first, as the recipe form does.

They apply to the **find** path only. A pasted URL is read as-is, so the ask box shows the
line — *"Searching with your 2 preferences — No tree nuts, I only have a microwave"* — only
when what you typed isn't a URL, linking to this page. Preferences are visible where they
act, not only where they're set.

Nothing about them touches a saved recipe: not the record, not `requestText`, not the
edit form. They are a search-time constraint, and a recipe found under them is an ordinary
recipe afterwards.

### 9.5 Styling and print

`web/src/apps/recipebox/recipebox.css`, tokens from `web/src/index.css` only, no new raw
colors. Panels, inputs, and buttons follow styleguide §5. Ingredients and steps use the
sans stack, not mono — they're prose, not data.

Recipes get printed, so the `@media print` block isn't optional. Same contract as
`wordsearch.css` §6: force `#fff`/`#000`, hide the nav, the ask box, every control, and the
devtools. Print the image at a capped height, then ingredients and steps, `break-inside:
avoid` on each.

## 10. Config

| Var | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | Required. The recipes module refuses to boot without it. |
| `RECIPE_MEDIA_DIR` | `./var/media/recipes` | §8. Created at boot if missing. |
| `RECIPE_FETCH_TIMEOUT_MS` | `10000` | §4.1. |
| `RECIPE_MAX_PAGE_CHARS` | `250000` | §4.2. |
| `RECIPE_MAX_CANDIDATES` | `3` | §7.1. |

Added to `api/.env.example`. `ANTHROPIC_API_KEY` goes in `.env`, already gitignored —
confirm before the first commit.

## 11. Dependencies, files, tests

### 11.1 Dependencies

| Package | Where | Why |
| --- | --- | --- |
| `@anthropic-ai/sdk` | api | §3, §5 |
| `zod` | api | §3.2, §5.1 |
| `cheerio` | api | §4.2 |
| `nanoid` | api | §8 filenames |
| `@types/multer` | api (dev) | `FileInterceptor` types |

Nothing new in `web/` — TanStack Router and Query are both already there.

### 11.2 Files

```
api/src/
  database/schema.ts                        (modified: recipes table)
  database/migrations/000X_*.sql            (new: table + apps seed row)
  apps/recipes/
    recipes.module.ts                       (new)
    recipes.controller.ts                   (new)
    recipes.service.ts                      (new: orchestrates §7.1)
    discovery.service.ts                    (new: stage 1)
    discovery.prompt.ts                     (new)
    discovery.schema.ts                     (new)
    grounding.ts                            (new: §3.4)
    scrape.service.ts                       (new: fetch + clean)
    extraction.service.ts                   (new: stage 2)
    extraction.prompt.ts                    (new)
    extraction.schema.ts                    (new)
    image.service.ts                        (new)
    fetch-guard.ts                          (new)
    trace.ts                                (new: §6.4)
    settings.service.ts                     (new: §9.4, the standing preferences)
    dto/                                    (new: Recipe, RecipeSummary, FindResult, Create, Update)
  app.module.ts                             (modified)
api/.env.example                            (modified)

web/src/
  router.tsx                                (modified)
  apps/recipebox/
    api.ts                                  (new)
    types.ts                                (new)
    RecipeListPage.tsx                      (new)
    AskBox.tsx                              (new: §9.2, incl. the staged status line)
    RecipePage.tsx                          (new)
    RecipeForm.tsx                          (new)
    SettingsPage.tsx                        (new: §9.4)
    recipebox.css                           (new)
```

### 11.3 Tests

**No test may call the Anthropic API.** The client is injected and mocked; a real call in
CI is a bill and a flake.

- `grounding.test.ts` — **the important one.** Against recorded response fixtures: a
  candidate URL absent from every tool-result block is dropped; a response with no
  tool-result blocks at all fails closed; normalisation matches across `www.`, trailing
  slash, and `?utm_source=`; a `web_search_tool_result` whose `content` is an error object
  (not a list) doesn't throw.
- `discovery.prompt.test.ts` — the standing preferences go in the user turn and the system
  prompt stays free of them, so the cache prefix (§5.5) survives a settings edit.
- `recipes.service.test.ts` also covers the hand-off: the saved preferences reach
  discovery, an unset box sends an empty list, and neither changes `requestText`.
- `fetch-guard.test.ts` — a table of hostile URLs: `file://`, `http://127.0.0.1`,
  `http://169.254.169.254/`, `http://[::1]`, a hostname resolving to `10.x`, and a public
  URL redirecting to a private one. All rejected.
- `clean-html.test.ts` — against saved HTML fixtures in `__fixtures__/` (three or four real
  recipe pages, committed): chrome stripped, ingredient lines survive, `og:image` and
  canonical captured, the under-200-char case detected.
- `extraction.service.test.ts` — stubbed client: `is_recipe: false` → 422,
  `parsed_output: null` → 502, `stop_reason: 'refusal'` → 422, a good response → the right
  DTO.
- `recipes.service.test.ts` — the §7.1 walk: first candidate 403s and the second wins;
  first is `is_recipe: false` and the second wins; all three fail and the §4.3 fallback
  fires.
- `recipes.e2e-spec.ts` — find (both stages stubbed) → get → patch → delete, and a
  non-numeric `:id` rejected as 400 by `ParseIntPipe` before reaching the service.
- `trace.test.ts` — every stage emits its §6.4 event with a stable `traceId`, and page text
  lands in a structured field rather than the message string.
- `scripts/extract-golden.ts` — a manual script, **not in CI**, running the real prompts
  against the fixture pages and a handful of real requests, printing the output. This is
  how you check a prompt change actually improved anything. It costs real money and runs
  when you ask it to.

## 13. Deferred

- **Duplicate detection** — needs a stored `source_url`, or a hash of one, plus an index.
  Removed with attribution (§1.3, §7.2); this is the entry that brings it back if two
  pancake recipes annoy you.
- **Attribution on the record** — a `source_url` / `source_name` pair and a link in the UI.
  Required before anything here is shared or published, rather than kept privately.
- **Show the candidates before choosing** — a picker listing all three with titles and
  sites, instead of auto-taking the winner. The data is already in `FindResultDto`; this is
  UI only. Worth doing if auto-pick disappoints in practice.
- **Streaming the discovery stage** so the status line reports real progress ("searching",
  "opening seriouseats.com") instead of a timer. Meaningfully nicer at 45 seconds, and a
  real rework of the Nest handler into SSE.
- **Revisions** — a `recipe_revisions` table and restore UI. Re-running the source URL
  covers the common case.
- **Image processing** — `sharp` for resizing, a thumbnail derivative, EXIF stripping.
  Worth it once the media dir gets big or a phone photo goes in at 12 MP.
- **Cook from what I have** — *"I'm hungry tonight, I have tomatoes from the garden,
  chicken, and some jasmine rice. Do I have a recipe for this?"* Two halves: search the box
  first, and only if nothing fits, run discovery (§3) with an ingredients-led prompt and
  propose what it finds. The box half is a single model call over every recipe's ingredient
  text — **no schema change, see §6.2.1**. The online half is the existing discovery stage
  with a different prompt and a stricter bar for proposing rather than saving.
- **Recipe scaling** — "double this" *does* want the structured `{quantity, unit, item}`
  split §5.1 deliberately avoids. Unlike search, this one genuinely needs it: you cannot
  double `"1/2 cup buttermilk, shaken"` without parsing it. Separate problem, separate
  migration.
- **Lexical ingredient search** — "which recipes use miso", as a filter box rather than a
  question. Wants the GIN index from §6.2.
- **"More like this"** — `requestText` is stored for exactly this.
- **Tags and collections** — "weeknight", "John's", "to try".
- **Shared types package** — the schema is written once in `api` and mirrored by hand in
  `web/src/apps/recipebox/types.ts`. A `packages/shared` workspace removes the drift; worth
  doing the second app that needs it.
- **Paste-the-text fallback** — a textarea running extraction on text you pasted, for
  JS-rendered and paywalled pages §4.2 rejects.
