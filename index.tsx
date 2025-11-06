import React, { useState, useEffect, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Sky, Stats } from '@react-three/drei';
import * as THREE from 'three';

// ---------------------------
// CONFIG / CONSTANTS
// ---------------------------
const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 128;
const RENDER_DISTANCE = 3; 

// Block Types (should match worker)
const BLOCK_AIR = 0;
const BLOCK_DIRT = 1;
const BLOCK_GRASS = 2;
const BLOCK_STONE = 3;
const BLOCK_SAND = 4;
const BLOCK_LOG = 5;
const BLOCK_LEAVES = 6;
const BLOCK_CACTUS = 7;

// Player physics constants
const PLAYER_HEIGHT = 1.8;
const PLAYER_WIDTH = 0.6;
const GRAVITY = -30;
const JUMP_FORCE = 10;
const MOVE_SPEED = 5;

// ---------------------------
// DATABASE (INDEXEDDB)
// ---------------------------
const DB_NAME = 'VoxelcraftDB';
const DB_VERSION = 1;
const CHUNK_STORE_NAME = 'chunks';
const PLAYER_STORE_NAME = 'player';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event: any) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(CHUNK_STORE_NAME)) {
        db.createObjectStore(CHUNK_STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(PLAYER_STORE_NAME)) {
        db.createObjectStore(PLAYER_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = (event: any) => resolve(event.target.result);
    request.onerror = (event: any) => reject(event.target.error);
  });
}

async function getChunkFromDB(id: string) {
  const db: IDBDatabase = await openDB();
  return new Promise((resolve) => {
    const transaction = db.transaction(CHUNK_STORE_NAME, 'readonly');
    const store = transaction.objectStore(CHUNK_STORE_NAME);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result ? request.result.data : null);
    request.onerror = () => resolve(null);
  });
}

async function saveChunkToDB(id: string, data: Uint8Array) {
  const db: IDBDatabase = await openDB();
  const transaction = db.transaction(CHUNK_STORE_NAME, 'readwrite');
  const store = transaction.objectStore(CHUNK_STORE_NAME);
  store.put({ id, data });
}

async function getPlayerFromDB() {
    const db: IDBDatabase = await openDB();
    return new Promise((resolve) => {
        const transaction = db.transaction(PLAYER_STORE_NAME, 'readonly');
        const store = transaction.objectStore(PLAYER_STORE_NAME);
        const request = store.get('playerData');
        request.onsuccess = () => resolve(request.result ? request.result.data : null);
        request.onerror = () => resolve(null);
    });
}

async function savePlayerToDB(data: any) {
    const db: IDBDatabase = await openDB();
    const transaction = db.transaction(PLAYER_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(PLAYER_STORE_NAME);
    store.put({ id: 'playerData', data });
}


// ---------------------------
// REACT COMPONENTS
// ---------------------------

interface PlayerControlsProps {
    world: {
      getBlock: (x: number, y: number, z: number) => number;
    };
    onPositionChange: (position: THREE.Vector3, rotation: THREE.Euler) => void;
    isMobile: boolean;
    mobileControls: {
        move: { x: number; y: number };
        look: { x: number; y: number };
        jump: boolean;
    }
}
  
interface PlayerControlsHandle {
    setPosition: (x: number, y: number, z: number) => void;
    setRotation: (pitch: number, yaw: number) => void;
    camera: THREE.Camera;
}

const PlayerControls = forwardRef<PlayerControlsHandle, PlayerControlsProps>(({ world, onPositionChange, isMobile, mobileControls }, ref) => {
  const { camera } = useThree();
  const velocity = useRef(new THREE.Vector3(0, 0, 0));
  const onGround = useRef(false);
  
  // Keyboard state
  const moveState = useRef({ forward: false, backward: false, left: false, right: false, jump: false });

  // Fix: Corrected typo from useImperactiveHandle to useImperativeHandle
  useImperativeHandle(ref, () => ({
    camera,
    setPosition(x, y, z) {
      camera.position.set(x, y, z);
      velocity.current.set(0, 0, 0);
    },
    setRotation(pitch, yaw) {
        camera.rotation.x = pitch;
        camera.rotation.y = yaw;
    }
  }));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyW': moveState.current.forward = true; break;
        case 'KeyS': moveState.current.backward = true; break;
        case 'KeyA': moveState.current.left = true; break;
        case 'KeyD': moveState.current.right = true; break;
        case 'Space': if (onGround.current) moveState.current.jump = true; break;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyW': moveState.current.forward = false; break;
        case 'KeyS': moveState.current.backward = false; break;
        case 'KeyA': moveState.current.left = false; break;
        case 'KeyD': moveState.current.right = false; break;
      }
    };
    
    const handleMouseMove = (e: MouseEvent) => {
        if (document.pointerLockElement === document.body) {
            camera.rotation.y -= e.movementX * 0.002;
            camera.rotation.x -= e.movementY * 0.002;
            camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));
        }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    document.addEventListener('mousemove', handleMouseMove);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, [camera]);

  const playerBox = useMemo(() => new THREE.Box3(
    new THREE.Vector3(-PLAYER_WIDTH / 2, 0, -PLAYER_WIDTH / 2),
    new THREE.Vector3(PLAYER_WIDTH / 2, PLAYER_HEIGHT, PLAYER_WIDTH / 2)
  ), []);

  useFrame((state, delta) => {
    if (!world) return;

    // --- MOUSE/TOUCH LOOK ---
    camera.rotation.order = 'YXZ';
    if(isMobile) {
        camera.rotation.y -= mobileControls.look.x * 0.002;
        camera.rotation.x -= mobileControls.look.y * 0.002;
        camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));
        mobileControls.look.x = 0;
        mobileControls.look.y = 0;
    }
    
    // --- MOVEMENT INPUT ---
    const moveDir = {
        forward: isMobile ? -mobileControls.move.y > 0.1 : moveState.current.forward,
        backward: isMobile ? -mobileControls.move.y < -0.1 : moveState.current.backward,
        left: isMobile ? mobileControls.move.x < -0.1 : moveState.current.left,
        right: isMobile ? mobileControls.move.x > 0.1 : moveState.current.right,
    };
    const jumpRequested = isMobile ? mobileControls.jump : moveState.current.jump;

    const frontVector = new THREE.Vector3(0, 0, (moveDir.backward ? 1 : 0) - (moveDir.forward ? 1 : 0));
    const sideVector = new THREE.Vector3((moveDir.left ? 1 : 0) - (moveDir.right ? 1 : 0), 0, 0);
    const direction = new THREE.Vector3();
    direction
      .subVectors(frontVector, sideVector)
      .normalize()
      .multiplyScalar(MOVE_SPEED)
      .applyEuler(camera.rotation);

    velocity.current.x = direction.x;
    velocity.current.z = direction.z;

    if (jumpRequested && onGround.current) {
      velocity.current.y = JUMP_FORCE;
    }
    if(moveState.current.jump) moveState.current.jump = false;


    // --- PHYSICS & COLLISION (SWEPT AABB) ---
    velocity.current.y += GRAVITY * delta;
    let deltaPosition = velocity.current.clone().multiplyScalar(delta);

    const worldBox = new THREE.Box3();
    onGround.current = false;
    
    // Create a swept box for the player's movement
    const sweptBox = playerBox.clone().translate(camera.position);
    const broadphaseBox = sweptBox.clone().union(sweptBox.clone().translate(deltaPosition));

    // Get potential colliders
    const colliders = [];
    const minX = Math.floor(broadphaseBox.min.x), maxX = Math.ceil(broadphaseBox.max.x);
    const minY = Math.floor(broadphaseBox.min.y), maxY = Math.ceil(broadphaseBox.max.y);
    const minZ = Math.floor(broadphaseBox.min.z), maxZ = Math.ceil(broadphaseBox.max.z);

    for (let y = minY; y < maxY; y++) {
        for (let z = minZ; z < maxZ; z++) {
            for (let x = minX; x < maxX; x++) {
                if (world.getBlock(x, y, z) !== BLOCK_AIR) {
                    worldBox.min.set(x, y, z);
                    worldBox.max.set(x + 1, y + 1, z + 1);
                    colliders.push(worldBox.clone());
                }
            }
        }
    }
    
    for (const collider of colliders) {
        // Calculate intersection time
        const invEntry = new THREE.Vector3(
            deltaPosition.x > 0 ? collider.min.x - sweptBox.max.x : collider.max.x - sweptBox.min.x,
            deltaPosition.y > 0 ? collider.min.y - sweptBox.max.y : collider.max.y - sweptBox.min.y,
            deltaPosition.z > 0 ? collider.min.z - sweptBox.max.z : collider.max.z - sweptBox.min.z
        );

        const invExit = new THREE.Vector3(
            deltaPosition.x > 0 ? collider.max.x - sweptBox.min.x : collider.min.x - sweptBox.max.x,
            deltaPosition.y > 0 ? collider.max.y - sweptBox.min.y : collider.min.y - sweptBox.max.y,
            deltaPosition.z > 0 ? collider.max.z - sweptBox.min.z : collider.min.z - sweptBox.max.z
        );

        const entry = new THREE.Vector3(
            deltaPosition.x === 0 ? -Infinity : invEntry.x / deltaPosition.x,
            deltaPosition.y === 0 ? -Infinity : invEntry.y / deltaPosition.y,
            deltaPosition.z === 0 ? -Infinity : invEntry.z / deltaPosition.z
        );
        
        const exit = new THREE.Vector3(
            deltaPosition.x === 0 ? Infinity : invExit.x / deltaPosition.x,
            deltaPosition.y === 0 ? Infinity : invExit.y / deltaPosition.y,
            deltaPosition.z === 0 ? Infinity : invExit.z / deltaPosition.z
        );

        const entryTime = Math.max(entry.x, entry.y, entry.z);
        const exitTime = Math.min(exit.x, exit.y, exit.z);

        if (entryTime < exitTime && entryTime >= 0 && entryTime <= 1) {
            // Collision detected, find normal
            const normal = new THREE.Vector3();
            if (entryTime === entry.y) {
                normal.y = deltaPosition.y > 0 ? -1 : 1;
                if (normal.y > 0) { // Hit ground
                    onGround.current = true;
                }
            } else if (entryTime === entry.x) {
                normal.x = deltaPosition.x > 0 ? -1 : 1;
            } else {
                normal.z = deltaPosition.z > 0 ? -1 : 1;
            }

            // Slide response
            const remainingTime = 1 - entryTime;
            const dot = deltaPosition.dot(normal);
            deltaPosition.addScaledVector(normal, -dot); // remove normal component
            velocity.current.addScaledVector(normal, -velocity.current.dot(normal));
        }
    }
    
    camera.position.add(deltaPosition);

    if (camera.position.y < 0) { // Fall out of world
      camera.position.set(0, 100, 0);
      velocity.current.set(0,0,0);
    }
    
    onPositionChange(camera.position, camera.rotation);
  });

  return null;
});

function ChunkMesh({ chunkX, chunkZ, data, onUpdate }: { chunkX: number; chunkZ: number; data: Uint8Array; onUpdate: (chunkX: number, chunkZ: number, data: Uint8Array) => void; }) {
  const [geometryData, setGeometryData] = useState<{ positions: Float32Array; normals: Float32Array; colors: Float32Array; } | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    
    worker.onmessage = (event) => {
      const { posArr, normArr, colArr, data: newData } = event.data;
      setGeometryData({ 
        positions: new Float32Array(posArr), 
        normals: new Float32Array(normArr), 
        colors: new Float32Array(colArr) 
      });
      if (newData) {
          onUpdate(chunkX, chunkZ, new Uint8Array(newData));
      }
    };

    const seed = 0.1;
    if(data) {
        worker.postMessage({ data: data.buffer }, [data.buffer]);
    } else {
        worker.postMessage({ chunkX, chunkZ, seed });
    }

    return () => {
      worker.terminate();
    };
  }, [chunkX, chunkZ, data, onUpdate]);

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
    <mesh 
      position={[chunkX * CHUNK_SIZE, 0, chunkZ * CHUNK_SIZE]} 
      geometry={geometry}
    >
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} />
    </mesh>
  );
}

function World({ playerPosition, onChunkUpdate, chunks }: { playerPosition: THREE.Vector3 | undefined, onChunkUpdate: (x: number, z: number, data: Uint8Array) => void, chunks: Map<string, Uint8Array> }) {
  const [visibleChunks, setVisibleChunks] = useState(new Set());

  useEffect(() => {
    if(!playerPosition) return;
    const playerChunkX = Math.floor(playerPosition.x / CHUNK_SIZE);
    const playerChunkZ = Math.floor(playerPosition.z / CHUNK_SIZE);
    const newVisibleChunks = new Set();
    
    for (let x = playerChunkX - RENDER_DISTANCE; x <= playerChunkX + RENDER_DISTANCE; x++) {
      for (let z = playerChunkZ - RENDER_DISTANCE; z <= playerChunkZ + RENDER_DISTANCE; z++) {
        newVisibleChunks.add(`${x},${z}`);
      }
    }
    setVisibleChunks(newVisibleChunks);
  }, [playerPosition]);
  
  return (
    <>
      {Array.from(visibleChunks).map((id: string) => {
        const [x, z] = id.split(',').map(Number);
        return <ChunkMesh 
            key={id} 
            chunkX={x} 
            chunkZ={z} 
            data={chunks.get(id)!}
            onUpdate={onChunkUpdate} 
        />;
      })}
    </>
  );
}

function Crosshair() {
    return <div style={{
        position: 'absolute', top: '50%', left: '50%', width: '4px', height: '4px',
        backgroundColor: 'white', borderRadius: '50%', transform: 'translate(-50%, -50%)',
        pointerEvents: 'none', border: '1px solid black'
    }} />;
}

const BLOCK_TYPES = { BLOCK_GRASS, BLOCK_DIRT, BLOCK_STONE, BLOCK_SAND, BLOCK_LOG, BLOCK_LEAVES, BLOCK_CACTUS };

function Hotbar({ selected, items }: { selected: number; items: number[]; }) {
    return (
        <div style={{
            position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
            display: 'flex', backgroundColor: 'rgba(0,0,0,0.5)', padding: '5px', borderRadius: '5px'
        }}>
            {items.map((item, index) => (
                <div key={index} style={{
                    width: '50px', height: '50px', margin: '5px',
                    border: `2px solid ${selected === index ? 'white' : 'gray'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'white', fontSize: '10px', textTransform: 'capitalize'
                }}>
                    {Object.keys(BLOCK_TYPES).find(key => BLOCK_TYPES[key as keyof typeof BLOCK_TYPES] === item)?.replace('BLOCK_', '')}
                </div>
            ))}
        </div>
    );
}

function MobileControls({ onMove, onLook, onJump, onBreak, onPlace }: { onMove: (x:number, y:number) => void, onLook: (x:number, y:number) => void, onJump: () => void, onBreak: () => void, onPlace: () => void }) {
    const lookRef = useRef<HTMLDivElement>(null);
    const moveRef = useRef<HTMLDivElement>(null);
    const moveState = useRef({ active: false, start: {x:0, y:0}, current: {x:0, y:0} });
    const lookState = useRef({ active: false, id: -1, last: {x:0, y:0} });

    useEffect(() => {
        const lookEl = lookRef.current;
        if (!lookEl) return;

        const handleLookStart = (e: TouchEvent) => {
            e.preventDefault();
            if (!lookState.current.active) {
                const touch = e.changedTouches[0];
                lookState.current.active = true;
                lookState.current.id = touch.identifier;
                lookState.current.last.x = touch.clientX;
                lookState.current.last.y = touch.clientY;
            }
        };
        const handleLookMove = (e: TouchEvent) => {
            if (lookState.current.active) {
                for(const touch of Array.from(e.changedTouches)) {
                    if(touch.identifier === lookState.current.id) {
                        const deltaX = touch.clientX - lookState.current.last.x;
                        const deltaY = touch.clientY - lookState.current.last.y;
                        onLook(deltaX, deltaY);
                        lookState.current.last.x = touch.clientX;
                        lookState.current.last.y = touch.clientY;
                        break;
                    }
                }
            }
        };
        const handleLookEnd = (e: TouchEvent) => {
            if (lookState.current.active) {
                 for(const touch of Array.from(e.changedTouches)) {
                    if(touch.identifier === lookState.current.id) {
                        lookState.current.active = false;
                        lookState.current.id = -1;
                        break;
                    }
                }
            }
        };

        lookEl.addEventListener('touchstart', handleLookStart);
        lookEl.addEventListener('touchmove', handleLookMove);
        lookEl.addEventListener('touchend', handleLookEnd);
        lookEl.addEventListener('touchcancel', handleLookEnd);
        return () => {
            lookEl.removeEventListener('touchstart', handleLookStart);
            lookEl.removeEventListener('touchmove', handleLookMove);
            lookEl.removeEventListener('touchend', handleLookEnd);
            lookEl.removeEventListener('touchcancel', handleLookEnd);
        };

    }, [onLook]);

    useEffect(() => {
        const moveEl = moveRef.current;
        if(!moveEl) return;
        
        const handleMove = (e: TouchEvent) => {
            e.preventDefault();
            const touch = e.touches[0];
            const rect = moveEl.getBoundingClientRect();
            const x = (touch.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
            const y = (touch.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
            const clampedX = Math.max(-1, Math.min(1, x));
            const clampedY = Math.max(-1, Math.min(1, y));
            onMove(clampedX, clampedY);
        }
        
        const handleMoveStart = (e: TouchEvent) => {
            moveState.current.active = true;
            handleMove(e);
        }
        const handleMoveMove = (e: TouchEvent) => {
            if(moveState.current.active) handleMove(e);
        }
        const handleMoveEnd = () => {
            moveState.current.active = false;
            onMove(0,0);
        }
        
        moveEl.addEventListener('touchstart', handleMoveStart);
        moveEl.addEventListener('touchmove', handleMoveMove);
        moveEl.addEventListener('touchend', handleMoveEnd);
        moveEl.addEventListener('touchcancel', handleMoveEnd);
        
        return () => {
            moveEl.removeEventListener('touchstart', handleMoveStart);
            moveEl.removeEventListener('touchmove', handleMoveMove);
            moveEl.removeEventListener('touchend', handleMoveEnd);
            moveEl.removeEventListener('touchcancel', handleMoveEnd);
        }
    }, [onMove]);

    return <>
        <div ref={lookRef} style={{ position: 'absolute', top: 0, left: '50%', width: '50%', height: '100%' }}></div>
        <div style={{ position: 'absolute', bottom: '20px', left: '20px', width: '120px', height: '120px' }}>
             <div ref={moveRef} style={{ width: '100%', height: '100%', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.2)'}}></div>
        </div>
        <div style={{ position: 'absolute', bottom: '20px', right: '20px', display: 'flex', flexDirection: 'column' }}>
            <button onTouchStart={onBreak} style={{ width: '60px', height: '60px', margin: '5px', borderRadius: '10px', border: 'none', background: 'rgba(255,255,255,0.3)'}}>Break</button>
            <button onTouchStart={onPlace} style={{ width: '60px', height: '60px', margin: '5px', borderRadius: '10px', border: 'none', background: 'rgba(255,255,255,0.3)'}}>Place</button>
            <button onTouchStart={onJump} style={{ width: '60px', height: '60px', margin: '5px', borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.3)'}}>Jump</button>
        </div>
    </>;
}


function App() {
  const [chunks, setChunks] = useState(new Map<string, Uint8Array>());
  const [player, setPlayer] = useState<{ position: THREE.Vector3, rotation: THREE.Euler }>({ position: new THREE.Vector3(0, 100, 0), rotation: new THREE.Euler(0,0,0,'YXZ') });
  const [isLocked, setIsLocked] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [hotbar, setHotbar] = useState([BLOCK_GRASS, BLOCK_DIRT, BLOCK_STONE, BLOCK_SAND, BLOCK_LOG, BLOCK_LEAVES, BLOCK_CACTUS]);
  const [selectedSlot, setSelectedSlot] = useState(0);
  
  const playerRef = useRef<PlayerControlsHandle>(null);
  const mobileControlsRef = useRef({ move: {x:0, y:0}, look: {x:0, y:0}, jump: false });

  // Load world and player data on startup
  useEffect(() => {
    setIsMobile('ontouchstart' in window);
    async function loadGame() {
        // FIX: The loaded player data from IndexedDB could be malformed (e.g., an empty object).
        // The original strict type annotation caused a compile error.
        // Changed to `any` and added runtime checks to safely handle potentially invalid data.
        const savedPlayer: any = await getPlayerFromDB();
        if (savedPlayer && savedPlayer.position && savedPlayer.rotation && playerRef.current) {
            playerRef.current.setPosition(savedPlayer.position.x, savedPlayer.position.y, savedPlayer.position.z);
            playerRef.current.setRotation(savedPlayer.rotation.x, savedPlayer.rotation.y);
        }
        setChunks(new Map()); 
    }
    loadGame();
  }, []);

  // Handle pointer lock
  const lockPointer = () => {
    if(!isMobile) document.body.requestPointerLock();
  };
  useEffect(() => {
    const handleLockChange = () => {
      setIsLocked(document.pointerLockElement === document.body);
    };
    document.addEventListener('pointerlockchange', handleLockChange);
    return () => document.removeEventListener('pointerlockchange', handleLockChange);
  }, []);
  
  // Handle hotbar selection
  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
          if(e.code.startsWith('Digit')) {
              const digit = parseInt(e.code.replace('Digit', ''), 10);
              if(digit >= 1 && digit <= hotbar.length) {
                  setSelectedSlot(digit - 1);
              }
          }
      };
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
  }, [hotbar.length]);

  // Voxel interaction
  const getBlock = (x: number, y: number, z: number) => {
      const chunkX = Math.floor(x / CHUNK_SIZE);
      const chunkZ = Math.floor(z / CHUNK_SIZE);
      const chunk = chunks.get(`${chunkX},${chunkZ}`);
      if (!chunk) return BLOCK_AIR;
      const localX = x - chunkX * CHUNK_SIZE;
      const localY = y;
      const localZ = z - chunkZ * CHUNK_SIZE;
      if(localY < 0 || localY >= CHUNK_HEIGHT) return BLOCK_AIR;
      return chunk[localX + localZ * CHUNK_SIZE + localY * CHUNK_SIZE * CHUNK_SIZE];
  };

  const setBlock = (x: number, y: number, z: number, type: number) => {
      if(y < 0 || y >= CHUNK_HEIGHT) return;
      const chunkX = Math.floor(x / CHUNK_SIZE);
      const chunkZ = Math.floor(z / CHUNK_SIZE);
      const chunkId = `${chunkX},${chunkZ}`;
      const chunk = chunks.get(chunkId);
      if (!chunk) return;
      
      const localX = x - chunkX * CHUNK_SIZE;
      const localY = y;
      const localZ = z - chunkZ * CHUNK_SIZE;
      
      const newChunkData = new Uint8Array(chunk);
      newChunkData[localX + localZ * CHUNK_SIZE + localY * CHUNK_SIZE * CHUNK_SIZE] = type;
      
      setChunks(prevChunks => {
          const newChunks = new Map(prevChunks);
          newChunks.set(chunkId, newChunkData);
          saveChunkToDB(chunkId, newChunkData);
          return newChunks;
      });
  };
  
  const handlePlayerMove = (position: THREE.Vector3, rotation: THREE.Euler) => {
    setPlayer({ position: position.clone(), rotation: rotation.clone() });
    savePlayerToDB({ 
        position: {x: position.x, y: position.y, z: position.z},
        rotation: {x: rotation.x, y: rotation.y}
    });
  }

  const handleChunkUpdate = (chunkX: number, chunkZ: number, data: Uint8Array) => {
      const chunkId = `${chunkX},${chunkZ}`;
      setChunks(prevChunks => {
          const newChunks = new Map(prevChunks);
          newChunks.set(chunkId, data);
          return newChunks;
      });
  };

  const worldInterface = { getBlock };
  
  const interact = (isBreak: boolean) => {
    if (!playerRef.current) return;
    const camera = playerRef.current.camera;
    if (!camera) return;

    const raycaster = new THREE.Raycaster(camera.position, camera.getWorldDirection(new THREE.Vector3()));
    let targetBlock = null;

    const checkDistance = 5;
    for (let t = 0; t < checkDistance; t += 0.05) {
        const point = raycaster.ray.at(t, new THREE.Vector3());
        const blockX = Math.floor(point.x);
        const blockY = Math.floor(point.y);
        const blockZ = Math.floor(point.z);
        if(getBlock(blockX, blockY, blockZ) !== BLOCK_AIR) {
            const intersectionPoint = point;
            const hitNormal = new THREE.Vector3();
            const center = new THREE.Vector3(blockX + 0.5, blockY + 0.5, blockZ + 0.5);
            const diff = intersectionPoint.clone().sub(center);
            const absDiff = new THREE.Vector3(Math.abs(diff.x), Math.abs(diff.y), Math.abs(diff.z));

            if(absDiff.x > absDiff.y && absDiff.x > absDiff.z) hitNormal.set(Math.sign(diff.x), 0, 0);
            else if (absDiff.y > absDiff.z) hitNormal.set(0, Math.sign(diff.y), 0);
            else hitNormal.set(0, 0, Math.sign(diff.z));
            
            targetBlock = { x: blockX, y: blockY, z: blockZ, normal: hitNormal };
            break;
        }
    }

    if (targetBlock) {
        if (isBreak) {
            setBlock(targetBlock.x, targetBlock.y, targetBlock.z, BLOCK_AIR);
        } else {
            setBlock(
                targetBlock.x + targetBlock.normal.x,
                targetBlock.y + targetBlock.normal.y,
                targetBlock.z + targetBlock.normal.z,
                hotbar[selectedSlot]
            );
        }
    }
  }

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
        if (!isLocked) return;
        if (e.button === 0) interact(true);
        if (e.button === 2) interact(false);
    };
    window.addEventListener('mousedown', handleMouseDown);
    return () => window.removeEventListener('mousedown', handleMouseDown);
  }, [isLocked, chunks, hotbar, selectedSlot]);


  return (
    <div style={{ width: '100vw', height: '100vh', touchAction: 'none' }} onClick={lockPointer}>
        {!isLocked && !isMobile && (
            <div style={{
                position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                backgroundColor: 'rgba(0,0,0,0.7)', color: 'white', padding: '20px',
                borderRadius: '10px', textAlign: 'center', zIndex: 1
            }}>
                <h1>Click to Play</h1>
                <p>W, A, S, D to move</p>
                <p>Space to jump</p>
                <p>Mouse to look</p>
                <p>1-7 to select block</p>
            </div>
        )}
        {(isLocked || isMobile) && <Crosshair />}
        <Canvas camera={{ fov: 75 }}>
            <Sky sunPosition={[100, 20, 100]} />
            <ambientLight intensity={0.7} />
            <pointLight position={[100, 100, 100]} intensity={1.0} />
            <World 
                playerPosition={player.position} 
                onChunkUpdate={handleChunkUpdate} 
                chunks={chunks}
            />
            <PlayerControls ref={playerRef} world={worldInterface} onPositionChange={handlePlayerMove} isMobile={isMobile} mobileControls={mobileControlsRef.current} />
            <Stats />
        </Canvas>
        {(isLocked || isMobile) && <Hotbar selected={selectedSlot} items={hotbar} />}
        {isMobile && <MobileControls 
            onMove={(x,y) => { mobileControlsRef.current.move.x = x; mobileControlsRef.current.move.y = y; }} 
            onLook={(x,y) => { mobileControlsRef.current.look.x = x; mobileControlsRef.current.look.y = y; }}
            onJump={() => { mobileControlsRef.current.jump = true; setTimeout(() => mobileControlsRef.current.jump = false, 100)}}
            onBreak={() => interact(true)}
            onPlace={() => interact(false)}
        />}
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
