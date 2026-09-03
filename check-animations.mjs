import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readFileSync } from 'fs';
import { Buffer } from 'buffer';

const glbPath = './artifacts/animator/public/models/enemies/caesar_pit_boss.glb';
const buffer = readFileSync(glbPath);

const loader = new GLTFLoader();
loader.parse(buffer.buffer, '', (gltf) => {
  console.log('Caesar GLB animations:');
  if (!gltf.animations || gltf.animations.length === 0) {
    console.log('  NO ANIMATIONS FOUND');
  } else {
    gltf.animations.forEach((clip, i) => {
      console.log(`  ${i}: "${clip.name}" (${clip.duration.toFixed(2)}s, ${clip.tracks.length} tracks)`);
    });
  }
}, (error) => {
  console.error('Error loading GLB:', error);
});
