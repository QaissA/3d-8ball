import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { TABLE } from '../config/table';

export function addLighting(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  // Built-in procedural room for reflections; swap for a Poly Haven HDRI in the art pass.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.4;

  const lamp = new THREE.SpotLight(0xfff4e0, 40, 4, Math.PI / 4, 0.6, 1.5);
  lamp.position.set(0, 1.4, 0);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.camera.near = 0.5;
  lamp.shadow.camera.far = 2;
  lamp.shadow.bias = -0.0005;
  scene.add(lamp, lamp.target);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x202020, 0.3));
  return { lamp };
}

/** Table GLB (CC-BY, see CREDITS.md). Cue/rack/chalk stay hidden in the returned group for later phases. */
export async function loadTable(scene: THREE.Scene): Promise<THREE.Group> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync('models/table.glb');
  gltf.scene.position.y = -TABLE.modelClothY;
  gltf.scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const isTable = (o.material as THREE.Material).name === 'PoolTable_MTL';
    o.visible = isTable;
    o.receiveShadow = isTable;
    o.castShadow = isTable;
  });
  scene.add(gltf.scene);
  return gltf.scene;
}
