// 7K Voxelcraft — React + React-Three-Fiber Starter (single-file scaffold) // File: src/App.jsx // Purpose: Minimal, production-oriented starter showing chunked voxel world, greedy meshing, // multi-thread chunk generation (worker placeholder), PBR-like material, sky, camera controls. // Notes: This is a scaffold to iterate from — replace worker code, assets, and shaders with your own.

import React, {
  useRef,
  useState,
  useEffect,
  useMemo,
  CSSProperties,
  useCallback,
} from "react";
import { createRoot } from "react-dom/client";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
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

// Player settings
const PLAYER_HEIGHT = 1.8;
const PLAYER_WIDTH = 0.6;
const PLAYER_SPEED = 5;
const PLAYER_JUMP_FORCE = 6;
const GRAVITY = -15;

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
interface ChunkMeshProps {
  chunkX: number;
  chunkZ: number;
  seed?: number;
  onChunkDataLoaded: (key: string, data: Uint8Array) => void;
}

const ChunkMesh: React.FC<ChunkMeshProps> = ({
  chunkX,
  chunkZ,
  seed = 0,
  onChunkDataLoaded,
}) => {
  const meshRef = useRef<THREE.Mesh>(null!);
  const [geoData, setGeoData] = useState<{
    posArr: Float32Array;
    normArr: Float32Array;
    colArr: Float32Array;
  } | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL("./worker.js", import.meta.url));

    worker.onmessage = (e) => {
      const { posArr, normArr, colArr, data } = e.data;
      setGeoData({
        posArr: new Float32Array(posArr),
        normArr: new Float32Array(normArr),
        colArr: new Float32Array(colArr),
      });
      onChunkDataLoaded(`${chunkX}_${chunkZ}`, new Uint8Array(data));
      worker.terminate();
    };

    worker.postMessage({ chunkX, chunkZ, seed });

    return () => {
      worker.terminate();
    };
  }, [chunkX, chunkZ, seed, onChunkDataLoaded]);

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
// Camera controller (FPS-like with collision)
// ---------------------------
interface PlayerControlsProps {
  worldData: Map<string, Uint8Array>;
  setIsLocked: React.Dispatch<React.SetStateAction<boolean>>;
}

function PlayerControls({ worldData, setIsLocked }: PlayerControlsProps) {
  const { camera, gl } = useThree();
  const velocity = useRef(new THREE.Vector3(0, 0, 0));
  const euler = useRef(new THREE.Euler(0, 0, 0, "YXZ"));
  const canJump = useRef(false);
  const isLockedRef = useRef(false);

  // Helper: Get block type at world coordinates
  const getBlock = useCallback((x: number, y: number, z: number) => {
      const chunkX = Math.floor(x / CHUNK_SIZE);
      const chunkZ = Math.floor(z / CHUNK_SIZE);
      const chunkKey = `${chunkX}_${chunkZ}`;
      const chunk = worldData.get(chunkKey);
      if (!chunk) return BLOCK_AIR;

      const localX = Math.floor(x) - chunkX * CHUNK_SIZE;
      const localY = Math.floor(y);
      const localZ = Math.floor(z) - chunkZ * CHUNK_SIZE;

      if (localY < 0 || localY >= CHUNK_HEIGHT) return BLOCK_AIR;
      
      const idx = localX + localZ * CHUNK_SIZE + localY * (CHUNK_SIZE * CHUNK_SIZE);
      return chunk[idx];
  }, [worldData]);
  
  const isSolid = (x:number, y:number, z:number) => {
    const block = getBlock(x,y,z);
    return block !== BLOCK_AIR;
  }

  const moveState = useMemo(
    () => ({
      forward: false,
      backward: false,
      left: false,
      right: false,
      jump: false,
    }),
    []
  );

  useEffect(() => {
    camera.position.set(8, 80, 20); // Start higher to fall onto terrain
    const onMouseMove = (event: MouseEvent) => {
      if (!isLockedRef.current) return;
      euler.current.y -= event.movementX * 0.002;
      euler.current.x -= event.movementY * 0.002;
      euler.current.x = Math.max(
        -Math.PI / 2,
        Math.min(Math.PI / 2, euler.current.x)
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.code) {
        case "KeyW": moveState.forward = true; break;
        case "KeyA": moveState.left = true; break;
        case "KeyS": moveState.backward = true; break;
        case "KeyD": moveState.right = true; break;
        case "Space":
          if (canJump.current) velocity.current.y = PLAYER_JUMP_FORCE;
          canJump.current = false;
          break;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      switch (event.code) {
        case "KeyW": moveState.forward = false; break;
        case "KeyA": moveState.left = false; break;
        case "KeyS": moveState.backward = false; break;
        case "KeyD": moveState.right = false; break;
      }
    };

    const onClick = () => gl.domElement.requestPointerLock();
    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === gl.domElement;
      setIsLocked(locked);
      isLockedRef.current = locked;
    };

    gl.domElement.addEventListener("click", onClick);
    document.addEventListener("pointerlockchange", onPointerLockChange);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);

    return () => {
      gl.domElement.removeEventListener("click", onClick);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, [camera, gl, moveState, euler, setIsLocked]);

  useFrame((_, delta) => {
    if (!isLockedRef.current || worldData.size === 0) return;

    const moveDirection = new THREE.Vector3();
    if (moveState.forward) moveDirection.z -= 1;
    if (moveState.backward) moveDirection.z += 1;
    if (moveState.left) moveDirection.x -= 1;
    if (moveState.right) moveDirection.x += 1;
    
    camera.quaternion.setFromEuler(euler.current);
    moveDirection.normalize().applyQuaternion(camera.quaternion);

    velocity.current.x = moveDirection.x * PLAYER_SPEED;
    velocity.current.z = moveDirection.z * PLAYER_SPEED;
    velocity.current.y += GRAVITY * delta;
    
    // Collision detection on each axis
    const halfWidth = PLAYER_WIDTH / 2;
    
    // Y-axis collision
    const dy = velocity.current.y * delta;
    if (velocity.current.y > 0) { // Moving up
      if (isSolid(camera.position.x, camera.position.y, camera.position.z)) {
        velocity.current.y = 0;
      }
    } else { // Moving down
        if (isSolid(camera.position.x - halfWidth, camera.position.y + dy, camera.position.z - halfWidth) ||
            isSolid(camera.position.x + halfWidth, camera.position.y + dy, camera.position.z - halfWidth) ||
            isSolid(camera.position.x - halfWidth, camera.position.y + dy, camera.position.z + halfWidth) ||
            isSolid(camera.position.x + halfWidth, camera.position.y + dy, camera.position.z + halfWidth)) {
            velocity.current.y = 0;
            canJump.current = true;
        }
    }
    camera.position.y += velocity.current.y * delta;

    // X-axis collision
    const dx = velocity.current.x * delta;
    if (isSolid(camera.position.x + dx + Math.sign(dx) * halfWidth, camera.position.y - 0.1, camera.position.z) ||
        isSolid(camera.position.x + dx + Math.sign(dx) * halfWidth, camera.position.y - PLAYER_HEIGHT/2, camera.position.z) ||
        isSolid(camera.position.x + dx + Math.sign(dx) * halfWidth, camera.position.y - PLAYER_HEIGHT + 0.1, camera.position.z)) {
        velocity.current.x = 0;
    }
    camera.position.x += velocity.current.x * delta;

    // Z-axis collision
    const dz = velocity.current.z * delta;
     if (isSolid(camera.position.x, camera.position.y - 0.1, camera.position.z + dz + Math.sign(dz) * halfWidth) ||
        isSolid(camera.position.x, camera.position.y - PLAYER_HEIGHT/2, camera.position.z + dz + Math.sign(dz) * halfWidth) ||
        isSolid(camera.position.x, camera.position.y - PLAYER_HEIGHT + 0.1, camera.position.z + dz + Math.sign(dz) * halfWidth)) {
        velocity.current.z = 0;
    }
    camera.position.z += velocity.current.z * delta;
    
  });

  return null;
}

// ---------------------------
// Main Scene
// ---------------------------
export default function App() {
  const [seed] = useState(12345);
  const [worldData, setWorldData] = useState<Map<string, Uint8Array>>(() => new Map());
  const [isLocked, setIsLocked] = useState(false);

  const handleChunkDataLoaded = useCallback((key: string, data: Uint8Array) => {
    setWorldData(prevData => {
      const newData = new Map(prevData);
      newData.set(key, data);
      return newData;
    });
  }, []);

  const chunks = useMemo(() => {
    // simple 3x3 chunk grid around origin
    const arr: [number, number][] = [];
    for (let x = -1; x <= 1; x++)
      for (let z = -1; z <= 1; z++) arr.push([x, z]);
    return arr;
  }, []);

  const crosshairStyle: CSSProperties = {
    position: "absolute", top: "50%", left: "50%",
    transform: "translate(-50%, -50%)", color: "white",
    fontSize: "24px", pointerEvents: "none",
  };

  const instructionsStyle: CSSProperties = {
    position: "absolute", top: "50%", left: "50%",
    transform: "translate(-50%, -50%)", backgroundColor: "rgba(0,0,0,0.7)",
    color: "white", padding: "20px", borderRadius: "10px",
    textAlign: "center", pointerEvents: "none",
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
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
          <ChunkMesh 
            key={`${cx}_${cz}`} 
            chunkX={cx} 
            chunkZ={cz} 
            seed={seed}
            onChunkDataLoaded={handleChunkDataLoaded}
          />
        ))}

        <PlayerControls worldData={worldData} setIsLocked={setIsLocked} />
      </Canvas>
      {isLocked ? (
        <div style={crosshairStyle}>+</div>
      ) : (
        <div style={instructionsStyle}>
          <h1>Click to Play</h1>
          <p>W, A, S, D to move</p>
          <p>Space to jump</p>
          <p>Mouse to look</p>
        </div>
      )}
    </div>
  );
}

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} else {
  console.error("Root container missing in index.html");
}
