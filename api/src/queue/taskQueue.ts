import { Queue, Worker, type Job } from "bullmq";
import { redisConnection, redisPublisher } from "../config/redis.js";
import { executorService } from "../modules/executor/service.js";

export const TASK_QUEUE_NAME = "task-execution";
export const SSE_CHANNEL = "task:updates";

export const taskQueue = new Queue(TASK_QUEUE_NAME, {
  connection: redisConnection,
});

interface ExecuteJobData {
  taskId: string;
  jobTaskId?: string;
}

export const taskWorker = new Worker<ExecuteJobData>(
  TASK_QUEUE_NAME,
  async (job: Job<ExecuteJobData>) => {
    const { taskId, jobTaskId } = job.data;
    console.log(`[Worker] Executing task ${taskId}, job ${job.id}, jobTaskId=${jobTaskId || "none"}`);
    await executorService.run(taskId, jobTaskId);
    console.log(`[Worker] Task ${taskId} completed`);
  },
  {
    connection: redisConnection,
    concurrency: 5,
  }
);

taskWorker.on("failed", (job, err) => {
  const taskId = job?.data.taskId;
  console.error(`[Worker] Job ${job?.id} failed for task ${taskId}:`, err);
  if (taskId) {
    redisPublisher.publish(SSE_CHANNEL, JSON.stringify({ taskId, type: "failed", status: "failed", error: err.message }));
  }
});

taskWorker.on("completed", (job) => {
  const taskId = job.data.taskId;
  console.log(`[Worker] Job ${job.id} completed successfully, task ${taskId}`);
  // 通过 Redis Pub/Sub 通知 API 服务器推送 SSE
  redisPublisher.publish(SSE_CHANNEL, JSON.stringify({ taskId, type: "completed", status: "completed" }));
});
