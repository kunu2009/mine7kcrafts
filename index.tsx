// 7K Voxelcraft — React + React-Three-Fiber Starter (single-file scaffold) // File: src/App.jsx // Purpose: Minimal, production-oriented starter showing chunked voxel world, greedy meshing, // multi-thread chunk generation (worker placeholder), PBR-like material, sky, camera controls. // Notes: This is a scaffold to iterate from — replace worker code, assets, and shaders with your own.

import React, {
  useRef,
  useState,
  useEffect,
  useMemo,
  CSSProperties,
  useCallback,
  forwardRef,
  useImperativeHandle,
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
const PLAYER_HEIGHT = 1.8; // This is eye-height from feet
const PLAYER_WIDTH = 0.6;
const PLAYER_SPEED = 5;
const PLAYER_JUMP_FORCE = 6;
const GRAVITY = -15;
const RAYCAST_DISTANCE = 5; // Max distance for block interaction
const RENDER_DISTANCE = 3; // In chunks (3 = 7x7 grid)

// Simple palette (replace with PBR textures / atlases)
const MATERIALS = {
  [BLOCK_DIRT]: { color: "#8B5A2B", name: "Dirt" },
  [BLOCK_GRASS]: { color: "#4CAF50", name: "Grass" },
  [BLOCK_STONE]: { color: "#9E9E9E", name: "Stone" },
  [BLOCK_SAND]: { color: "#F4A460", name: "Sand" },
  [BLOCK_LOG]: { color: "#663300", name: "Log" },
  [BLOCK_LEAVES]: { color: "#006400", name: "Leaves" },
  [BLOCK_CACTUS]: { color: "#228B22", name: "Cactus" },
};

// ---------------------------
// IndexedDB Helper Functions for Persistence
// ---------------------------
const DB_NAME = "VoxelcraftDB";
const DB_VERSION = 1;
const CHUNK_STORE_NAME = "chunks";

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject("Error opening DB");
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      db.createObjectStore(CHUNK_STORE_NAME);
    };
  });
};

const saveChunkToDB = async (key: string, data: Uint8Array) => {
  const db = await openDB();
  const transaction = db.transaction(CHUNK_STORE_NAME, "readwrite");
  const store = transaction.objectStore(CHUNK_STORE_NAME);
  store.put(data, key);
};

const loadChunkFromDB = async (key: string): Promise<Uint8Array | null> => {
    const db = await openDB();
    const transaction = db.transaction(CHUNK_STORE_NAME, "readonly");
    const store = transaction.objectStore(CHUNK_STORE_NAME);
    const request = store.get(key);
    return new Promise((resolve) => {
        request.onsuccess = () => {
            resolve(request.result ? new Uint8Array(request.result) : null);
        };
        request.onerror = () => resolve(null);
    });
};

// ---------------------------
// Particle Component: for block-breaking effect
// ---------------------------
interface ParticleProps {
    id: number;
    position: THREE.Vector3;
    color: string;
    onDone: (id: number) => void;
}

const Particle: React.FC<ParticleProps> = ({ id, position, color, onDone }) => {
    const meshRef = useRef<THREE.Mesh>(null!);
    const velocity = useRef(new THREE.Vector3(
        (Math.random() - 0.5) * 3,
        Math.random() * 3 + 1,
        (Math.random() - 0.5) * 3
    ));
    const life = useRef(0);

    useFrame((_, delta) => {
        if (!meshRef.current) return;
        velocity.current.y -= 9.8 * delta; // Gravity
        meshRef.current.position.addScaledVector(velocity.current, delta);
        life.current += delta;
        if (life.current > 0.75) {
            onDone(id);
        }
    });

    return (
        <mesh ref={meshRef} position={position}>
            <boxGeometry args={[0.1, 0.1, 0.1]} />
            <meshStandardMaterial color={color} />
        </mesh>
    );
};


// ---------------------------
// Chunk Component: builds a single Mesh from chunk data using a worker
// ---------------------------
interface ChunkMeshProps {
  chunkX: number;
  chunkZ: number;
  seed?: number;
  data?: Uint8Array;
  onChunkGenerated: (key: string, data: Uint8Array) => void;
}

const ChunkMesh: React.FC<ChunkMeshProps> = ({
  chunkX,
  chunkZ,
  seed = 0,
  data,
  onChunkGenerated,
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
      const { posArr, normArr, colArr, data: chunkData } = e.data;
      setGeoData({
        posArr: new Float32Array(posArr),
        normArr: new Float32Array(normArr),
        colArr: new Float32Array(colArr),
      });
      if (chunkData) {
        onChunkGenerated(`${chunkX}_${chunkZ}`, new Uint8Array(chunkData));
      }
      worker.terminate();
    };

    if (data) {
      // Re-mesh existing data
      const dataBuffer = data.buffer.slice(0);
      worker.postMessage({ data: dataBuffer }, [dataBuffer]);
    } else {
      // Generate new chunk
      worker.postMessage({ chunkX, chunkZ, seed });
    }

    return () => {
      worker.terminate();
    };
  }, [chunkX, chunkZ, seed, data, onChunkGenerated]);

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
  getBlock: (x: number, y: number, z: number) => number;
  setBlock: (x: number, y: number, z: number, type: number) => void;
  selectedBlock: number;
  onPositionChange: (position: THREE.Vector3, euler: THREE.Euler) => void;
}
export interface PlayerControlsRef {
    setPosition: (position: THREE.Vector3, euler: THREE.Euler) => void;
}


const PlayerControls = forwardRef<PlayerControlsRef, PlayerControlsProps>(({
  worldData,
  setIsLocked,
  getBlock,
  setBlock,
  selectedBlock,
  onPositionChange,
}, ref) => {
  const { camera, gl } = useThree();
  const velocity = useRef(new THREE.Vector3(0, 0, 0));
  const euler = useRef(new THREE.Euler(0, 0, 0, "YXZ"));
  const canJump = useRef(false);
  const isLockedRef = useRef(false);

  useImperativeHandle(ref, () => ({
    setPosition: (position: THREE.Vector3, newEuler: THREE.Euler) => {
        camera.position.copy(position);
        euler.current.copy(newEuler);
    },
  }));

  const isSolid = (x: number, y: number, z: number) => {
    const block = getBlock(x, y, z);
    return block !== BLOCK_AIR;
  };

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
      if (event.code.startsWith('Digit')) return; // Let App handle hotbar keys
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

    const raycast = () => {
      const origin = camera.position;
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);

      let x = Math.floor(origin.x);
      let y = Math.floor(origin.y);
      let z = Math.floor(origin.z);

      const stepX = Math.sign(direction.x);
      const stepY = Math.sign(direction.y);
      const stepZ = Math.sign(direction.z);

      const tDeltaX = Math.abs(1 / direction.x);
      const tDeltaY = Math.abs(1 / direction.y);
      const tDeltaZ = Math.abs(1 / direction.z);

      let tMaxX = (stepX > 0 ? x + 1 - origin.x : origin.x - x) * tDeltaX;
      let tMaxY = (stepY > 0 ? y + 1 - origin.y : origin.y - y) * tDeltaY;
      let tMaxZ = (stepZ > 0 ? z + 1 - origin.z : origin.z - z) * tDeltaZ;

      let hitPos: [number, number, number] | null = null;
      let placePos: [number, number, number] | null = [x, y, z];
      let prevPos: [number, number, number] | null = [x, y, z];

      for (let i = 0; i < RAYCAST_DISTANCE / 0.05; i++) {
        prevPos = [x, y, z];
        if (tMaxX < tMaxY) {
          if (tMaxX < tMaxZ) {
            x += stepX;
            tMaxX += tDeltaX;
          } else {
            z += stepZ;
            tMaxZ += tDeltaZ;
          }
        } else {
          if (tMaxY < tMaxZ) {
            y += stepY;
            tMaxY += tDeltaY;
          } else {
            z += stepZ;
            tMaxZ += tDeltaZ;
          }
        }

        if (isSolid(x, y, z)) {
          hitPos = [x, y, z];
          placePos = prevPos;
          break;
        }
      }

      return { hitPos, placePos };
    };

    const onMouseDown = (event: MouseEvent) => {
      if (!isLockedRef.current) return;
      const { hitPos, placePos } = raycast();
      if(navigator.vibrate) navigator.vibrate(50);

      if (event.button === 0) { // Left click
        if (hitPos) {
          setBlock(hitPos[0], hitPos[1], hitPos[2], BLOCK_AIR);
        }
      } else if (event.button === 2) { // Right click
        if (placePos && hitPos) {
          setBlock(placePos[0], placePos[1], placePos[2], selectedBlock);
        }
      }
    };
    
    const onContextMenu = (event: MouseEvent) => event.preventDefault();
    const onClick = () => gl.domElement.requestPointerLock();
    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === gl.domElement;
      setIsLocked(locked);
      isLockedRef.current = locked;
    };

    gl.domElement.addEventListener("click", onClick);
    gl.domElement.addEventListener("mousedown", onMouseDown);
    gl.domElement.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("pointerlockchange", onPointerLockChange);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);

    return () => {
      gl.domElement.removeEventListener("click", onClick);
      gl.domElement.removeEventListener("mousedown", onMouseDown);
      gl.domElement.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
    };
  }, [camera, gl, moveState, euler, setIsLocked, getBlock, setBlock, selectedBlock]);

  useFrame((_, delta) => {
    if (!isLockedRef.current || worldData.size === 0) return;

    // --- Calculate movement ---
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
    
    // --- Collision Detection & Resolution ---
    const getPlayerAABB = (pos: THREE.Vector3) => {
      return new THREE.Box3().setFromCenterAndSize(
          new THREE.Vector3(pos.x, pos.y - PLAYER_HEIGHT / 2, pos.z),
          new THREE.Vector3(PLAYER_WIDTH, PLAYER_HEIGHT, PLAYER_WIDTH)
      );
    };

    const wouldCollide = (box: THREE.Box3) => {
      const minX = Math.floor(box.min.x);
      const maxX = Math.ceil(box.max.x);
      const minY = Math.floor(box.min.y);
      const maxY = Math.ceil(box.max.y);
      const minZ = Math.floor(box.min.z);
      const maxZ = Math.ceil(box.max.z);
  
      for (let y = minY; y < maxY; y++) {
          for (let z = minZ; z < maxZ; z++) {
              for (let x = minX; x < maxX; x++) {
                  if (isSolid(x, y, z)) {
                      return true;
                  }
              }
          }
      }
      return false;
    };

    // Decompose movement into per-axis steps
    let dx = velocity.current.x * delta;
    let dy = velocity.current.y * delta;
    let dz = velocity.current.z * delta;

    // Y-axis collision
    const futureYPos = camera.position.clone();
    futureYPos.y += dy;
    if (wouldCollide(getPlayerAABB(futureYPos))) {
        if (velocity.current.y < 0) canJump.current = true;
        velocity.current.y = 0;
        dy = 0;
    } else {
        canJump.current = false;
    }
    camera.position.y += dy;

    // X-axis collision
    const futureXPos = camera.position.clone();
    futureXPos.x += dx;
    if (wouldCollide(getPlayerAABB(futureXPos))) {
        velocity.current.x = 0;
        dx = 0;
    }
    camera.position.x += dx;

    // Z-axis collision
    const futureZPos = camera.position.clone();
    futureZPos.z += dz;
    if (wouldCollide(getPlayerAABB(futureZPos))) {
        velocity.current.z = 0;
        dz = 0;
    }
    camera.position.z += dz;

    onPositionChange(camera.position, euler.current);
  });

  return null;
});

// ---------------------------
// Main Scene
// ---------------------------
export default function App() {
  const [seed] = useState(12345);
  const [worldData, setWorldData] = useState<Map<string, Uint8Array>>(() => new Map());
  const [visibleChunks, setVisibleChunks] = useState<[number, number][]>([]);
  const [playerChunkPos, setPlayerChunkPos] = useState<[number, number]>([0, 0]);
  const [isLocked, setIsLocked] = useState(false);
  const playerControlsRef = useRef<PlayerControlsRef>(null);
  const hasSpawned = useRef(false);

  // --- Particles State ---
  const [particles, setParticles] = useState<ParticleProps[]>([]);
  const particleId = useRef(0);
  
  const removeParticle = useCallback((id: number) => {
    setParticles(prev => prev.filter(p => p.id !== id));
  }, []);

  // --- Hotbar State ---
  const hotbarBlocks = useMemo(() => [
    BLOCK_GRASS, BLOCK_DIRT, BLOCK_STONE, BLOCK_SAND, BLOCK_LOG, BLOCK_LEAVES, BLOCK_CACTUS
  ], []);
  const [activeSlot, setActiveSlot] = useState(0);
  const selectedBlock = hotbarBlocks[activeSlot];

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code.startsWith('Digit')) {
        const digit = parseInt(event.code.slice(5), 10);
        if (digit >= 1 && digit <= hotbarBlocks.length) {
          setActiveSlot(digit - 1);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [hotbarBlocks.length]);


  const handleChunkGenerated = useCallback((key: string, data: Uint8Array) => {
    setWorldData((prevData) => {
      const newData = new Map(prevData);
      newData.set(key, data);
      return newData;
    });
    // Save newly generated chunk to DB
    saveChunkToDB(key, data);
  }, []);

   const getBlock = useCallback(
    (x: number, y: number, z: number): number => {
      const chunkX = Math.floor(x / CHUNK_SIZE);
      const chunkZ = Math.floor(z / CHUNK_SIZE);
      const chunkKey = `${chunkX}_${chunkZ}`;
      const chunk = worldData.get(chunkKey);
      if (!chunk) return BLOCK_AIR;

      const localX = Math.floor(x) - chunkX * CHUNK_SIZE;
      const localY = Math.floor(y);
      const localZ = Math.floor(z) - chunkZ * CHUNK_SIZE;

      if (localY < 0 || localY >= CHUNK_HEIGHT) return BLOCK_AIR;

      const idx =
        localX +
        localZ * CHUNK_SIZE +
        localY * (CHUNK_SIZE * CHUNK_SIZE);
      return chunk[idx];
    },
    [worldData]
  );

  const setBlock = useCallback(
    (worldX: number, worldY: number, worldZ: number, type: number) => {
      const chunkX = Math.floor(worldX / CHUNK_SIZE);
      const chunkZ = Math.floor(worldZ / CHUNK_SIZE);
      const chunkKey = `${chunkX}_${chunkZ}`;

      const localX = Math.floor(worldX) - chunkX * CHUNK_SIZE;
      const localY = Math.floor(worldY);
      const localZ = Math.floor(worldZ) - chunkZ * CHUNK_SIZE;

      if (localY < 0 || localY >= CHUNK_HEIGHT) return;

      const chunkData = worldData.get(chunkKey);
      if (!chunkData) return;
      
      if (type === BLOCK_AIR) {
          const oldBlockType = getBlock(worldX, worldY, worldZ);
          const material = MATERIALS[oldBlockType];
          if (material) {
              for (let i = 0; i < 5; i++) {
                const newParticle: ParticleProps = {
                    id: particleId.current++,
                    position: new THREE.Vector3(worldX + 0.5, worldY + 0.5, worldZ + 0.5),
                    color: material.color,
                    onDone: removeParticle,
                };
                setParticles(prev => [...prev, newParticle]);
              }
          }
      }


      const newChunkData = new Uint8Array(chunkData);
      const idx = localX + localZ * CHUNK_SIZE + localY * (CHUNK_SIZE * CHUNK_SIZE);
      newChunkData[idx] = type;

      setWorldData((prevData) => {
        const newData = new Map(prevData);
        newData.set(chunkKey, newChunkData);
        return newData;
      });

      // Save updated chunk to DB
      saveChunkToDB(chunkKey, newChunkData);
    },
    [worldData, getBlock, removeParticle]
  );
  
  // Infinite world streaming logic
  useEffect(() => {
    const [pcx, pcz] = playerChunkPos;
    const newVisibleChunks: [number, number][] = [];
    const chunksToLoad: [number, number][] = [];
    
    for (let x = pcx - RENDER_DISTANCE; x <= pcx + RENDER_DISTANCE; x++) {
      for (let z = pcz - RENDER_DISTANCE; z <= pcz + RENDER_DISTANCE; z++) {
        newVisibleChunks.push([x, z]);
        const key = `${x}_${z}`;
        if (!worldData.has(key)) {
            chunksToLoad.push([x,z]);
        }
      }
    }
    
    setVisibleChunks(newVisibleChunks);
    
    // Load chunks from DB or generate new ones
    chunksToLoad.forEach(async ([cx, cz]) => {
        const key = `${cx}_${cz}`;
        const dbData = await loadChunkFromDB(key);
        if (dbData) {
            setWorldData(prev => new Map(prev).set(key, dbData));
        }
        // If not in DB, the ChunkMesh component will generate it automatically
    });

  }, [playerChunkPos, worldData]);

  // Player position change handler
  const handlePlayerPositionChange = useCallback((position: THREE.Vector3, euler: THREE.Euler) => {
      const newChunkX = Math.floor(position.x / CHUNK_SIZE);
      const newChunkZ = Math.floor(position.z / CHUNK_SIZE);
      if (newChunkX !== playerChunkPos[0] || newChunkZ !== playerChunkPos[1]) {
          setPlayerChunkPos([newChunkX, newChunkZ]);
      }
      // Save player pos to local storage periodically
      localStorage.setItem('player_pos', JSON.stringify({
          x: position.x,
          y: position.y,
          z: position.z,
          ex: euler.x,
          ey: euler.y,
          ez: euler.z,
      }));
  }, [playerChunkPos]);

  // Initial spawn / load player position
  useEffect(() => {
    const savedPos = localStorage.getItem('player_pos');
    if (savedPos && playerControlsRef.current) {
        const {x, y, z, ex, ey, ez} = JSON.parse(savedPos);
        playerControlsRef.current.setPosition(new THREE.Vector3(x, y, z), new THREE.Euler(ex, ey, ez));
        hasSpawned.current = true;
    }
  }, []);

  // Intelligent Spawning Logic (for first-time players)
  useEffect(() => {
    if (hasSpawned.current) return;
    const centerChunk = worldData.get('0_0');
    if (centerChunk && playerControlsRef.current) {
        const spawnX = 8;
        const spawnZ = 8;
        let spawnY = CHUNK_HEIGHT;
        for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
            const idx = spawnX + spawnZ * CHUNK_SIZE + y * (CHUNK_SIZE * CHUNK_SIZE);
            if (centerChunk[idx] !== BLOCK_AIR) {
                spawnY = y + PLAYER_HEIGHT + 0.5;
                break;
            }
        }
        playerControlsRef.current.setPosition(new THREE.Vector3(spawnX, spawnY, spawnZ), new THREE.Euler(0,0,0));
        hasSpawned.current = true;
    }
  }, [worldData]);


  // --- UI Styles ---
  const crosshairStyle: CSSProperties = {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    color: "white",
    fontSize: "24px",
    pointerEvents: "none",
  };

  const instructionsStyle: CSSProperties = {
    position: "absolute",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    backgroundColor: "rgba(0,0,0,0.7)",
    color: "white",
    padding: "20px",
    borderRadius: "10px",
    textAlign: "center",
    pointerEvents: "none",
  };
  
  const hotbarStyle: CSSProperties = {
    position: 'absolute',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: '5px',
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: '5px',
    borderRadius: '5px',
    pointerEvents: 'none',
  };
  
  const slotStyle: (isActive: boolean) => CSSProperties = (isActive) => ({
    width: '50px',
    height: '50px',
    border: isActive ? '2px solid white' : '2px solid gray',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    fontSize: '10px',
    textAlign: 'center',
    userSelect: 'none',
  });

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
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

        {visibleChunks.map(([cx, cz]) => (
          <ChunkMesh
            key={`${cx}_${cz}`}
            chunkX={cx}
            chunkZ={cz}
            seed={seed}
            data={worldData.get(`${cx}_${cz}`)}
            onChunkGenerated={handleChunkGenerated}
          />
        ))}

        {particles.map(p => <Particle key={p.id} {...p} />)}

        <PlayerControls
          ref={playerControlsRef}
          worldData={worldData}
          setIsLocked={setIsLocked}
          getBlock={getBlock}
          setBlock={setBlock}
          selectedBlock={selectedBlock}
          onPositionChange={handlePlayerPositionChange}
        />
      </Canvas>
      {isLocked ? (
        <>
            <div style={crosshairStyle}>+</div>
            <div style={hotbarStyle}>
                {hotbarBlocks.map((blockType, index) => (
                    <div
                        key={index}
                        style={{
                            ...slotStyle(index === activeSlot),
                            backgroundColor: MATERIALS[blockType]?.color || '#000',
                        }}
                    >
                        {MATERIALS[blockType]?.name}
                    </div>
                ))}
            </div>
        </>
      ) : (
        <div style={instructionsStyle}>
          <h1>Click to Play</h1>
          <p>W, A, S, D to move</p>
          <p>Space to jump</p>
          <p>Mouse to look</p>
          <p>1-7 to select block</p>
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