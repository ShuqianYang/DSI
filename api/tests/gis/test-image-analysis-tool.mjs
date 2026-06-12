import assert from "node:assert/strict";
import "dotenv/config";

const { buildImageAnalysisTool } = await import("../../src/modules/agent-loop/tools/domain/satellite/imageAnalysis.ts");
const { buildDefaultToolRegistry } = await import("../../src/modules/agent-loop/tools/_shared/toolRegistry.ts");

function createContext(query = "image analysis") {
  return {
    taskId: "image-analysis-test-task",
    query,
    observations: [],
  };
}

const QWEN_API_KEY = process.env.QWEN_API_KEY;

if (!QWEN_API_KEY) {
  console.log("[SKIP] QWEN_API_KEY not set, skipping ImageAnalysis tests");
  process.exit(0);
}

// Test 1: Registry registration
{
  const registry = buildDefaultToolRegistry();
  assert(registry.get("ImageAnalysis"), "ImageAnalysis must be registered");
  assert(registry.get("image-analysis"), "image-analysis alias must be registered");
  console.log("[Test 1] Registry registration: OK");
}

// Test 2: Input schema validation - rejects empty imageUrls
{
  const tool = buildImageAnalysisTool();
  try {
    await tool.execute({ imageUrls: [] }, createContext());
    assert.fail("Should reject empty imageUrls");
  } catch (error) {
    assert.ok(error.message.includes("imageUrls") || error.issues, "Should validate imageUrls");
  }
  console.log("[Test 2] Empty imageUrls validation: OK");
}

// Test 3: Input schema validation - rejects too many images
{
  const tool = buildImageAnalysisTool();
  try {
    await tool.execute({ imageUrls: ["a", "b", "c", "d", "e"] }, createContext());
    assert.fail("Should reject >4 images");
  } catch (error) {
    assert.ok(error.message.includes("imageUrls") || error.issues, "Should validate max images");
  }
  console.log("[Test 3] Max images validation: OK");
}

// Test 4: Real analysis with a publicly accessible image (NASA Earth Observatory)
// This tests the full pipeline: download -> base64 -> DeepSeek vision
{
  const tool = buildImageAnalysisTool();
  // Use a stable public image URL for testing
  const publicImageUrl = "https://picsum.photos/200/200";

  console.log("[Test 4] Real vision analysis with public image...");
  const output = await tool.execute(
    {
      imageUrls: [publicImageUrl],
      analysisType: "overview",
      context: "Test image for pipeline verification",
    },
    createContext()
  );

  assert.equal(typeof output.summary, "string");
  assert.equal(typeof output.analysisType, "string");
  assert.equal(output.imageCount, 1);
  assert.ok(typeof output.assessment, "object");
  assert.equal(typeof output.assessment.summary, "string");
  assert.ok(["low", "medium", "high", "critical", "unknown"].includes(output.assessment.severity));
  assert.ok(output.assessment.confidence >= 0 && output.assessment.confidence <= 1);
  assert.ok(Array.isArray(output.assessment.affectedAreas));
  assert.ok(Array.isArray(output.assessment.changesDetected));
  assert.ok(Array.isArray(output.assessment.recommendations));
  assert.equal(typeof output.rawResponse, "string");

  console.log(`  Summary: ${output.summary.slice(0, 100)}...`);
  console.log(`  Severity: ${output.assessment.severity}, Confidence: ${output.assessment.confidence}`);
  console.log(`  Changes: ${output.assessment.changesDetected.length} items`);
  console.log("[Test 4] Real vision analysis: OK");
}

console.log("\nImageAnalysis tool tests passed");
