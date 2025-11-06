import React, { useState, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Sky, Stats } from '@react-three/drei';
import * as THREE from 'three';

const CHUNK_SIZE = 16;
const RENDER_DISTANCE = 4; // in chunks

function Chunk({ chunkX, chunkZ }) {
  const [geometryData, setGeometryData] = useState(null);

  useEffect(() => {
    // Correctly referencing worker.js from the same directory.
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    
    worker.onmessage = (event) => {
      const { posArr, normArr, colArr } = event.data;
      setGeometryData({ 
        positions: new Float32Array(posArr), 
        normals: new Float32Array(normArr), 
        colors: new Float32Array(colArr) 
      });
    };

    // Assuming a random seed for now
    const seed = Math.random();
    worker.postMessage({ chunkX, chunkZ, seed });

    return () => {
      worker.terminate();
    };
  }, [chunkX, chunkZ]);

  const geometry = useMemo(() => {
    if (!geometryData) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(geometryData.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(geometryData.normals, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(geometryData.colors, 3));
    geo.computeBoundingSphere();
    return geo;
  }, [geometryData]);

  if (!geometry) return null;

  return (
    <mesh position={[chunkX * CHUNK_SIZE, 0, chunkZ * CHUNK_SIZE]} geometry={geometry}>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} />
    </mesh>
  );
}

function World() {
  const chunks = useMemo(() => {
    const newChunks = [];
    for (let x = -RENDER_DISTANCE; x <= RENDER_DISTANCE; x++) {
      for (let z = -RENDER_DISTANCE; z <= RENDER_DISTANCE; z++) {
        newChunks.push({ id: `${x},${z}`, x, z });
      }
    }
    return newChunks;
  }, []);

  return (
    <>
      {chunks.map(({ id, x, z }) => (
        <Chunk key={id} chunkX={x} chunkZ={z} />
      ))}
    </>
  );
}

function App() {
  return (
    <Canvas camera={{ position: [0, 90, 50], fov: 75 }}>
      <Sky sunPosition={[100, 20, 100]} />
      <ambientLight intensity={0.7} />
      <pointLight position={[100, 100, 100]} intensity={1.0} />
      <World />
      <OrbitControls />
      <Stats />
    </Canvas>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
