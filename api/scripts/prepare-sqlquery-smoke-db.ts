import "dotenv/config";
import { Client } from "pg";

const DEFAULT_LOCAL_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/datasource";

async function main() {
  const connectionString = process.env.SQLQUERY_TEST_DATABASE_URL
    || process.env.DATABASE_URL
    || DEFAULT_LOCAL_DATABASE_URL;

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("CREATE SCHEMA IF NOT EXISTS agent_smoke");

    // Drop old tables to ensure clean schema (safe in smoke environment)
    await client.query(`DROP TABLE IF EXISTS agent_smoke.test_abc CASCADE`);
    await client.query(`DROP TABLE IF EXISTS agent_smoke.incident_systems CASCADE`);
    await client.query(`DROP TABLE IF EXISTS agent_smoke.audit_log CASCADE`);
    await client.query(`DROP TABLE IF EXISTS agent_smoke.systems CASCADE`);
    await client.query(`DROP TABLE IF EXISTS agent_smoke.incidents CASCADE`);

    // Incidents table - security events
    await client.query(`
      CREATE TABLE agent_smoke.incidents (
        id serial primary key,
        type text not null,
        severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
        owner text,
        description text,
        status text not null default 'open' check (status in ('open', 'resolved', 'escalated')),
        created_at timestamptz not null default now(),
        resolved_at timestamptz
      )
    `);
    await client.query("TRUNCATE agent_smoke.incidents RESTART IDENTITY CASCADE");
    await client.query(`
      INSERT INTO agent_smoke.incidents (id, type, severity, owner, description, status, created_at, resolved_at) VALUES
        (1, 'intrusion', 'high', 'alpha', 'Unauthorized SSH access from 10.0.0.5', 'resolved', '2026-06-01T01:00:00Z', '2026-06-01T05:00:00Z'),
        (2, 'weather', 'medium', null, 'Severe weather alert: Hurricane approaching', 'open', '2026-06-01T02:00:00Z', null),
        (3, 'network', 'low', 'beta', 'Packet loss > 5% on core-01', 'resolved', '2026-06-01T03:00:00Z', '2026-06-02T01:00:00Z'),
        (4, 'intrusion', 'high', 'gamma', 'Brute force on admin panel', 'open', '2026-06-01T04:00:00Z', null),
        (5, 'data_breach', 'critical', 'alpha', 'Customer PII exposed in API response', 'escalated', '2026-06-02T00:00:00Z', null),
        (6, 'malware', 'high', 'delta', 'Ransomware detected on workstation-42', 'open', '2026-06-02T06:00:00Z', null),
        (7, 'ddos', 'medium', 'beta', 'Volume-based DDoS on edge-03', 'resolved', '2026-06-02T12:00:00Z', '2026-06-02T14:00:00Z'),
        (8, 'insider_threat', 'critical', 'gamma', 'Employee downloaded customer database', 'open', '2026-06-03T08:00:00Z', null),
        (9, 'phishing', 'low', 'epsilon', 'CEO fraud email campaign detected', 'resolved', '2026-06-03T10:00:00Z', '2026-06-03T11:00:00Z'),
        (10, 'vulnerability', 'high', 'alpha', 'CVE-2026-1234 in web framework', 'open', '2026-06-03T14:00:00Z', null),
        (11, 'misconfiguration', 'medium', 'beta', 'S3 bucket publicly readable', 'resolved', '2026-06-04T09:00:00Z', '2026-06-04T10:00:00Z'),
        (12, 'supply_chain', 'critical', 'delta', 'Compromised npm package in build', 'escalated', '2026-06-04T16:00:00Z', null)
    `);

    // Systems table - assets being monitored
    await client.query(`
      CREATE TABLE agent_smoke.systems (
        id serial primary key,
        name text not null,
        region text not null,
        environment text not null check (environment in ('prod', 'staging', 'dev')),
        owner_team text not null,
        cpu_usage numeric(5,2),
        memory_usage numeric(5,2),
        disk_usage numeric(5,2),
        uptime_hours int,
        last_check timestamptz default now()
      )
    `);
    await client.query("TRUNCATE agent_smoke.systems RESTART IDENTITY CASCADE");
    await client.query(`
      INSERT INTO agent_smoke.systems (name, region, environment, owner_team, cpu_usage, memory_usage, disk_usage, uptime_hours, last_check) VALUES
        ('core-01', 'us-east-1', 'prod', 'platform', 78.5, 82.3, 45.2, 2160, '2026-06-05T08:00:00Z'),
        ('core-02', 'us-east-1', 'prod', 'platform', 45.2, 60.1, 38.7, 2160, '2026-06-05T08:00:00Z'),
        ('core-03', 'us-west-2', 'prod', 'platform', 92.1, 95.4, 67.8, 1080, '2026-06-05T08:00:00Z'),
        ('edge-01', 'eu-west-1', 'prod', 'sre', 34.5, 42.0, 22.1, 4320, '2026-06-05T08:00:00Z'),
        ('edge-02', 'eu-west-1', 'prod', 'sre', 56.7, 58.3, 31.4, 4320, '2026-06-05T08:00:00Z'),
        ('edge-03', 'ap-south-1', 'prod', 'sre', 12.3, 25.6, 18.9, 720, '2026-06-05T08:00:00Z'),
        ('staging-01', 'us-east-1', 'staging', 'platform', 23.4, 30.2, 15.6, 240, '2026-06-05T08:00:00Z'),
        ('staging-02', 'us-east-1', 'staging', 'platform', 18.9, 22.1, 12.3, 240, '2026-06-05T08:00:00Z'),
        ('dev-01', 'us-east-1', 'dev', 'dev-infra', 5.2, 12.5, 8.7, 48, '2026-06-05T08:00:00Z'),
        ('db-primary', 'us-east-1', 'prod', 'dba', 65.3, 88.7, 72.4, 2160, '2026-06-05T08:00:00Z'),
        ('db-replica', 'us-west-2', 'prod', 'dba', 34.2, 55.1, 68.9, 2160, '2026-06-05T08:00:00Z'),
        ('cache-01', 'us-east-1', 'prod', 'platform', 45.6, 78.9, 12.3, 4320, '2026-06-05T08:00:00Z')
    `);

    // Incident-system mapping (many-to-many)
    await client.query(`
      CREATE TABLE agent_smoke.incident_systems (
        incident_id int references agent_smoke.incidents(id),
        system_id int references agent_smoke.systems(id),
        impact text,
        primary key (incident_id, system_id)
      )
    `);
    await client.query("TRUNCATE agent_smoke.incident_systems CASCADE");
    await client.query(`
      INSERT INTO agent_smoke.incident_systems (incident_id, system_id, impact) VALUES
        (1, 1, 'direct'),
        (1, 10, 'direct'),
        (3, 1, 'direct'),
        (3, 11, 'indirect'),
        (4, 1, 'direct'),
        (5, 10, 'direct'),
        (5, 11, 'direct'),
        (6, 3, 'direct'),
        (7, 6, 'direct'),
        (8, 10, 'direct'),
        (10, 1, 'direct'),
        (10, 2, 'indirect'),
        (12, 9, 'direct')
    `);

    // Audit log (large-ish table for limit/performance testing)
    await client.query(`
      CREATE TABLE agent_smoke.audit_log (
        id serial primary key,
        event_type text not null,
        actor text not null,
        target text,
        details jsonb,
        created_at timestamptz not null default now()
      )
    `);
    await client.query("TRUNCATE agent_smoke.audit_log RESTART IDENTITY CASCADE");
    // Generate 200 rows
    const auditEvents = [
      { type: 'login', actor: 'user_001', weight: 40 },
      { type: 'logout', actor: 'user_001', weight: 35 },
      { type: 'file_access', actor: 'user_002', weight: 30 },
      { type: 'permission_change', actor: 'admin_001', weight: 15 },
      { type: 'config_change', actor: 'admin_002', weight: 20 },
      { type: 'alert_ack', actor: 'oncall_001', weight: 25 },
      { type: 'incident_create', actor: 'system', weight: 10 },
      { type: 'incident_resolve', actor: 'oncall_002', weight: 10 },
      { type: 'api_call', actor: 'service_a', weight: 50 },
      { type: 'api_error', actor: 'service_b', weight: 20 },
    ];

    let auditValues: string[] = [];
    let auditId = 1;
    for (const evt of auditEvents) {
      for (let i = 0; i < evt.weight; i++) {
        const ts = new Date(Date.UTC(2026, 5, 1 + Math.floor(auditId / 40), Math.floor((auditId % 40) / 2), (auditId % 2) * 30));
        const detail = JSON.stringify({ ip: `10.0.${Math.floor(auditId / 256)}.${auditId % 256}`, session_id: `sess_${auditId}` });
        auditValues.push(`(${auditId}, '${evt.type}', '${evt.actor}', 'target_${auditId % 20}', '${detail}'::jsonb, '${ts.toISOString()}')`);
        auditId++;
      }
    }

    await client.query(`
      INSERT INTO agent_smoke.audit_log (id, event_type, actor, target, details, created_at) VALUES
      ${auditValues.join(', ')}
    `);

    // ============================================
    // retail_demo schema — semantic disambiguation test
    // ============================================
    await client.query("CREATE SCHEMA IF NOT EXISTS retail_demo");
    await client.query(`DROP TABLE IF EXISTS retail_demo.refund_records CASCADE`);
    await client.query(`DROP TABLE IF EXISTS retail_demo.sales_orders CASCADE`);

    await client.query(`
      CREATE TABLE retail_demo.sales_orders (
        id serial primary key,
        customer_name text not null,
        product_name text not null,
        amount numeric(10,2) not null,
        quantity int not null default 1,
        order_date timestamptz not null,
        region text not null,
        status text not null,
        sales_rep text
      )
    `);

    await client.query(`
      INSERT INTO retail_demo.sales_orders (customer_name, product_name, amount, quantity, order_date, region, status, sales_rep) VALUES
        ('Alice Wang', 'Laptop Pro X1', 12999.00, 1, '2026-06-01T09:00:00Z', 'east', 'completed', 'Tom'),
        ('Bob Chen', 'Wireless Mouse', 299.00, 2, '2026-06-01T10:30:00Z', 'north', 'completed', 'Tom'),
        ('Alice Wang', 'USB-C Hub', 599.00, 1, '2026-06-02T14:00:00Z', 'east', 'completed', 'Jerry'),
        ('Carol Liu', 'Monitor 4K', 3499.00, 2, '2026-06-02T16:00:00Z', 'south', 'completed', 'Jerry'),
        ('David Zhang', 'Keyboard Mechanical', 899.00, 1, '2026-06-03T09:00:00Z', 'west', 'pending', 'Tom'),
        ('Bob Chen', 'Laptop Pro X1', 12999.00, 1, '2026-06-03T11:00:00Z', 'north', 'completed', 'Jerry'),
        ('Eve Zhao', 'Webcam HD', 499.00, 3, '2026-06-04T10:00:00Z', 'east', 'completed', 'Tom'),
        ('Frank Li', 'SSD 2TB', 1599.00, 1, '2026-06-04T13:00:00Z', 'south', 'completed', 'Jerry'),
        ('Alice Wang', 'Monitor 4K', 3499.00, 1, '2026-06-05T09:00:00Z', 'east', 'completed', 'Tom'),
        ('Grace Wu', 'Laptop Pro X1', 12999.00, 1, '2026-06-05T15:00:00Z', 'west', 'cancelled', 'Jerry'),
        ('Carol Liu', 'USB-C Hub', 599.00, 2, '2026-06-01T08:00:00Z', 'south', 'completed', 'Tom'),
        ('David Zhang', 'Wireless Mouse', 299.00, 1, '2026-06-02T09:00:00Z', 'west', 'completed', 'Jerry')
    `);

    await client.query(`
      CREATE TABLE retail_demo.refund_records (
        id serial primary key,
        customer_name text not null,
        original_order_id int,
        refund_amount numeric(10,2) not null,
        refund_date timestamptz not null,
        reason text not null,
        status text not null,
        processed_by text
      )
    `);

    await client.query(`
      INSERT INTO retail_demo.refund_records (customer_name, original_order_id, refund_amount, refund_date, reason, status, processed_by) VALUES
        ('Alice Wang', 3, 599.00, '2026-06-03T10:00:00Z', 'defective', 'approved', 'Lisa'),
        ('Bob Chen', 2, 299.00, '2026-06-04T09:00:00Z', 'wrong_item', 'approved', 'Lisa'),
        ('Alice Wang', 9, 3499.00, '2026-06-06T09:00:00Z', 'customer_request', 'pending', 'Mike'),
        ('Carol Liu', 4, 3499.00, '2026-06-05T10:00:00Z', 'defective', 'approved', 'Lisa'),
        ('David Zhang', null, 899.00, '2026-06-04T14:00:00Z', 'late_delivery', 'rejected', 'Mike'),
        ('Eve Zhao', 7, 499.00, '2026-06-05T11:00:00Z', 'wrong_item', 'approved', 'Lisa'),
        ('Frank Li', 8, 1599.00, '2026-06-06T10:00:00Z', 'customer_request', 'pending', 'Mike'),
        ('Grace Wu', 10, 12999.00, '2026-06-06T12:00:00Z', 'defective', 'approved', 'Lisa')
    `);

    // Count rows for verification
    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM agent_smoke.incidents) as incidents,
        (SELECT COUNT(*) FROM agent_smoke.systems) as systems,
        (SELECT COUNT(*) FROM agent_smoke.incident_systems) as mappings,
        (SELECT COUNT(*) FROM agent_smoke.audit_log) as audit_logs,
        (SELECT COUNT(*) FROM retail_demo.sales_orders) as sales_orders,
        (SELECT COUNT(*) FROM retail_demo.refund_records) as refund_records
    `);

    console.log(
      JSON.stringify(
        {
          ok: true,
          databaseUrl: maskConnectionString(connectionString),
          schemas: {
            agent_smoke: {
              incidents: parseInt(counts.rows[0].incidents),
              systems: parseInt(counts.rows[0].systems),
              incident_systems: parseInt(counts.rows[0].mappings),
              audit_log: parseInt(counts.rows[0].audit_logs),
            },
            retail_demo: {
              sales_orders: parseInt(counts.rows[0].sales_orders),
              refund_records: parseInt(counts.rows[0].refund_records),
            },
          },
          smokeEnv: {
            DATABASE_URL: connectionString,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

function maskConnectionString(value: string): string {
  return value.replace(/:\/\/([^:@]+):([^@]+)@/, "://$1:***@");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
