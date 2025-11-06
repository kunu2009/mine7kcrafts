// 7K Voxelcraft — React + React-Three-Fiber Starter (single-file scaffold) // File: src/App.jsx // Purpose: Minimal, production-oriented starter showing chunked voxel world, greedy meshing, // multi-thread chunk generation (worker placeholder), PBR-like material, sky, camera controls. // Notes: This is a scaffold to iterate from — replace worker code, assets, and shaders with your own.

import React, { useRef, useState, useEffect, useMemo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Sky } from "@react-three/drei";
import * as THREE from "three";

// ---------------------------
// CONFIG / CONSTANTS
// ---------------------------
const CHUNK_SIZE = 16; // X/Z
const CHUNK_HEIGHT = 128; // Y

// Block Types
const BLOCK_AIR = 0;
const BLOCK_DIRT = 1;
const BLOCK_GRASS = 2;
const BLOCK_STONE = 3;
const BLOCK_SAND = 4;
const BLOCK_LOG = 5;
const BLOCK_LEAVES = 6;
const BLOCK_CACTUS = 7;

// Simple palette (replace with PBR textures / atlases)
const MATERIALS = {
  [BLOCK_DIRT]: { color: "#8B5A2B" },
  [BLOCK_GRASS]: { color: "#4CAF50" },
  [BLOCK_STONE]: { color: "#9E9E9E" },
  [BLOCK_SAND]: { color: "#F4A460" },
  [BLOCK_LOG]: { color: "#663300" },
  [BLOCK_LEAVES]: { color: "#006400" },
  [BLOCK_CACTUS]: { color: "#228B22" },
};

// ---------------------------
// Chunk Component: builds a single Mesh from chunk data using a worker
// ---------------------------
// Fix: Add explicit props type for ChunkMesh to satisfy TypeScript and prevent errors with the 'key' prop.
interface ChunkMeshProps {
  chunkX: number;
  chunkZ: number;
  seed?: number;
}

// Fix: Changed to React.FC to correctly handle the 'key' prop provided during mapping.
const ChunkMesh: React.FC<ChunkMeshProps> = ({ chunkX, chunkZ, seed = 0 }) => {
  const meshRef = useRef<THREE.Mesh>(null!);
  const [geoData, setGeoData] = useState<{
    posArr: Float32Array;
    normArr: Float32Array;
    colArr: Float32Array;
  } | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL('./worker.js', import.meta.url));

    worker.onmessage = (e) => {
      const { posArr, normArr, colArr } = e.data;
      setGeoData({
        posArr: new Float32Array(posArr),
        normArr: new Float32Array(normArr),
        colArr: new Float32Array(colArr),
      });
      worker.terminate();
    };

    worker.postMessage({ chunkX, chunkZ, seed });

    return () => {
      worker.terminate();
    };
  }, [chunkX, chunkZ, seed]);

  const geometry = useMemo(() => {
    if (!geoData) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(geoData.posArr, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(geoData.normArr, 3));
    g.setAttribute("color", new THREE.BufferAttribute(geoData.colArr, 3));
    g.computeBoundingSphere();
    return g;
  }, [geoData]);

  if (!geometry) return null;

  return (
    <mesh
      geometry={geometry}
      position={[chunkX * CHUNK_SIZE, 0, chunkZ * CHUNK_SIZE]}
      ref={meshRef}
    >
      <meshStandardMaterial vertexColors />
    </mesh>
  );
};

// ---------------------------
// Camera controller (FPS-like) — lightweight example
// ---------------------------
function PlayerCamera() {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(8, 30, 20);
  }, [camera]);
  return null;
}

// ---------------------------
// Main Scene
// ---------------------------
export default function App() {
  const [seed] = useState(12345);
  const chunks = useMemo(() => {
    // simple 3x3 chunk grid around origin
    const arr: [number, number][] = [];
    for (let x = -1; x <= 1; x++)
      for (let z = -1; z <= 1; z++) arr.push([x, z]);
    return arr;
  }, []);

  return (
    <div className="w-screen h-screen">
      <Canvas shadows dpr={[1, 2]}>
        <ambientLight intensity={0.4} />
        <directionalLight
          castShadow
          position={[100, 200, 100]}
          intensity={1}
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />

        <Sky sunPosition={[100, 200, 100]} turbidity={6} />

        {chunks.map(([cx, cz]) => (
          <ChunkMesh key={`${cx}_${cz}`} chunkX={cx} chunkZ={cz} seed={seed} />
        ))}

        <PlayerCamera />
        <OrbitControls target={[8, 12, 8]} />
      </Canvas>
    </div>
  );
}