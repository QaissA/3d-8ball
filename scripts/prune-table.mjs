// Prepares the Sketchfab model for the game before `gltf-transform optimize`:
// - drops what we don't render: the model's balls (procedural ones are used), the second cue (the
//   optimiser would merge both cues into one mesh), the ball rack and the chalk;
// - shrinks textures that never fill the screen, to save GPU memory (a 2048² texture ≈ 22 MB).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';

const DROP = ['Pool Table - ', 'Pool Cue2', 'Ball Rack', 'Chalk Cube'];

const [src, out] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();
for (const node of root.listNodes()) {
  if (DROP.some((p) => node.getName().startsWith(p))) node.dispose();
}
await doc.transform(prune());

// name textures "<material>/<slot>" so they can be targeted below
for (const mat of root.listMaterials()) {
  for (const [slot, tex] of [
    ['baseColor', mat.getBaseColorTexture()],
    ['metallicRoughness', mat.getMetallicRoughnessTexture()],
    ['normal', mat.getNormalTexture()],
  ]) {
    if (tex) tex.setName(`${mat.getName()}/${slot}`);
  }
}
const resize = (pattern, size) =>
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], pattern });
await doc.transform(
  resize(/^PoolCue_MTL\//, 1024), // a thin stick: 1024 is plenty
  resize(/^PoolTable_MTL\/metallicRoughness/, 1024),
);
// clearcoat intensity maps are nearly uniform
await doc.transform(
  textureCompress({
    encoder: sharp,
    targetFormat: 'webp',
    resize: [512, 512],
    slots: /^clearcoatTexture$/,
  }),
);
await io.write(out, doc);
