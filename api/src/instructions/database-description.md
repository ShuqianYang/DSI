# Database Description

This file is model-visible context for Agent Loop SQL work. It describes which
database aliases and schemas are useful for user tasks. It is not a full schema
dump; use `SqlQuerySchema` to discover exact table and column names before
writing a `SqlQuery`.

## SQL Tool Workflow

1. Choose the database alias and schema from this catalog.
2. Call `SqlQuerySchema` for the selected schema.
3. Use returned `foreignKeys` to choose JOIN paths instead of guessing table
   relationships.
4. Build a bounded read-only `SqlQuery` using only returned tables and columns.
   Use `limit` and `offset` together for pagination.
5. Prefer summary queries first. Use detail queries only when the user asks for
   specific rows, examples, or investigation detail.
6. If `SqlQuery` returns an `artifact.path`, treat inline `rows` as a preview.
   Use `Read` on that path only when the full row set is needed for the task.

## Catalog

### `default` / `agent_smoke`

Use for smoke-test and demo questions about security incidents, monitored
systems, affected assets, and audit events.

Tables:

- `incidents`: Security incident records. Useful for questions about incident
  type, severity, owner, status, descriptions, creation time, and resolution
  time.
- `systems`: Monitored infrastructure assets. Useful for questions about
  systems, regions, environments, owner teams, CPU/memory/disk utilization,
  uptime, and last check time.
- `incident_systems`: Many-to-many relationship between incidents and affected
  systems. Useful for impact analysis and joining incidents to systems.
- `audit_log`: Synthetic audit events. Useful for testing bounded queries,
  event type distributions, actors, targets, JSONB details, and time windows.

### `default` / `retail_demo`

Use for retail business analysis questions involving sales, refunds, revenue,
and customer behavior. Two tables with semantically different purposes but some
overlapping column names (e.g. `customer_name`, `status`). Model must choose
the correct table based on the user's question intent.

Tables:

- `sales_orders`: Completed and pending sales transactions. Useful for
  questions about total revenue, sales by region, product popularity,
  sales representative performance, and order trends. Key columns:
  `amount` (order total), `region`, `sales_rep`, `order_date`, `status`.
- `refund_records`: Customer refund requests and approvals. Useful for
  questions about refund volume, refund reasons, processed refunds, and
  customer return behavior. Key columns: `refund_amount`, `reason`,
  `processed_by`, `refund_date`, `status`, `original_order_id`.

**Important disambiguation:**
- Questions about "销售额/收入/revenue" → use `sales_orders.amount`
- Questions about "退款/refunds" → use `refund_records.refund_amount`
- Questions about "净收入/net income" → combine both tables
- `status` in `sales_orders` means order status (completed/pending/cancelled)
- `status` in `refund_records` means refund approval status (approved/pending/rejected)

Default query pattern:

```json
{"database":"default","schema":"agent_smoke"}
```

or

```json
{"database":"default","schema":"retail_demo"}
```
