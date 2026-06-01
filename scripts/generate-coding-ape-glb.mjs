#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(repoRoot, "public/assets/workers/coding-ape.glb");
const manifestPath = join(repoRoot, "public/assets/workers/manifest.json");

const REQUIRED_ANIMATIONS = [
  "idle",
  "assigned",
  "working",
  "running_command",
  "reviewing",
  "waiting_approval",
  "blocked",
  "completed",
  "reporting"
];

function align4(value) {
  return (value + 3) & ~3;
}

function padBuffer(buffer, padByte = 0) {
  const aligned = align4(buffer.length);
  if (aligned === buffer.length) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(aligned - buffer.length, padByte)]);
}

function quaternionFromEuler(x = 0, y = 0, z = 0) {
  const cx = Math.cos(x / 2);
  const sx = Math.sin(x / 2);
  const cy = Math.cos(y / 2);
  const sy = Math.sin(y / 2);
  const cz = Math.cos(z / 2);
  const sz = Math.sin(z / 2);
  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz
  ];
}

function floatBuffer(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

function uint16Buffer(values) {
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => buffer.writeUInt16LE(value, index * 2));
  return buffer;
}

function computeMinMax(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], positions[index + axis]);
      max[axis] = Math.max(max[axis], positions[index + axis]);
    }
  }
  return { min, max };
}

function createBoxGeometry() {
  const faces = [
    [[1, 0, 0], [[0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5]]],
    [[-1, 0, 0], [[-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [-0.5, -0.5, -0.5]]],
    [[0, 1, 0], [[-0.5, 0.5, -0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5]]],
    [[0, -1, 0], [[-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5]]],
    [[0, 0, 1], [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]]],
    [[0, 0, -1], [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]]]
  ];
  const positions = [];
  const normals = [];
  const indices = [];
  for (const [normal, vertices] of faces) {
    const base = positions.length / 3;
    for (const vertex of vertices) {
      positions.push(...vertex);
      normals.push(...normal);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, normals, indices };
}

function createSphereGeometry(latitudeBands = 18, longitudeBands = 24) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let lat = 0; lat <= latitudeBands; lat += 1) {
    const theta = (lat * Math.PI) / latitudeBands;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);
    for (let lon = 0; lon <= longitudeBands; lon += 1) {
      const phi = (lon * Math.PI * 2) / longitudeBands;
      const x = Math.cos(phi) * sinTheta;
      const y = cosTheta;
      const z = Math.sin(phi) * sinTheta;
      positions.push(x * 0.5, y * 0.5, z * 0.5);
      normals.push(x, y, z);
    }
  }
  for (let lat = 0; lat < latitudeBands; lat += 1) {
    for (let lon = 0; lon < longitudeBands; lon += 1) {
      const first = lat * (longitudeBands + 1) + lon;
      const second = first + longitudeBands + 1;
      indices.push(first, second, first + 1, second, second + 1, first + 1);
    }
  }
  return { positions, normals, indices };
}

function createCylinderGeometry(radialSegments = 28) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let i = 0; i <= radialSegments; i += 1) {
    const angle = (i / radialSegments) * Math.PI * 2;
    const x = Math.cos(angle);
    const z = Math.sin(angle);
    positions.push(x * 0.5, -0.5, z * 0.5, x * 0.5, 0.5, z * 0.5);
    normals.push(x, 0, z, x, 0, z);
  }
  for (let i = 0; i < radialSegments; i += 1) {
    const base = i * 2;
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const bottomCenter = positions.length / 3;
  positions.push(0, -0.5, 0);
  normals.push(0, -1, 0);
  const topCenter = positions.length / 3;
  positions.push(0, 0.5, 0);
  normals.push(0, 1, 0);
  for (let i = 0; i < radialSegments; i += 1) {
    const current = i * 2;
    const next = ((i + 1) % radialSegments) * 2;
    indices.push(bottomCenter, next, current);
    indices.push(topCenter, current + 1, next + 1);
  }
  return { positions, normals, indices };
}

const json = {
  asset: {
    version: "2.0",
    generator: "CodingYuan Office Stage-8 asset generator"
  },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [],
  meshes: [],
  materials: [],
  buffers: [{ byteLength: 0 }],
  bufferViews: [],
  accessors: [],
  animations: []
};

const chunks = [];

function appendChunk(buffer) {
  const byteOffset = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const padded = padBuffer(buffer);
  chunks.push(padded);
  return { byteOffset, byteLength: buffer.length };
}

function addAccessor(buffer, componentType, type, count, extra = {}) {
  const view = appendChunk(buffer);
  const bufferView = json.bufferViews.length;
  json.bufferViews.push({
    buffer: 0,
    byteOffset: view.byteOffset,
    byteLength: view.byteLength
  });
  const accessor = json.accessors.length;
  json.accessors.push({
    bufferView,
    componentType,
    count,
    type,
    ...extra
  });
  return accessor;
}

function addGeometry(name, geometry) {
  const { min, max } = computeMinMax(geometry.positions);
  const position = addAccessor(floatBuffer(geometry.positions), 5126, "VEC3", geometry.positions.length / 3, { min, max });
  const normal = addAccessor(floatBuffer(geometry.normals), 5126, "VEC3", geometry.normals.length / 3);
  const index = addAccessor(uint16Buffer(geometry.indices), 5123, "SCALAR", geometry.indices.length);
  const mesh = json.meshes.length;
  json.meshes.push({
    name,
    primitives: [
      {
        attributes: { POSITION: position, NORMAL: normal },
        indices: index,
        material: 0
      }
    ]
  });
  return mesh;
}

function addMaterial(name, baseColorFactor, options = {}) {
  const material = json.materials.length;
  json.materials.push({
    name,
    pbrMetallicRoughness: {
      baseColorFactor,
      metallicFactor: options.metallicFactor ?? 0.08,
      roughnessFactor: options.roughnessFactor ?? 0.46
    },
    emissiveFactor: options.emissiveFactor || [0, 0, 0],
    alphaMode: options.alphaMode || "OPAQUE"
  });
  return material;
}

function addNode({ name, mesh, material, translation, rotation, scale, children }) {
  const node = {
    name,
    ...(mesh !== undefined ? { mesh } : {}),
    ...(translation ? { translation } : {}),
    ...(rotation ? { rotation } : {}),
    ...(scale ? { scale } : {}),
    ...(children ? { children } : {})
  };
  if (mesh !== undefined && material !== undefined) {
    const source = json.meshes[mesh];
    const clonedMesh = json.meshes.length;
    json.meshes.push({
      name: `${name}Mesh`,
      primitives: source.primitives.map((primitive) => ({ ...primitive, material }))
    });
    node.mesh = clonedMesh;
  }
  const index = json.nodes.length;
  json.nodes.push(node);
  return index;
}

const dark = addMaterial("charcoal suit", [0.08, 0.1, 0.13, 1], { metallicFactor: 0.24, roughnessFactor: 0.38 });
const hoodie = addMaterial("ink hoodie", [0.12, 0.16, 0.22, 1], { metallicFactor: 0.14, roughnessFactor: 0.5 });
const fur = addMaterial("warm codingyuan fur", [0.52, 0.38, 0.25, 1], { roughnessFactor: 0.72 });
const muzzle = addMaterial("soft muzzle", [0.86, 0.68, 0.48, 1], { roughnessFactor: 0.68 });
const teal = addMaterial("coding cyan glow", [0.08, 0.84, 0.76, 1], { emissiveFactor: [0.02, 0.32, 0.28], roughnessFactor: 0.28 });
const amber = addMaterial("gate amber", [1, 0.62, 0.18, 1], { emissiveFactor: [0.42, 0.18, 0.02], roughnessFactor: 0.34 });
const glass = addMaterial("visor glass", [0.72, 0.94, 1, 0.58], { alphaMode: "BLEND", emissiveFactor: [0.08, 0.32, 0.42], metallicFactor: 0.02, roughnessFactor: 0.12 });
const cream = addMaterial("terminal cream keys", [0.92, 0.87, 0.76, 1], { roughnessFactor: 0.56 });

const box = addGeometry("unit box", createBoxGeometry());
const sphere = addGeometry("unit sphere", createSphereGeometry());
const cylinder = addGeometry("unit cylinder", createCylinderGeometry());

const nodes = [];
nodes.push(addNode({ name: "BodySuit", mesh: sphere, material: hoodie, translation: [0, 0.85, 0], scale: [0.92, 1.28, 0.54] }));
nodes.push(addNode({ name: "ChestGlow", mesh: box, material: teal, translation: [0, 1.02, -0.43], scale: [0.44, 0.08, 0.035] }));
nodes.push(addNode({ name: "BeltGateLine", mesh: box, material: amber, translation: [0, 0.48, -0.4], scale: [0.7, 0.045, 0.035] }));
nodes.push(addNode({ name: "Head", mesh: sphere, material: fur, translation: [0, 1.72, -0.02], scale: [0.78, 0.72, 0.62] }));
const headNode = nodes[nodes.length - 1];
nodes.push(addNode({ name: "Muzzle", mesh: sphere, material: muzzle, translation: [0, 1.56, -0.48], scale: [0.42, 0.28, 0.2] }));
nodes.push(addNode({ name: "Visor", mesh: box, material: glass, translation: [0, 1.72, -0.56], scale: [0.58, 0.12, 0.035] }));
nodes.push(addNode({ name: "LeftEar", mesh: sphere, material: fur, translation: [-0.52, 1.94, -0.02], scale: [0.22, 0.3, 0.16] }));
nodes.push(addNode({ name: "RightEar", mesh: sphere, material: fur, translation: [0.52, 1.94, -0.02], scale: [0.22, 0.3, 0.16] }));
nodes.push(addNode({ name: "TopKnot", mesh: cylinder, material: teal, translation: [0, 2.18, -0.02], rotation: quaternionFromEuler(0, 0, Math.PI / 2), scale: [0.12, 0.12, 0.28] }));
nodes.push(addNode({ name: "LeftArm", mesh: cylinder, material: dark, translation: [-0.7, 0.92, -0.24], rotation: quaternionFromEuler(0.85, 0.05, -0.32), scale: [0.16, 0.7, 0.16] }));
nodes.push(addNode({ name: "RightArm", mesh: cylinder, material: dark, translation: [0.7, 0.92, -0.24], rotation: quaternionFromEuler(0.85, -0.05, 0.32), scale: [0.16, 0.7, 0.16] }));
nodes.push(addNode({ name: "LeftHand", mesh: sphere, material: muzzle, translation: [-0.42, 0.52, -0.6], scale: [0.16, 0.1, 0.12] }));
nodes.push(addNode({ name: "RightHand", mesh: sphere, material: muzzle, translation: [0.42, 0.52, -0.6], scale: [0.16, 0.1, 0.12] }));
nodes.push(addNode({ name: "ConsolePanel", mesh: box, material: glass, translation: [0, 0.42, -0.72], rotation: quaternionFromEuler(-0.18, 0, 0), scale: [1.25, 0.08, 0.42] }));
nodes.push(addNode({ name: "TerminalLineA", mesh: box, material: teal, translation: [-0.23, 0.5, -0.94], scale: [0.42, 0.018, 0.018] }));
nodes.push(addNode({ name: "TerminalLineB", mesh: box, material: amber, translation: [0.22, 0.45, -0.94], scale: [0.32, 0.018, 0.018] }));
nodes.push(addNode({ name: "SeatBase", mesh: box, material: dark, translation: [0, 0.2, 0.08], scale: [0.9, 0.18, 0.56] }));
nodes.push(addNode({ name: "StationHalo", mesh: cylinder, material: teal, translation: [0, 0.02, 0], scale: [1.8, 0.035, 1.8] }));
for (let index = 0; index < 8; index += 1) {
  const x = -0.48 + index * 0.14;
  const material = index % 3 === 0 ? amber : cream;
  nodes.push(addNode({ name: `Key${index + 1}`, mesh: box, material, translation: [x, 0.51, -0.69], scale: [0.07, 0.014, 0.045] }));
}

json.nodes[0].children = nodes.slice(1);

const animationTime = addAccessor(floatBuffer([0, 0.5, 1]), 5126, "SCALAR", 3, { min: [0], max: [1] });
const animationProfiles = {
  idle: [0, 0.02, 0],
  assigned: [0.02, -0.08, 0],
  working: [-0.08, 0.12, 0.02],
  running_command: [-0.12, 0.18, 0.04],
  reviewing: [-0.04, -0.2, -0.02],
  waiting_approval: [0.02, 0.24, 0],
  blocked: [0.08, 0.36, -0.04],
  completed: [0.02, 0, 0.06],
  reporting: [-0.03, -0.1, 0.03]
};

for (const name of REQUIRED_ANIMATIONS) {
  const [x, y, z] = animationProfiles[name];
  const rotations = [
    ...quaternionFromEuler(0, 0, 0),
    ...quaternionFromEuler(x, y, z),
    ...quaternionFromEuler(0, 0, 0)
  ];
  const output = addAccessor(floatBuffer(rotations), 5126, "VEC4", 3);
  json.animations.push({
    name,
    samplers: [{ input: animationTime, output, interpolation: "LINEAR" }],
    channels: [{ sampler: 0, target: { node: headNode, path: "rotation" } }]
  });
}

json.buffers[0].byteLength = chunks.reduce((total, chunk) => total + chunk.length, 0);

function buildGlb() {
  const jsonChunk = padBuffer(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const binChunk = Buffer.concat(chunks);
  const totalLength = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk], totalLength);
}

mkdirSync(dirname(outputPath), { recursive: true });
const glb = buildGlb();
writeFileSync(outputPath, glb);

const hash = createHash("sha256").update(glb).digest("hex");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const worker = manifest.workers.find((entry) => entry.id === "coding-yuan");
worker.version = "stage8-v1";
worker.hash = `sha256-${hash}`;
worker.sizeBytes = glb.length;
worker.model = "/assets/workers/coding-ape.glb";
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  outputPath,
  sizeBytes: glb.length,
  sha256: hash,
  animations: REQUIRED_ANIMATIONS
}, null, 2));
