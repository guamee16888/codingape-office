const DATA_SCOPES = new Set(["real", "demo", "evaluation"]);

export function taskDataScope(task = {}) {
  if (DATA_SCOPES.has(task.dataScope)) return task.dataScope;
  const source = String(task.source || "").toLowerCase();
  const title = String(task.title || "");
  if (["launch_demo", "sandbox_demo"].includes(source)) return "demo";
  if (/^stage[- ]?\d+/i.test(title) || /scorecard|fixture|evaluation/i.test(source)) return "evaluation";
  return "real";
}

export function splitWorkRecords({ tasks = [], ...artifactGroups } = {}) {
  const taskScopes = new Map(tasks.filter((task) => task?.id).map((task) => [task.id, taskDataScope(task)]));
  const scopes = Object.fromEntries([...DATA_SCOPES].map((scope) => [scope, { tasks: [] }]));

  for (const task of tasks) scopes[taskDataScope(task)].tasks.push(task);
  for (const [groupName, records] of Object.entries(artifactGroups)) {
    for (const scope of DATA_SCOPES) scopes[scope][groupName] = [];
    for (const record of Array.isArray(records) ? records : []) {
      const scope = taskScopes.get(record?.taskId) || (DATA_SCOPES.has(record?.dataScope) ? record.dataScope : "evaluation");
      scopes[scope][groupName].push(record);
    }
  }

  return {
    ...scopes,
    summary: Object.fromEntries([...DATA_SCOPES].map((scope) => [scope, {
      tasks: scopes[scope].tasks.length,
      completed: scopes[scope].tasks.filter((task) => task.status === "completed").length
    }]))
  };
}
