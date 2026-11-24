# Invoice States Runbook (R1 → R4)

Plan: `docs/plans/2026-11-18-tasks-invoices-table-navigation.md` §2. Labels shown
to users: **Draft · Unpaid · Overdue · Paid · Void**. Stored values move from
`draft | pending | paid | void` to `draft | new | paid | void` over four separate
deploys. Never combine two phases in one deploy.

| Phase | Ships | Data step | Gate before the next phase |
| --- | --- | --- | --- |
| **R1 Expand** | `new` accepted everywhere (`pending ≡ new`); drafts become number-less templates; Issue / Duplicate; billed-month + due-date form; tenant-invisible drafts | `npm run migrate:invoice-indexes -- --apply` | All instances on R1; `count({status:"new"}) === 0`; V3 recorded |
| **R2 Backfill** | nothing (script only) | `npm run migrate:invoices -- --apply` | V1/V2/V3/V5 pass; draft/paid/void counts unchanged |
| **R3 Flip writers** | writers emit `new`; payment guards narrowed to `new` | — | no 400/ValidationError spike; V6 = 0 |
| **R2b Reconcile** | nothing | re-run `npm run migrate:invoices -- --apply` | `count({status:"pending"}) === 0` |
| **R4 Contract** | `pending` removed from enum, schemas, filters, UI | — | V1–V6 pass; 24h monitor |

## R1 deploy steps

1. **Before deploy:** dry-run the index script against the target DB (host only,
   never inside the app container; it reads `MONGODB_URI` from `.env.local`):

   ```bash
   npm run migrate:invoice-indexes
   ```

   It must report 0 duplicate issued numbers and 0 duplicate lease+month.
2. **Deploy R1.** Mongoose `autoIndex` builds the two new, explicitly named
   indexes (`invoiceNumber_issued_unique`, `leaseId_period_issued_unique`) next
   to the legacy ones.
3. **Right after deploy:** apply the index script. Until it runs, the legacy
   `invoiceNumber_1` index still treats `""` as a value, so only one draft
   template can exist at a time (a second one fails with "Could not reserve a
   unique invoice number").

   ```bash
   npm run migrate:invoice-indexes -- --apply
   ```

   The script creates any missing replacement index, drops `invoiceNumber_1`
   and `leaseId_1_period_1`, and verifies the result. It is idempotent.
4. **Verify:** create two drafts for the same lease and month (both succeed),
   issue one (gets a number), confirm the tenant sees only the issued invoice.
5. Record `count({status:"new"})` (must be 0 on R1) and V3 from
   `npm run migrate:invoices` (dry-run) for the R2 gate.

## Rollback

- **R1:** redeploy the previous image. The previous model declares
  `invoiceNumber` as required, so issue or delete any number-less drafts before
  rolling back. The replacement indexes are harmless to the old code; recreate
  the legacy indexes only once no number-less draft remains.
- **R2:** run the reverse update (`new → pending`) and verify `new === 0`.
  Take a `mongodump` of `invoices` before R2.
