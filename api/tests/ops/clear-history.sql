-- 清空历史数据（按外键依赖顺序）
-- 先删子表/关联表，再删父表

DELETE FROM events;
DELETE FROM task_steps;
DELETE FROM insights;
DELETE FROM job_tasks;
DELETE FROM tasks;

-- 如果也想清空订阅和需求（可选）
-- DELETE FROM subscriptions;
-- DELETE FROM requirements;
