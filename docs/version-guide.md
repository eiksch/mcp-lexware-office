# Version guide: v1 legacy tools and v2 Code Mode

This document explains the two MCP server entrypoints shipped by `mcp-lexware-office`, how they differ, and how users can migrate from v1 to v2.

## Current status

| Entrypoint | MCP server name | Status | Removal plan |
|---|---|---|---|
| `lexware-office` | `lexware-office` | Stable legacy v1 | Supported throughout the current major release. Planned for deprecation after v2 stabilizes and removal in the next major release. |
| `lexware-office-v2` | `lexware-office-v2` | Preview / planned successor | Intended to become the default server in the next major release. |

These are **two separate MCP servers in one package**. They do not route through each other. Your MCP client starts one binary or the other.

You can temporarily configure both during migration, for example:

```json
{
  "mcpServers": {
    "lexware-office-v1": {
      "command": "npx",
      "args": ["-y", "--package=github:JannikWempe/mcp-lexware-office#main", "lexware-office"],
      "env": { "LEXWARE_OFFICE_API_KEY": "YOUR_API_KEY_HERE" }
    },
    "lexware-office-v2": {
      "command": "npx",
      "args": ["-y", "--package=github:JannikWempe/mcp-lexware-office#v2", "lexware-office-v2"],
      "env": {
        "LEXWARE_OFFICE_API_KEY": "YOUR_API_KEY_HERE",
        "LEXWARE_OFFICE_READ_ONLY": "true"
      }
    }
  }
}
```

Running both is useful for comparison, but not recommended long term because the model may see overlapping capabilities.

## Distribution model

End users should consume `mcp-lexware-office` as a packaged Node MCP server, not by running TypeScript source files directly.

The package follows the standard TypeScript MCP layout:

- `bin` entries point to compiled JavaScript in `build/`.
- `files: ["build"]` keeps published tarballs small.
- `prepare` runs `npm run build` for GitHub installs, so `build/` does not need to be committed.

For GitHub preview installs, use an explicit GitHub package spec:

```json
"args": ["-y", "--package=github:JannikWempe/mcp-lexware-office#v2", "lexware-office-v2"]
```

After publishing to npm, use the npm package name instead:

```json
"args": ["-y", "--package=mcp-lexware-office", "lexware-office-v2"]
```

For local development only, after cloning the repo and installing dependencies, it is fine to run the TypeScript source with `tsx`:

```json
"args": ["-y", "tsx", "/absolute/path/to/mcp-lexware-office/src/v2/index.ts"]
```

## Why v2 exists

v1 grew as a collection of endpoint-shaped tools. That is approachable, but the tool list becomes large and still cannot cover every Lexware API edge case perfectly.

v2 uses a smaller tool surface:

1. `search` helps the model inspect a curated Lexware API catalog.
2. `execute` lets the model run a constrained API workflow using `lexware.request`.

This gives better coverage for:

- less common Lexware endpoints,
- multi-step reporting questions,
- pagination and aggregation,
- API behavior that needs catalog notes or examples,
- workflows that would otherwise require many narrowly shaped MCP tools.

## v1 model: endpoint-shaped tools

v1 exposes many direct tools. Examples:

```text
get-contacts
get-contact-details
create-contact
get-invoices
create-invoice
finalize-invoice
upload-file-to-voucher
list-event-subscriptions
```

This model is best when users want a visible list of fixed operations and client-side permissioning via disabled tool names.

Limitations:

- The tool list is large.
- Every API workflow requires a dedicated MCP tool.
- API coverage gaps need code changes.
- Tool-level permissioning works well, but can become cumbersome.

## v2 model: Code Mode

v2 exposes only two MCP tools.

### `search`

`search` runs a sandboxed JavaScript async arrow function against a curated OpenAPI-lite catalog in `src/v2/lexware-spec.ts`.

Example:

```js
async () => {
  return Object.entries(spec.paths)
    .flatMap(([path, methods]) =>
      Object.entries(methods).map(([method, op]) => ({
        method,
        path,
        summary: op.summary,
        tags: op.tags
      }))
    )
    .filter(op => op.tags.includes('contacts'));
}
```

The `search` sandbox receives only the catalog. It does not receive the Lexware API key, Node globals, filesystem access, `fetch`, imports, or arbitrary network access.

### `execute`

`execute` uses the same sandbox plus one host capability: `lexware.request`.

Example:

```js
async () => {
  const response = await lexware.request({
    method: 'GET',
    path: '/v1/contacts',
    query: { name: 'Muster', page: 0, size: 10 }
  });

  if (!response.ok) {
    return { status: response.status, errorCategory: response.errorCategory, data: response.data };
  }

  return response.data;
}
```

`lexware.request`:

- calls only relative `/v1/...` Lexware API paths,
- rejects absolute URLs and external hosts,
- hides the API key from sandboxed code,
- rate-limits host requests to 2 requests/second by default,
- returns JSON/text or binary metadata,
- adds operation metadata when the request matches the catalog,
- allows unknown `/v1/...` paths for API coverage gaps.

Useful helper methods are also exposed inside `execute`:

```ts
declare const lexware: {
  request<T = unknown>(input: LexwareRequest): Promise<LexwareResponse<T>>;
  json(input: LexwareRequest): Promise<unknown>;
  paginate<T = unknown>(input: LexwareRequest, options?: { maxPages?: number }): Promise<T[]>;
  requireNumber(row: unknown, fieldPath: string): number;
  requireMoney(row: unknown, fieldPath: string): number;
  sumMoney(rows: unknown[], fieldPath: string): number;
  formatMoney(cents: number, currency?: string): string;
};
```

## Binary-safe file uploads in v2

v2 supports two binary-safe upload modes in addition to the legacy `rawBody=true` string-based multipart.

### `bodyBase64` — raw binary body

Send a raw binary request body by base64-encoding it and setting `bodyBase64`. The host decodes the base64 outside the QuickJS sandbox and sends the raw bytes:

```js
async () => {
  // pdfBytes is a base64-encoded PDF string produced by the AI or fetched externally.
  const pdfBytes = 'JVBERi0x...'; // base64-encoded PDF
  const response = await lexware.request({
    method: 'POST',
    path: '/v1/files',
    bodyBase64: pdfBytes,
    contentType: 'application/pdf',
  });
  return response.data;
}
```

`contentType` defaults to `application/octet-stream` if not specified.

### `multipart` — binary-safe FormData

For multipart uploads (e.g. `/v1/files`, `/v1/vouchers/{id}/files`), pass a `multipart` array. Each part can supply either a plain string `value` or a `contentBase64` for binary content. The host decodes base64 and builds `FormData` with `Blob` parts outside the sandbox:

```js
async () => {
  const pdfBytes = 'JVBERi0x...'; // base64-encoded PDF
  const response = await lexware.request({
    method: 'POST',
    path: '/v1/files',
    multipart: [
      {
        name: 'file',
        filename: 'receipt.pdf',
        contentType: 'application/pdf',
        contentBase64: pdfBytes,   // decoded to binary Blob by the host
      },
      { name: 'type', value: 'voucher' },
    ],
  });
  return response.data;
}
```

Key constraints:
- `body`, `bodyBase64`, and `multipart` are mutually exclusive — set at most one per request.
- `contentBase64` and `value` are mutually exclusive within a single multipart part.
- GET requests may not include any body mode.
- Invalid base64 is rejected before the request is sent.

### Legacy `rawBody=true`

The original `rawBody=true` mode is preserved for backward compatibility. It sends a string body verbatim and is adequate for text-based multipart (e.g. manually constructed ASCII boundaries). It is **not** binary-safe for arbitrary byte sequences — use `bodyBase64` or `multipart` with `contentBase64` for true binary payloads.

## Permission models

### v1 permissions

v1 has many separate tools, so users can restrict access by disabling tool names in the MCP client.

| Tier | Allowed | Disable these tools |
|---|---|---|
| Read-only | All `get-*` and `list-*` tools | `create-*`, `update-*`, `delete-*`, `finalize-*`, `upload-*` |
| Draft mode | + create, update, delete, upload tools | `finalize-invoice`, `finalize-quotation`, `finalize-order-confirmation`, `finalize-credit-note`, `finalize-delivery-note`, `finalize-dunning` |
| Full access | All tools | _(nothing)_ |

Example v1 draft mode:

```json
{
  "mcpServers": {
    "lexware-office": {
      "command": "npx",
      "args": ["-y", "--package=github:JannikWempe/mcp-lexware-office#main", "lexware-office"],
      "env": { "LEXWARE_OFFICE_API_KEY": "YOUR_API_KEY_HERE" },
      "disabledTools": [
        "finalize-invoice",
        "finalize-quotation",
        "finalize-order-confirmation",
        "finalize-credit-note",
        "finalize-delivery-note",
        "finalize-dunning"
      ]
    }
  }
}
```

### v2 permissions

**v2 is read-only by default.** Because `execute` is a single powerful tool (not separate per-operation MCP tools), writes are blocked unless explicitly opted in.

To enable writes, set:

```json
{
  "LEXWARE_OFFICE_ALLOW_WRITES": "true"
}
```

`LEXWARE_OFFICE_READ_ONLY=true` is a hard block that overrides `ALLOW_WRITES=true`:

```json
{
  "LEXWARE_OFFICE_READ_ONLY": "true"
}
```

Priority order (highest wins):

1. `LEXWARE_OFFICE_READ_ONLY=true` → writes always blocked
2. `LEXWARE_OFFICE_ALLOW_WRITES=true` → writes allowed
3. Default (neither set) → writes blocked

When writes are blocked, v2 rejects `POST`, `PUT`, `PATCH`, and `DELETE` requests with a clear error message.

Important behavior:

- Default read-only mirrors how Cloudflare's OAuth scope template defaults to read-only; Lexware API keys have no equivalent OAuth scopes, so the MCP server provides the safety boundary.
- Writes should only be enabled when the user explicitly needs a write operation.
- The API key remains in the host process and is never exposed to sandboxed code.

## Migration guide

v2 is not a one-to-one rename of v1 tools. It changes the interaction pattern.

### Read operations

v1:

```text
Call get-contacts with name/page/size filters.
```

v2:

```js
async () => {
  return await lexware.json({
    path: '/v1/contacts',
    query: { name: 'Muster', page: 0, size: 10 }
  });
}
```

### Detail operations

v1:

```text
Call get-contact-details with an id.
```

v2:

```js
async () => {
  const contactId = '00000000-0000-0000-0000-000000000000';
  return await lexware.json({ path: `/v1/contacts/${contactId}` });
}
```

### Create/update operations

v1:

```text
Call create-contact or update-contact with the expected schema.
```

v2:

```js
async () => {
  const response = await lexware.request({
    method: 'POST',
    path: '/v1/contacts',
    body: {
      version: 0,
      roles: { customer: {} },
      company: { name: 'Muster GmbH' },
      addresses: {
        billing: [{ street: 'Musterstraße 1', zip: '12345', city: 'Musterstadt', countryCode: 'DE' }]
      }
    }
  });

  return { status: response.status, ok: response.ok, data: response.data };
}
```

### Reporting and aggregation

v1 often needs several separate tool calls and manual aggregation by the assistant.

v2 can perform pagination and aggregation inside one sandboxed execution:

```js
async () => {
  const rows = await lexware.paginate({
    path: '/v1/voucherlist',
    query: { voucherType: 'invoice', voucherStatus: 'paid', size: 100 }
  }, { maxPages: 5 });

  return {
    count: rows.length,
    totalAmount: lexware.formatMoney(lexware.sumMoney(rows, 'totalAmount'))
  };
}
```

## Deprecation policy for v1

The intended path is:

1. **Current 1.x releases**
   - v1 remains stable and supported.
   - v2 remains available as preview / planned successor.
   - Documentation encourages new evaluations to try v2 in read-only mode.

2. **v2 stabilization release**
   - v2 is declared stable.
   - v1 is marked deprecated.
   - v1 receives critical bug and security fixes only.
   - Documentation states the earliest removal version/date.

3. **Next major release**
   - v2 becomes the default `lexware-office` entrypoint.
   - legacy v1 is removed from the active release line.
   - users who still need v1 can pin the final `1.x` version.

A deprecation notice should include:

- the replacement (`lexware-office-v2`, later default `lexware-office`),
- the migration guide,
- the earliest removal version,
- the earliest removal date,
- what support v1 receives during the deprecation window.

Recommended minimum migration window: **6 months**. If the server has meaningful production usage, prefer **12 months**.

## v1 tool surface

The following table documents the legacy v1 tools. v2 users should use `search` to inspect catalog metadata and `execute` to call the corresponding `/v1/...` Lexware API path.

### Invoices

| Tool | Description | API |
|---|---|---|
| `get-invoices` | List invoice summaries with optional status filters | `GET /v1/voucherlist?voucherType=invoice` |
| `get-invoice-details` | Get details of a specific invoice | `GET /v1/invoices/{id}` |
| `create-invoice` | Create an invoice as a draft | `POST /v1/invoices` |
| `finalize-invoice` | Create and immediately finalize an invoice | `POST /v1/invoices?finalize=true` |

### Quotations

| Tool | Description | API |
|---|---|---|
| `get-quotations` | List quotation summaries with optional status filters | `GET /v1/voucherlist?voucherType=quotation` |
| `get-quotation-details` | Get details of a specific quotation | `GET /v1/quotations/{id}` |
| `create-quotation` | Create a quotation as a draft | `POST /v1/quotations` |
| `finalize-quotation` | Create and immediately finalize a quotation | `POST /v1/quotations?finalize=true` |

### Order confirmations

| Tool | Description | API |
|---|---|---|
| `get-order-confirmations` | List order-confirmation summaries with optional status filters | `GET /v1/voucherlist?voucherType=orderconfirmation` |
| `get-order-confirmation-details` | Get details of a specific order confirmation | `GET /v1/order-confirmations/{id}` |
| `create-order-confirmation` | Create an order confirmation as a draft | `POST /v1/order-confirmations` |
| `finalize-order-confirmation` | Create and immediately finalize an order confirmation | `POST /v1/order-confirmations?finalize=true` |

### Credit notes

| Tool | Description | API |
|---|---|---|
| `get-credit-notes` | List credit-note summaries with optional status filters | `GET /v1/voucherlist?voucherType=creditnote` |
| `get-credit-note-details` | Get details of a specific credit note | `GET /v1/credit-notes/{id}` |
| `create-credit-note` | Create a credit note as a draft | `POST /v1/credit-notes` |
| `finalize-credit-note` | Create and immediately finalize a credit note | `POST /v1/credit-notes?finalize=true` |

### Delivery notes

| Tool | Description | API |
|---|---|---|
| `get-delivery-notes` | List delivery-note summaries with optional status filters | `GET /v1/voucherlist?voucherType=deliverynote` |
| `get-delivery-note-details` | Get details of a specific delivery note | `GET /v1/delivery-notes/{id}` |
| `create-delivery-note` | Create a delivery note as a draft | `POST /v1/delivery-notes` |
| `finalize-delivery-note` | Create and immediately finalize a delivery note | `POST /v1/delivery-notes?finalize=true` |

### Dunning notices

| Tool | Description | API |
|---|---|---|
| `get-dunnings` | Helper explaining that listing dunnings is not supported by the API | — |
| `get-dunning-details` | Get details of a specific dunning notice | `GET /v1/dunnings/{id}` |
| `create-dunning` | Create a dunning notice for an existing invoice | `POST /v1/dunnings` |
| `finalize-dunning` | Alias for create-dunning | `POST /v1/dunnings?finalize=true` |

Note: The Lexware Office API always returns `voucherStatus: "draft"` for dunning notices regardless of the `finalize` parameter. This is expected API behavior; a PDF is generated immediately upon creation.

### Down-payment invoices

| Tool | Description | API |
|---|---|---|
| `get-down-payment-invoice-details` | Get details of a specific down-payment invoice | `GET /v1/down-payment-invoices/{id}` |

### Contacts

| Tool | Description | API |
|---|---|---|
| `get-contacts` | List contacts with optional filters | `GET /v1/contacts` |
| `get-contact-details` | Get details of a specific contact | `GET /v1/contacts/{id}` |
| `create-contact` | Create a new contact (customer or vendor) | `POST /v1/contacts` |
| `update-contact` | Update an existing contact | `PUT /v1/contacts/{id}` |

### Vouchers and bookkeeping

| Tool | Description | API |
|---|---|---|
| `get-vouchers` | List bookkeeping vouchers with optional filters | `GET /v1/voucherlist` |
| `get-voucher-details` | Get details of a specific voucher | `GET /v1/vouchers/{id}` |
| `create-voucher` | Create a bookkeeping voucher, such as an incoming invoice | `POST /v1/vouchers` |
| `update-voucher` | Update an existing bookkeeping voucher | `PUT /v1/vouchers/{id}` |
| `list-posting-categories` | List posting categories for bookkeeping | `GET /v1/posting-categories` |

### Articles

| Tool | Description | API |
|---|---|---|
| `get-articles` | List articles with optional filters | `GET /v1/articles` |
| `get-article-details` | Get details of a specific article | `GET /v1/articles/{id}` |
| `create-article` | Create a new article | `POST /v1/articles` |
| `update-article` | Update an existing article | `PUT /v1/articles/{id}` |
| `delete-article` | Delete an article | `DELETE /v1/articles/{id}` |

### Files and documents

| Tool | Description | API |
|---|---|---|
| `get-file` | Download a file by file ID | `GET /v1/files/{id}` |
| `get-document-file` | Download the PDF of a document by document ID; may require a rendered PDF first | `GET /v1/{docType}/{id}/file` |
| `upload-file` | Upload a file and receive a file ID | `POST /v1/files` |
| `upload-file-to-voucher` | Upload a file and attach it to a voucher | `POST /v1/vouchers/{id}/files` |

### Payments

| Tool | Description | API |
|---|---|---|
| `get-payments` | Get payment information for an invoice or voucher | `GET /v1/payments` |
| `get-payment-conditions` | List available payment conditions | `GET /v1/payment-conditions` |

### Recurring templates

| Tool | Description | API |
|---|---|---|
| `get-recurring-templates` | List recurring invoice templates | `GET /v1/recurring-templates` |

### Event subscriptions / webhooks

| Tool | Description | API |
|---|---|---|
| `list-event-subscriptions` | List all webhook event subscriptions | `GET /v1/event-subscriptions` |
| `get-event-subscription` | Get details of a specific event subscription | `GET /v1/event-subscriptions/{id}` |
| `create-event-subscription` | Create a new webhook event subscription | `POST /v1/event-subscriptions` |
| `delete-event-subscription` | Delete an event subscription | `DELETE /v1/event-subscriptions/{id}` |

### Company and reference data

| Tool | Description | API |
|---|---|---|
| `get-profile` | Get the company profile | `GET /v1/profile` |
| `list-countries` | List countries with tax classifications | `GET /v1/countries` |
| `list-print-layouts` | List available print layouts | `GET /v1/print-layouts` |
