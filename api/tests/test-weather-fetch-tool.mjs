import assert from "node:assert/strict";

const { buildWeatherFetchTool } = await import("../src/modules/agent-loop/weatherTools.ts");

function createContext() {
  return {
    taskId: "weather-test-task",
    query: "fetch weather",
    observations: [],
  };
}

{
  const tool = buildWeatherFetchTool();

  await assert.rejects(
    () => tool.execute({}, createContext()),
    /WeatherFetch requires either center or bbox/,
    "WeatherFetch must not guess a default location"
  );
}

{
  const tool = buildWeatherFetchTool();
  const parsed = tool.inputSchema.safeParse({
    center: { lat: 25, lng: 120 },
    grid: { rows: 6, cols: 5 },
  });

  assert.equal(parsed.success, false, "WeatherFetch should constrain grid size to avoid overlong Open-Meteo URLs");
}

{
  const tool = buildWeatherFetchTool();
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url) => {
    const text = String(url);
    calls.push(text);

    if (text.startsWith("https://api.open-meteo.com/v1/forecast")) {
      return {
        ok: true,
        async json() {
          return Array.from({ length: 4 }, () => ({
            hourly: {
              wind_speed_10m: [null, 4],
              wind_direction_10m: [null, 90],
            },
          }));
        },
      };
    }

    if (text.startsWith("https://marine-api.open-meteo.com/v1/marine")) {
      return {
        ok: true,
        async json() {
          return {
            hourly: {
              ocean_current_velocity: [null, 0.6],
              ocean_current_direction: [null, 180],
            },
          };
        },
      };
    }

    throw new Error(`unexpected url ${text}`);
  };

  try {
    const output = await tool.execute(
      {
        center: { lat: 25, lng: 120 },
        grid: { rows: 2, cols: 2 },
        lookbackDays: 1,
        timezone: "Asia/Shanghai",
      },
      createContext()
    );

    assert.equal(calls.length, 2);
    assert.equal(output.dataSource, "open-meteo");
    assert.equal(output.windSpeed, 4);
    assert.equal(output.windDirection, "东");
    assert.equal(output.currentSpeed, 0.6);
    assert.equal(output.currentDirection, "南");
    assert.equal(output.gisData.type, "wind-field");
    assert.deepEqual(output.gisData.windField.grid, { rows: 2, cols: 2 });
    assert.deepEqual(output.gisData.windField.speed, [4, 4, 4, 4]);
    assert.notEqual(output.gisData.windField.speed[0], 3.2, "must not return the old hardcoded mock speed");
    assert.equal(output.gisData.windField.source, "open-meteo");
    assert.equal(output.coverage.validWindPoints, 4);
    assert.equal(output.coverage.totalWindPoints, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const tool = buildWeatherFetchTool();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    const text = String(url);

    if (text.startsWith("https://api.open-meteo.com/v1/forecast")) {
      return {
        ok: true,
        async json() {
          return [
            {
              hourly: {
                wind_speed_10m: [null, 2],
                wind_direction_10m: [null, 350],
              },
            },
            {
              hourly: {
                wind_speed_10m: [null, null],
                wind_direction_10m: [null, null],
              },
            },
            {
              hourly: {
                wind_speed_10m: [null, 2],
                wind_direction_10m: [null, 10],
              },
            },
            {
              hourly: {
                wind_speed_10m: [null, 2],
                wind_direction_10m: [null, 10],
              },
            },
          ];
        },
      };
    }

    if (text.startsWith("https://marine-api.open-meteo.com/v1/marine")) {
      return {
        ok: true,
        async json() {
          return {
            hourly: {
              ocean_current_velocity: [null, 0.6],
              ocean_current_direction: [null, 180],
            },
          };
        },
      };
    }

    throw new Error(`unexpected url ${text}`);
  };

  try {
    const output = await tool.execute(
      {
        center: { lat: 25, lng: 120 },
        grid: { rows: 2, cols: 2 },
      },
      createContext()
    );

    assert.equal(output.windDirectionDegrees >= 0 && output.windDirectionDegrees < 360, true);
    assert.equal(output.coverage.validWindPoints, 3);
    assert.equal(output.coverage.totalWindPoints, 4);
    assert.equal(output.gisData.windField.speed.length, 4, "front-end wind-field grid should remain rectangular");
    assert.deepEqual(output.gisData.windField.validMask, [true, false, true, true]);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const tool = buildWeatherFetchTool();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network down");
  };

  try {
    await assert.rejects(
      () =>
        tool.execute(
          {
            center: { lat: 25, lng: 120 },
            grid: { rows: 2, cols: 2 },
          },
          createContext()
        ),
      /Open-Meteo request failed/,
      "WeatherFetch must fail instead of fabricating a mock wind field"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log("weather fetch tool test passed");
