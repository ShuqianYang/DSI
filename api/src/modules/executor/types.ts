export interface ExecutorService {
  run(taskId: string, jobTaskId?: string): Promise<void>;
}
