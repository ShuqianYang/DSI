import {
  cleanupAgentLoopLogs,
  resolveAgentLoopLogRetentionDays,
  resolveAgentLoopLogRootDir,
} from "../../src/modules/observability/logRetention.js";

const rootDir = resolveAgentLoopLogRootDir(process.env);
const retentionDays = resolveAgentLoopLogRetentionDays(process.env);

const result = await cleanupAgentLoopLogs({
  rootDir,
  retentionDays,
});

console.log(
  JSON.stringify(
    {
      rootDir,
      retentionDays,
      ...result,
    },
    null,
    2
  )
);
