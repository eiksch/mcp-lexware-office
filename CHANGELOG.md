# Changelog

## [1.9.0](https://github.com/eiksch/mcp-lexware-office/compare/v1.8.0...v1.9.0) (2026-07-13)


### Features

* add billing address fields to update-contact tool ([a47a8c2](https://github.com/eiksch/mcp-lexware-office/commit/a47a8c219963d67367b1cb7a377eca14764302d0))
* add create-article, update-article, delete-article tools ([5518bff](https://github.com/eiksch/mcp-lexware-office/commit/5518bffc9a034cd1697ddcbb582e5d4844653f4a))
* add create-contact and update-contact tools ([30b7e97](https://github.com/eiksch/mcp-lexware-office/commit/30b7e97b501ebe2755944f31d9346bf8e622fbdf))
* add create-credit-note and finalize-credit-note tools ([59057c9](https://github.com/eiksch/mcp-lexware-office/commit/59057c9b8e1c7f38fd9d5b70753064938fb2fc24))
* add create-delivery-note and finalize-delivery-note tools ([cd5b48b](https://github.com/eiksch/mcp-lexware-office/commit/cd5b48b3cd16f94e37250ca28232656fbca11bfd))
* add create-dunning and finalize-dunning tools ([1a81149](https://github.com/eiksch/mcp-lexware-office/commit/1a8114909bacc23b926edf6445c0bef22c1ae939))
* add create-invoice and finalize-invoice tools ([ac20d41](https://github.com/eiksch/mcp-lexware-office/commit/ac20d4122658f2828c67e62693c091857eccb56e))
* add create-order-confirmation and finalize-order-confirmation tools ([f063134](https://github.com/eiksch/mcp-lexware-office/commit/f06313446ddba92663378129c7820b7e12a3a00f))
* add create-quotation and finalize-quotation tools ([6df3107](https://github.com/eiksch/mcp-lexware-office/commit/6df310756c389b08dbd199613664290570dc6585))
* add create-voucher and update-voucher tools ([d7b7947](https://github.com/eiksch/mcp-lexware-office/commit/d7b79473d4f98d90e352c511990f3904f77e1e70))
* add duplicateVoucher workflow to v2 spec ([66004e0](https://github.com/eiksch/mcp-lexware-office/commit/66004e0d53a92b9e2ee7fb32145e205294462c34))
* add event subscription tools (list, get, create, delete) ([a6b9f0d](https://github.com/eiksch/mcp-lexware-office/commit/a6b9f0d991e3db82e84c84a4be0a3edb74c05bf5))
* add fetchAll mode to get-contacts for sequential auto-pagination ([eee29d1](https://github.com/eiksch/mcp-lexware-office/commit/eee29d1d2e1aa468dc41df865b3eda506862f2f7))
* add full integration test suite + bump to v1.0.0 ([d02a35c](https://github.com/eiksch/mcp-lexware-office/commit/d02a35cbfe8986aa8a5085fd49278bd51f2096f6))
* add get-contact-details tool ([9c9ef91](https://github.com/eiksch/mcp-lexware-office/commit/9c9ef918300115860d2ef2bddfe1cb3966f694b0))
* add get-credit-notes and get-credit-note-details tools ([54d3477](https://github.com/eiksch/mcp-lexware-office/commit/54d3477433487a4fb5db7aedbe998dbcb22e44f4))
* add get-document-file tool for direct PDF download by document ID ([435668f](https://github.com/eiksch/mcp-lexware-office/commit/435668f6570cc49953f105e4e83b2d07e0193602))
* add get-down-payment-invoice-details, get-profile, list-print-layouts tools ([838a294](https://github.com/eiksch/mcp-lexware-office/commit/838a2947f6ac203c059e47b3abbb09ed5cc3532e))
* add get-down-payment-invoices + exclude docs/ from tracking ([54d2474](https://github.com/eiksch/mcp-lexware-office/commit/54d2474a64cdcaac47c7af34ad9c4e93e80c1e88))
* add get-dunnings and get-dunning-details tools ([e6713bd](https://github.com/eiksch/mcp-lexware-office/commit/e6713bd4c69a789937fdbf783d84540333406b5f))
* add get-file tool to download PDF and XML files ([aa2e4ce](https://github.com/eiksch/mcp-lexware-office/commit/aa2e4ce898d456a8d945d8e81af37b1199154f80))
* add get-file tool to download PDF and XML files from Lexware Office ([998b4a3](https://github.com/eiksch/mcp-lexware-office/commit/998b4a3a2c56655a5db424ee411f4bb6c89c8903))
* add get-open-receivables tool + contactId filters + improve descriptions ([d679301](https://github.com/eiksch/mcp-lexware-office/commit/d6793016372be6b5a923c65af5cddea3d8b6df56))
* add get-order-confirmations and get-delivery-notes tools ([e07c18d](https://github.com/eiksch/mcp-lexware-office/commit/e07c18d6cead4efb5a880363374317fbc50056ed))
* add get-payments and get-payment-conditions tools ([5712ee9](https://github.com/eiksch/mcp-lexware-office/commit/5712ee94bd64665290aceb081effc95fbf1a64aa))
* add get-quotations and get-quotation-details tools ([4d5cbcd](https://github.com/eiksch/mcp-lexware-office/commit/4d5cbcdd745271b348818978a1623b3b466253cf))
* add get-recurring-templates, get-articles, get-article-details tools ([cdfb2d2](https://github.com/eiksch/mcp-lexware-office/commit/cdfb2d2a572709c06bf13e8d1e8c66e8bd012006))
* add get-vouchers and get-voucher-details tools ([6480be5](https://github.com/eiksch/mcp-lexware-office/commit/6480be5c940f3be7b15699a5b348101ba9ee8f45))
* add get-vouchers and get-voucher-details tools ([f45d16d](https://github.com/eiksch/mcp-lexware-office/commit/f45d16d66479dbd160216ce3bd3c4405f74478b1))
* add get-vouchers and get-voucher-details tools ([167da50](https://github.com/eiksch/mcp-lexware-office/commit/167da50f5a19cbaf01054ac412da9d20c159594d))
* add makeLexwareOfficeFileRequest helper for binary file downloads ([90e26eb](https://github.com/eiksch/mcp-lexware-office/commit/90e26eb791811cf9b871c0af6afe49e505ed167f))
* add makeLexwareOfficeWriteRequest helper and bump version to 0.3.0 ([88328a8](https://github.com/eiksch/mcp-lexware-office/commit/88328a8c32638ad49897aebc61cea1fc24a577da))
* add upload-file and upload-file-to-voucher tools ([5eb855b](https://github.com/eiksch/mcp-lexware-office/commit/5eb855b6348584e5f762148220eba0d1c7308818))
* add voucherNumber filter to get-vouchers; reduce default size to 50 ([2242107](https://github.com/eiksch/mcp-lexware-office/commit/2242107eb2f0dd9c01268ca88a6e9a4fa41234de))
* add voucherStatus to create/update-voucher; document §13b Reverse Charge pattern ([562fc85](https://github.com/eiksch/mcp-lexware-office/commit/562fc85a0d0de71e7d6afc0cbce9be7b2c62c4e6))
* auto-preserve file attachments in update-voucher ([7c11559](https://github.com/eiksch/mcp-lexware-office/commit/7c11559011fc4b8e70729160ee5760cee875a354))
* complete Lexware Office API coverage — 53 tools ([a7b6858](https://github.com/eiksch/mcp-lexware-office/commit/a7b6858d0f2a41e272baa8bb8b9be7d2c178b5a2))
* contentPath uploads, discoverable multipart docs, upload hardening in v2 ([86d8260](https://github.com/eiksch/mcp-lexware-office/commit/86d826002529494f44c7afc2b3ccefe5c7981ce3))
* expand contacts + receivables + pagination fix + fetchAll + upload fix + schema fixes ([071c6fb](https://github.com/eiksch/mcp-lexware-office/commit/071c6fb8447ca2c0c4fe649b5a1304372e306324))
* expand create-contact with addresses, email, phone, contactPersons ([3f4baae](https://github.com/eiksch/mcp-lexware-office/commit/3f4baaea097a45bf3b6a874c6fe14fee90fe6378))
* expand update-contact with shipping, email, phone, contactPersons ([a90878d](https://github.com/eiksch/mcp-lexware-office/commit/a90878dcee5b9a21a98c0c16446a23c81d2e09f0))
* version 2 using search and execute tools only ([9a15365](https://github.com/eiksch/mcp-lexware-office/commit/9a153651146cf30528f2f973975c010c7df2c5cc))
* Wave 2 — Quotation, Credit Note, Order Confirmation, Delivery Note, Article CRUD (v0.5.0) ([999e1e5](https://github.com/eiksch/mcp-lexware-office/commit/999e1e58ae59b4b0bc2e8a8d00c416fdafd0eaf9))
* Wave 3 — 10 new API tools + 2 bug fixes (v0.6.0) ([398eb26](https://github.com/eiksch/mcp-lexware-office/commit/398eb26a3ce92ea4e350a9f457ecde85e19baa1f))


### Bug Fixes

* 406 non-error in get-payments; boolean vendor/customer in contacts ([e727add](https://github.com/eiksch/mcp-lexware-office/commit/e727add1da08a31d7a56ef369aec7f7c65474bd6))
* add paymentTermLabel to invoiceSchema (was stripped by Zod) ([535aaac](https://github.com/eiksch/mcp-lexware-office/commit/535aaac846a70973f89dd94d316ef6c07fd1bc4d))
* add taxConditions to delivery note schema (required by Lexoffice API) ([36701cd](https://github.com/eiksch/mcp-lexware-office/commit/36701cd0ef07ed89c6707c8422f1aeb5aee3ee43))
* correct API contracts for invoice, dunning, voucher and contact tools ([e299ccc](https://github.com/eiksch/mcp-lexware-office/commit/e299ccca8fffd1d0e8f19e35ce34dd70f535b9c8))
* correct article API field names (title, price) per Lexoffice API spec ([d85484b](https://github.com/eiksch/mcp-lexware-office/commit/d85484be087598b254c252cd767f19f81ec0e022))
* correct indentation in credit notes tools ([5b8582d](https://github.com/eiksch/mcp-lexware-office/commit/5b8582d74dfafc973cf771035fd020015ba919dc))
* correct lineItem discriminated union schemas and paymentTermLabel guard ([659f53b](https://github.com/eiksch/mcp-lexware-office/commit/659f53b6e0bf1d4914349e122693d68e4b7b619f))
* correct v2 catalog against official Lexware docs ([50ea11e](https://github.com/eiksch/mcp-lexware-office/commit/50ea11e2d2afa9b724d863ceea7e8e294c45172e))
* flatten contact roles/company/person params and fix get-payments endpoint ([109d0c2](https://github.com/eiksch/mcp-lexware-office/commit/109d0c2d36158054dce1317fd7072e87a7e7204a))
* forward page/size params in get-invoices (closes [#9](https://github.com/eiksch/mcp-lexware-office/issues/9)) ([1885e2a](https://github.com/eiksch/mcp-lexware-office/commit/1885e2a0710dd217df4491f3c4ff9267d5bd4c4e))
* include docs in package and align v2 docs ([826d7d4](https://github.com/eiksch/mcp-lexware-office/commit/826d7d4e9e484ec38aaf7b40fe8a4b50d329c4be))
* migrate API base URL to api.lexware.io, update user-agent, deprecate documentFileId in get-file ([c475a0f](https://github.com/eiksch/mcp-lexware-office/commit/c475a0fdf9060ef1b4a9da40192b55a192558cac))
* PR [#10](https://github.com/eiksch/mcp-lexware-office/issues/10) Cloudflare follow-ups (safety, hygiene, docs, binary uploads) ([3632f62](https://github.com/eiksch/mcp-lexware-office/commit/3632f62e76f74c65b028883eebf26a28e2e9c0ae))
* PR [#10](https://github.com/eiksch/mcp-lexware-office/issues/10) pre-merge fixes ([1f0c3c5](https://github.com/eiksch/mcp-lexware-office/commit/1f0c3c5ff257230fea5b2317ec6b5f3eddf1db21))
* PR [#10](https://github.com/eiksch/mcp-lexware-office/issues/10) review issues (sandbox lifecycle, strict money parsing, binary handling) ([1d4cd20](https://github.com/eiksch/mcp-lexware-office/commit/1d4cd20c7c9a76dfb2029589c8b1a8a09b6bc97b))
* replace fileContentBase64 with filePath in upload-file tool ([d018675](https://github.com/eiksch/mcp-lexware-office/commit/d0186750181fc7611ab9620e52040743607b6f8d))
* replace fileContentBase64 with filePath in upload-file-to-voucher; warn on update-voucher file loss ([bfd60f4](https://github.com/eiksch/mcp-lexware-office/commit/bfd60f417ff1a4f07b5ad61c7e5f87aa3d2eafa8))
* restrict get-dunnings status to valid values (draft, open) for dunning voucherlist ([3d4d060](https://github.com/eiksch/mcp-lexware-office/commit/3d4d0601902e7358bc172ea9aecd68762a35774d))
* serialize tests + retry on 429 + get-dunnings reflects API limitation ([32f0217](https://github.com/eiksch/mcp-lexware-office/commit/32f0217e32dd407f6b71964151259fc1e37cb581))
* simplify writeErrorResponse call sites and improve handler param types ([469e7a2](https://github.com/eiksch/mcp-lexware-office/commit/469e7a2935736ce518e51f94354a8aae11ffd16e))
* stale api.lexoffice.io URL in get-payments; abort update-voucher if pre-fetch fails ([9eccf1e](https://github.com/eiksch/mcp-lexware-office/commit/9eccf1ec39eba843cc19ca8171fa44846f905491))
* support deviated address, language and title on sales document schemas ([119dadb](https://github.com/eiksch/mcp-lexware-office/commit/119dadbfa9dff57676fe747223aade0a1773d642))
* sync lockfile and cleanup docs ([9b48e6d](https://github.com/eiksch/mcp-lexware-office/commit/9b48e6df99b0ecd28fab7a7347946a076f4ec94f))
* wire page and size params to get-contacts API call ([403576c](https://github.com/eiksch/mcp-lexware-office/commit/403576c0aa4e7d435f4523c78e76dc10f6295396))

## [1.8.0](https://github.com/JannikWempe/mcp-lexware-office/compare/v1.7.0...v1.8.0) (2026-07-09)


### Features

* contentPath uploads, discoverable multipart docs, upload hardening in v2 ([86d8260](https://github.com/JannikWempe/mcp-lexware-office/commit/86d826002529494f44c7afc2b3ccefe5c7981ce3))


### Bug Fixes

* correct v2 catalog against official Lexware docs ([50ea11e](https://github.com/JannikWempe/mcp-lexware-office/commit/50ea11e2d2afa9b724d863ceea7e8e294c45172e))

## [1.7.0](https://github.com/JannikWempe/mcp-lexware-office/compare/v1.6.0...v1.7.0) (2026-07-09)


### Features

* add duplicateVoucher workflow to v2 spec ([66004e0](https://github.com/JannikWempe/mcp-lexware-office/commit/66004e0d53a92b9e2ee7fb32145e205294462c34))


### Bug Fixes

* support deviated address, language and title on sales document schemas ([119dadb](https://github.com/JannikWempe/mcp-lexware-office/commit/119dadbfa9dff57676fe747223aade0a1773d642))
