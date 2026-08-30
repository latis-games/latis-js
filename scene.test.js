import { test } from "node:test";
import assert from "node:assert/strict";
import { Object3D, Scene, Mesh, Raycaster, PerspectiveCamera, parseGLB } from "./packs/scene.js";

test("scene graph parent and ray vs triangle", () => {
  const scene = new Scene();
  const mesh = new Mesh({
    position: new Float32Array([
      -1, -1, -2,
       1, -1, -2,
       0,  1, -2,
    ]),
  });
  scene.add(mesh);
  assert.equal(mesh.parent, scene);
  scene.updateWorldMatrix();
  const ray = new Raycaster();
  ray.set([0, 0, 0], [0, 0, -1]);
  const hits = ray.intersectObject(scene, true);
  assert.ok(hits.length >= 1);
  assert.ok(hits[0].distance > 1.5 && hits[0].distance < 2.5);
});

test("parseGLB reads a tiny triangle mesh", () => {
  const jsonObj = {
    asset: { version: "2.0" },
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", max: [1, 1, 0], min: [0, 0, 0] }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36 }],
  };
  let json = JSON.stringify(jsonObj);
  while (json.length % 4) json += " ";
  const jsonBytes = Buffer.from(json, "utf8");
  const bin = Buffer.alloc(36);
  new Float32Array(bin.buffer, bin.byteOffset, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const jsonChunk = Buffer.alloc(8 + jsonBytes.length);
  jsonChunk.writeUInt32LE(jsonBytes.length, 0);
  jsonChunk.writeUInt32LE(0x4e4f534a, 4);
  jsonBytes.copy(jsonChunk, 8);
  const binChunk = Buffer.alloc(8 + 36);
  binChunk.writeUInt32LE(36, 0);
  binChunk.writeUInt32LE(0x004e4942, 4);
  bin.copy(binChunk, 8);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + jsonChunk.length + binChunk.length, 8);
  const glb = Buffer.concat([header, jsonChunk, binChunk]);
  const parsed = parseGLB(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength));
  assert.equal(parsed.meshes.length, 1);
  assert.equal(parsed.meshes[0].position.length, 9);
  assert.equal(parsed.meshes[0].position[3], 1);
});
