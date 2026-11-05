// Drops the model's own balls (we render procedural ones) and the second cue; the optimiser
// would otherwise merge both cues into one mesh.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const [src, out] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
for (const node of doc.getRoot().listNodes()) {
  const name = node.getName();
  if (name.startsWith('Pool Table - ') || name.startsWith('Pool Cue2')) node.dispose();
}
await doc.transform(prune());
await io.write(out, doc);
