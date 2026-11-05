// Drops the model's own balls (we render procedural ones) so their textures don't ship.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const [src, out] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
for (const node of doc.getRoot().listNodes()) {
  if (node.getName().startsWith('Pool Table - ')) node.dispose();
}
await doc.transform(prune());
await io.write(out, doc);
