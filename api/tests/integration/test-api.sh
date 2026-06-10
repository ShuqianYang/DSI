#!/bin/bash
set -e

API_URL="${API_URL:-http://localhost:3001}"

echo "===== API 健康检查 ====="
curl -s "$API_URL/health" | head -100
echo ""

echo "===== 测试1: 创建任务（海域态势分析） ====="
TASK_RESPONSE=$(curl -s -X POST "$API_URL/tasks" \
  -H "Content-Type: application/json" \
  -d '{"query": "分析东海海域当前船舶态势，识别异常行为"}')
echo "$TASK_RESPONSE" | head -200

echo ""
echo "===== 提取 taskId ====="
TASK_ID=$(echo "$TASK_RESPONSE" | grep -oP '"taskId"\s*:\s*"\K[^"]+')
if [ -z "$TASK_ID" ]; then
  echo "创建任务失败，无法提取 taskId"
  exit 1
fi
echo "taskId: $TASK_ID"

echo ""
echo "===== 测试2: 查询任务（创建后立即查询，应为 pending） ====="
sleep 0.5
curl -s "$API_URL/tasks/$TASK_ID" | head -300
echo ""

echo ""
echo "===== 等待 Worker 执行（3秒） ====="
sleep 3

echo ""
echo "===== 测试3: 再次查询任务（应为 completed） ====="
FINAL_RESULT=$(curl -s "$API_URL/tasks/$TASK_ID")
echo "$FINAL_RESULT" | head -500
echo ""

echo ""
echo "===== 提取执行状态 ====="
STATUS=$(echo "$FINAL_RESULT" | grep -oP '"status"\s*:\s*"\K[^"]+')
echo "最终状态: $STATUS"

if [ "$STATUS" = "completed" ]; then
  echo "✅ 测试通过"
elif [ "$STATUS" = "failed" ]; then
  echo "❌ 任务执行失败"
else
  echo "⏳ 任务仍在执行中，状态: $STATUS"
fi
