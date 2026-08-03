# Use case: simple conciliation

Reconcile two transaction sources — an internal system export and a bank export — join them by user id + date, and visualize the result. Everything runs with the existing nodes: **2 file nodes, 1 script node, 2 SQL nodes, 1 visualization node**.

## Files

| File | Columns (all strings) | Loads into table |
|------|----------------------|------------------|
| `system_transactions.csv` | `user_id`, `transaction_date`, `amount` | `system_transactions` |
| `bank_movements.csv` | `monto`, `date`, `user_email` | `bank_movements` |

The bank file has no `user_id` column — instead `user_email` is encoded as `<id>:<email>` (e.g. `1001:alice@example.com`), so a transformation extracts the id before the join.

## Node graph

```
[File: system_transactions] ──────────────────────────────┐
                                                          ├──> [SQL: join] ──> [Viz: reconciliation]
[File: bank_movements] ──> [Script: validate + build SQL] ──> [SQL: transform] ──┘
```

Edges to create (drag from the right handle of a node to the left handle of the next):

1. `bank_movements` file node → script node
2. script node → transform SQL node
3. transform SQL node → join SQL node
4. `system_transactions` file node → join SQL node
5. join SQL node → viz node

Then press **Run all** (or run any node — it runs everything downstream of it).

## Step by step

### 1. File node — system transactions

Add a **File** node, choose `system_transactions.csv`. Set target table to `system_transactions`. Replace the default parser script with this one (disables papaparse's automatic type conversion so every column stays a string, which matters for the join later):

```js
return parseCsv(content, { dynamicTyping: false });
```

### 2. File node — bank movements

Add a second **File** node, choose `bank_movements.csv`. Target table: `bank_movements`. Same parser script:

```js
return parseCsv(content, { dynamicTyping: false });
```

### 3. Script node — validate emails + build the transform SQL

Add a **Script** node and connect the `bank_movements` file node into it. The script validates that every `user_email` follows the `<id>:<email>` format (failing the run if not), cleans up tables from previous runs, and returns the transformation SQL for the next node:

```js
// input = "bank_movements" (the upstream file node outputs its table name)
const table = input;

// validation: every user_email must look like "<digits>:<email>"
const bad = await query(
  `SELECT count(*)::int AS n FROM ${table} WHERE user_email !~ '^[0-9]+:'`
);
log("rows with malformed user_email:", bad[0].n);
if (bad[0].n > 0) {
  throw new Error(`${bad[0].n} rows have a malformed user_email — aborting`);
}

// make the workflow re-runnable
await query("DROP TABLE IF EXISTS bank_movements_enriched");
await query("DROP TABLE IF EXISTS reconciliation");

// build the SQL the next node will execute
return `CREATE TABLE bank_movements_enriched AS
SELECT split_part(user_email, ':', 1) AS user_id,
       date,
       monto,
       user_email
FROM ${table}`;
```

### 4. SQL node — apply the transformation

Add a **SQL** node and connect the script node into it. Its whole body is just the placeholder — it executes whatever SQL the script built:

```sql
{{input}}
```

After running, `bank_movements_enriched` has the new `user_id` column.

### 5. SQL node — join the two sources

Add a **SQL** node and connect **both** the `system_transactions` file node and the transform SQL node into it (the edges guarantee it runs after both tables exist):

```sql
CREATE TABLE reconciliation AS
SELECT s.user_id,
       s.transaction_date,
       s.amount  AS system_amount,
       b.monto   AS bank_amount,
       b.user_email,
       CASE
         WHEN b.user_id IS NULL   THEN 'missing_in_bank'
         WHEN s.amount = b.monto  THEN 'matched'
         ELSE 'amount_mismatch'
       END AS status
FROM system_transactions s
LEFT JOIN bank_movements_enriched b
  ON b.user_id = s.user_id
 AND b.date    = s.transaction_date
```

### 6. Visualization node — see the result

Add a **Visualization** node and connect the join SQL node into it:

```sql
SELECT * FROM reconciliation ORDER BY user_id, transaction_date
```

Run it and expand (⤢) for the full-screen table.

## Expected result

| user_id | transaction_date | system_amount | bank_amount | user_email | status |
|---------|------------------|---------------|-------------|------------|--------|
| 1001 | 2026-07-01 | 150.00 | 150.00 | 1001:alice@example.com | matched |
| 1001 | 2026-07-03 | 300.00 | 300.00 | 1001:alice@example.com | matched |
| 1002 | 2026-07-01 | 89.90 | 89.90 | 1002:bob@example.com | matched |
| 1003 | 2026-07-02 | 42.50 | 42.50 | 1003:carol@example.com | matched |
| 1004 | 2026-07-03 | 12.99 | ∅ | ∅ | missing_in_bank |

User `1005` appears only in the bank file, so it is dropped by the LEFT JOIN — swap to a `FULL OUTER JOIN` if you also want bank movements with no system counterpart.

## Why each node type is involved

- **File nodes** parse the CSVs with a parser script and load them into PGlite tables.
- The **script node** does what SQL alone can't express as cleanly: validate a format with a clear error, prepare idempotent re-runs, and *build* SQL dynamically for a downstream SQL node (via its return value + `{{input}}`).
- **SQL nodes** execute the transformation and the join against PGlite.
- The **visualization node** renders the final table.
