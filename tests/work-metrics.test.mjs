import assert from "node:assert/strict";
import { test } from "node:test";
import { splitWorkRecords, taskDataScope } from "../src/work-metrics.mjs";

test("work metrics separate real, demo, and evaluation records", () => {
  const tasks = [
    { id: "real_1", source: "operator", status: "completed", title: "Fix login" },
    { id: "demo_1", source: "launch_demo", status: "completed", title: "Demo" },
    { id: "eval_1", source: "mission_sandbox_patch", status: "completed", title: "Stage-8 verification" }
  ];
  const split = splitWorkRecords({
    tasks,
    evidencePacks: tasks.map((task) => ({ taskId: task.id }))
  });

  assert.equal(taskDataScope(tasks[0]), "real");
  assert.equal(split.real.tasks.length, 1);
  assert.equal(split.demo.evidencePacks.length, 1);
  assert.equal(split.evaluation.tasks.length, 1);
  assert.deepEqual(split.summary, {
    real: { tasks: 1, completed: 1 },
    demo: { tasks: 1, completed: 1 },
    evaluation: { tasks: 1, completed: 1 }
  });
});
