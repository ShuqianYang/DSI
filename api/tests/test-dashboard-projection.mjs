import assert from "node:assert/strict";

const {
  projectAgentTaskToApiTask,
  projectTaskStepToSyntheticEvent,
  projectAircraftStatesToAdsData,
} = await import("../src/modules/dashboard/projection.ts");

const now = new Date("2026-06-08T08:00:00.000Z");

{
  const task = {
    id: "11111111-1111-1111-1111-111111111111",
    query: "查询台湾海峡附近当前有哪些飞机，列出 callsign、国家、经纬度和高度。",
    status: "completed",
    createdAt: now,
    updatedAt: now,
    completedAt: now,
  };
  const steps = [
    {
      id: "22222222-2222-2222-2222-222222222222",
      taskId: task.id,
      actionType: "SqlQuery",
      actionConfig: { name: "SqlQuery", reason: "查询飞机数据", _order: 2 },
      status: "completed",
      result: null,
      error: null,
      startedAt: now,
      completedAt: now,
    },
    {
      id: "33333333-3333-3333-3333-333333333333",
      taskId: task.id,
      actionType: "Skill",
      actionConfig: { name: "Skill", reason: "加载飞机查询技能", _order: 1 },
      status: "completed",
      result: null,
      error: null,
      startedAt: now,
      completedAt: now,
    },
  ];

  const apiTask = projectAgentTaskToApiTask(task, steps);

  assert.equal(apiTask.id, task.id);
  assert.equal(apiTask.agentTaskId, task.id);
  assert.equal(apiTask.type, "realtime");
  assert.equal(apiTask.status, "completed");
  assert.match(apiTask.name, /查询台湾海峡/);
  assert.deepEqual(
    apiTask.subTasks.map((step) => [step.name, step.order, step.status]),
    [
      ["Skill", 1, "completed"],
      ["SqlQuery", 2, "completed"],
    ],
  );
}

{
  const task = {
    id: "11111111-1111-1111-1111-111111111111",
    query: "查询台湾海峡附近当前有哪些飞机",
    status: "completed",
    createdAt: now,
    updatedAt: now,
    completedAt: now,
  };
  const step = {
    id: "44444444-4444-4444-4444-444444444444",
    taskId: task.id,
    actionType: "SqlQuery",
    actionConfig: { name: "SqlQuery", reason: "查询航空器当前状态", _order: 1 },
    status: "completed",
    result: {
      observation: {
        ok: true,
        toolName: "SqlQuery",
        output: {
          returnedRows: 2,
          rows: [
            { callsign: "CAL123", origin_country: "Taiwan", longitude: 120, latitude: 24 },
            { callsign: "ANA456", origin_country: "Japan", longitude: 121, latitude: 25 },
          ],
          gisData: {
            type: "aircraft",
            entities: [{ id: "ac-1", coordinates: [120, 24] }],
          },
        },
      },
    },
    error: null,
    startedAt: now,
    completedAt: now,
  };

  const event = projectTaskStepToSyntheticEvent(task, step);

  assert.equal(event.id, step.id);
  assert.equal(event.taskId, task.id);
  assert.equal(event.agentTaskId, task.id);
  assert.equal(event.title, "SqlQuery");
  assert.equal(event.status, "success");
  assert.equal(event.read, false);
  assert.match(event.content, /returnedRows/);
  assert.deepEqual(event.gisData, step.result.observation.output.gisData);
}

{
  const failedStep = {
    id: "55555555-5555-5555-5555-555555555555",
    taskId: "11111111-1111-1111-1111-111111111111",
    actionType: "Read",
    actionConfig: { _order: 1 },
    status: "failed",
    result: {
      observation: {
        ok: false,
        toolName: "Read",
        error: { message: "file not found" },
      },
    },
    error: "file not found",
    startedAt: now,
    completedAt: now,
  };
  const task = {
    id: failedStep.taskId,
    query: "读取文件",
    status: "failed",
    createdAt: now,
    updatedAt: now,
    completedAt: now,
  };

  const event = projectTaskStepToSyntheticEvent(task, failedStep);

  assert.equal(event.status, "failed");
  assert.match(event.content, /file not found/);
}

{
  const adsData = projectAircraftStatesToAdsData([
    {
      icao24: "abc123",
      callsign: "CAL123",
      originCountry: "Taiwan",
      longitude: 120.5,
      latitude: 24.2,
      baroAltitude: 11200,
      velocity: 230,
      trueTrack: 87,
      status: "",
      updatedAt: now,
      sourceTime: now,
    },
    {
      icao24: "no-position",
      callsign: "NOPOS",
      originCountry: "Unknown",
      longitude: null,
      latitude: 24.2,
      baroAltitude: null,
      velocity: null,
      trueTrack: null,
      status: "",
      updatedAt: now,
      sourceTime: now,
    },
  ]);

  assert.equal(adsData.count, 1);
  assert.equal(adsData.entities[0].id, "opensky-abc123");
  assert.equal(adsData.entities[0].name, "CAL123");
  assert.deepEqual(adsData.entities[0].coordinates, [120.5, 24.2]);
  assert.equal(adsData.entities[0].altitude, 11200);
  assert.equal(adsData.entities[0].heading, 87);
  assert.equal(adsData.trajectories.length, 0);
}
