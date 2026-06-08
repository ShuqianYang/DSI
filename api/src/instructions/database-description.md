# Database Description

Model-visible catalog for SQL tool work. Pick the database alias, schema, and
table from this catalog, then use `SqlQuerySchema` to confirm exact column names
and foreign keys before writing `SqlQuery`.

**Workflow:** catalog table choice → `SqlQuerySchema` → `SqlQuery`.

Use `SqlQuerySchema` with the optional `table` parameter when the target table
is known:

```json
{"database":"default","schema":"agent_smoke","table":"incidents"}
```

If the target table is unknown, omit `table` to inspect the whole allowlisted
schema:

```json
{"database":"default","schema":"agent_smoke"}
```

If `artifact.path` is returned, the inline `rows` are a preview; use `Read` on
the path only when the full row set is needed.

---

## `default` / `agent_smoke`

Security incidents, monitored systems, and audit events.

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `incidents` | Incident records | `type`, `severity`, `owner`, `status`, `description`, `created_at`, `resolved_at` |
| `systems` | Monitored assets | `name`, `region`, `environment`, `owner_team`, `cpu_usage`, `memory_usage`, `disk_usage`, `uptime_hours` |
| `incident_systems` | M:N link `incidents ↔ systems` | `incident_id → incidents.id`, `system_id → systems.id`, `impact` |
| `audit_log` | Audit events | `event_type`, `actor`, `target`, `details` (jsonb), `created_at` |

## `default` / `retail_demo`

Sales and refunds. Two semantically different tables with overlapping column
names — choose the right table based on question intent.

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `sales_orders` | Sales transactions | `amount`, `quantity`, `region`, `sales_rep`, `order_date`, `status` (completed/pending/cancelled) |
| `refund_records` | Refund requests | `refund_amount`, `reason`, `processed_by`, `refund_date`, `status` (approved/pending/rejected), `original_order_id` |

**Disambiguation:**
- Revenue / 销售额 → `sales_orders.amount`
- Refunds / 退款 → `refund_records.refund_amount`
- Net income / 净收入 → combine both tables
