// worker.js - Handles heavy lifting of chunk generation and meshing

// ---------------------------
// CONFIG / CONSTANTS
// ---------------------------
const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 128;

// Block Types
const BLOCK_AIR = 0;
const BLOCK_DIRT = 1;
const BLOCK_GRASS = 2;
const BLOCK_STONE = 3;
const BLOCK_SAND = 4;
const BLOCK_LOG = 5;
const BLOCK_LEAVES = 6;
const BLOCK_CACTUS = 7;

// Biome Types
const BIOME_PLAINS = 0;
const BIOME_DESERT = 1;
const BIOME_FOREST = 2;

// Materials (Hex colors for worker)
const MATERIALS = {
  [BLOCK_DIRT]: { color: 0x8b5a2b },
  [BLOCK_GRASS]: { color: 0x4caf50 },
  [BLOCK_STONE]: { color: 0x9e9e9e },
  [BLOCK_SAND]: { color: 0xf4a460 },
  [BLOCK_LOG]: { color: 0x663300 },
  [BLOCK_LEAVES]: { color: 0x006400 },
  [BLOCK_CACTUS]: { color: 0x228b22 },
};

// ---------------------------
// UTILS: Noise & World Gen
// ---------------------------

// 3D pseudo-random number generator
function pseudoNoise(x, y, z, seed = 0) {
  const n =
    Math.sin(x * 127.1 + y * 311.7 + z * 522.1 + seed * 1013.0) * 43758.5453;
  return n - Math.floor(n);
}

// Multi-octave fractal noise for more natural terrain
function octaveNoise(x, z, seed, octaves, persistence, lacunarity, scale) {
  let total = 0;
  let frequency = scale;
  let amplitude = 1;
  let maxValue = 0; // Used for normalizing result to 0-1 range
  for (let i = 0; i < octaves; i++) {
    total += pseudoNoise(x * frequency, 0, z * frequency, seed) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return total / maxValue;
}

// Determine biome based on large-scale noise
function getBiome(x, z, seed) {
  const noise = octaveNoise(x, z, seed + 1, 3, 0.5, 2, 0.005);
  if (noise < 0.33) return BIOME_DESERT;
  if (noise < 0.66) return BIOME_PLAINS;
  return BIOME_FOREST;
}

// The core world generation function with biomes, caves, and features
function generateChunkData(cx, cz, seed = 0) {
  const data = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
  const indexOf = (x, y, z) =>
    y + z * CHUNK_HEIGHT + x * CHUNK_HEIGHT * CHUNK_SIZE;

  // Helper to safely set a block within the chunk's data array
  const setBlock = (x, y, z, type) => {
    if (
      x >= 0 &&
      x < CHUNK_SIZE &&
      y >= 0 &&
      y < CHUNK_HEIGHT &&
      z >= 0 &&
      z < CHUNK_SIZE
    ) {
      data[indexOf(x, y, z)] = type;
    }
  };

  // Step 1: Generate base terrain based on biome
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      const worldX = cx * CHUNK_SIZE + x;
      const worldZ = cz * CHUNK_SIZE + z;
      const biome = getBiome(worldX, worldZ, seed);

      let terrainHeight;
      switch (biome) {
        case BIOME_DESERT:
          terrainHeight =
            60 + octaveNoise(worldX, worldZ, seed, 4, 0.5, 2, 0.02) * 10;
          break;
        case BIOME_FOREST:
          terrainHeight =
            70 + octaveNoise(worldX, worldZ, seed, 6, 0.5, 2, 0.015) * 30;
          break;
        default: // BIOME_PLAINS
          terrainHeight =
            64 + octaveNoise(worldX, worldZ, seed, 5, 0.5, 2, 0.02) * 15;
          break;
      }
      terrainHeight = Math.floor(terrainHeight);

      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        let blockType = BLOCK_AIR;
        if (y > terrainHeight) {
          blockType = BLOCK_AIR;
        } else if (y === terrainHeight) {
          blockType = biome === BIOME_DESERT ? BLOCK_SAND : BLOCK_GRASS;
        } else if (y > terrainHeight - 4) {
          blockType = biome === BIOME_DESERT ? BLOCK_SAND : BLOCK_DIRT;
        } else {
          blockType = BLOCK_STONE;
        }
        setBlock(x, y, z, blockType);
      }
    }
  }

  // Step 2: Carve caves using 3D noise
  const CAVE_SCALE = 0.08;
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let y = 0; y < CHUNK_HEIGHT - 1; y++) {
        if (data[indexOf(x, y, z)] === BLOCK_STONE) {
          const worldX = cx * CHUNK_SIZE + x;
          const worldZ = cz * CHUNK_SIZE + z;
          const noiseVal = pseudoNoise(
            worldX * CAVE_SCALE,
            y * CAVE_SCALE,
            worldZ * CAVE_SCALE,
            seed + 2
          );
          if (noiseVal > 0.75) {
            setBlock(x, y, z, BLOCK_AIR);
          }
        }
      }
    }
  }

  // Step 3: Add features like trees and cacti
  for (let x = 0; x < CHUNK_SIZE; x++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      // Find the actual surface Y after caves have been carved
      let surfaceY = -1;
      for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
        if (data[indexOf(x, y, z)] !== BLOCK_AIR) {
          surfaceY = y;
          break;
        }
      }
      if (surfaceY === -1) continue;

      const worldX = cx * CHUNK_SIZE + x;
      const worldZ = cz * CHUNK_SIZE + z;
      const biome = getBiome(worldX, worldZ, seed);
      const surfaceBlock = data[indexOf(x, surfaceY, z)];
      const featureNoise = pseudoNoise(worldX, 0, worldZ, seed + 3);

      if (biome === BIOME_FOREST && surfaceBlock === BLOCK_GRASS) {
        if (
          featureNoise > 0.95 &&
          x > 2 &&
          x < CHUNK_SIZE - 2 &&
          z > 2 &&
          z < CHUNK_SIZE - 2
        ) {
          const treeHeight =
            4 + Math.floor(pseudoNoise(worldX, 1, worldZ, seed + 4) * 3);
          if (surfaceY + treeHeight + 2 < CHUNK_HEIGHT) {
            for (let i = 1; i <= treeHeight; i++)
              setBlock(x, surfaceY + i, z, BLOCK_LOG);
            const radius = 2;
            for (let ly = -radius; ly <= radius; ly++) {
              for (let lx = -radius; lx <= radius; lx++) {
                for (let lz = -radius; lz <= radius; lz++) {
                  if (lx * lx + ly * ly + lz * lz <= radius * radius) {
                    if (
                      data[indexOf(x + lx, surfaceY + treeHeight + ly, z + lz)] ===
                      BLOCK_AIR
                    ) {
                      setBlock(
                        x + lx,
                        surfaceY + treeHeight + ly,
                        z + lz,
                        BLOCK_LEAVES
                      );
                    }
                  }
                }
              }
            }
          }
        }
      } else if (biome === BIOME_DESERT && surfaceBlock === BLOCK_SAND) {
        if (featureNoise > 0.98) {
          const cactusHeight =
            2 + Math.floor(pseudoNoise(worldX, 1, worldZ, seed + 4) * 2);
          if (surfaceY + cactusHeight < CHUNK_HEIGHT) {
            for (let i = 1; i <= cactusHeight; i++)
              setBlock(x, surfaceY + i, z, BLOCK_CACTUS);
          }
        }
      }
    }
  }

  return data;
}

// ---------------------------
// GREEDY MESH: Full 6-face culling implementation
// ---------------------------
// This mesher checks all 6 faces of a voxel and only generates a face if it is not
// occluded by another solid block. This creates solid-looking chunks.
function greedyMeshVoxel(
  data,
  sx = CHUNK_SIZE,
  sy = CHUNK_HEIGHT,
  sz = CHUNK_SIZE
) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];

  // Helper to calculate index from (x, y, z) coordinates based on the X, Z, Y data layout.
  // This layout is X-major, then Z, then Y.
  const indexOf = (x, y, z) => y + z * sy + x * (sy * sz);

  // Helper to get block type at coordinates, handles boundary checks.
  const getBlock = (x, y, z) => {
    if (x < 0 || x >= sx || y < 0 || y >= sy || z < 0 || z >= sz) {
      return BLOCK_AIR;
    }
    return data[indexOf(x, y, z)];
  };

  const FACES = [
    { dir: [0, -1, 0], corners: [[0, 0, 1], [1, 0, 1], [1, 0, 0], [0, 0, 0]] }, // -Y (Bottom)
    { dir: [0, 1, 0], corners: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]] }, // +Y (Top)
    { dir: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] }, // -X (Left)
    { dir: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] }, // +X (Right)
    { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] }, // -Z (Back)
    { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] }, // +Z (Front)
  ];

  // Iterate over each block in the chunk in the same order as data generation for cache efficiency.
  for (let x = 0; x < sx; x++) {
    for (let z = 0; z < sz; z++) {
      for (let y = 0; y < sy; y++) {
        const blockType = getBlock(x, y, z);
        if (blockType === BLOCK_AIR) continue;

        const material = MATERIALS[blockType];
        if (!material) continue; // Skip if block type has no material

        const colorVal = material.color;
        const r = ((colorVal >> 16) & 255) / 255;
        const g = ((colorVal >> 8) & 255) / 255;
        const b_col = (colorVal & 255) / 255;

        // Check each of the 6 faces.
        for (const { dir, corners } of FACES) {
          const neighborX = x + dir[0];
          const neighborY = y + dir[1];
          const neighborZ = z + dir[2];

          if (getBlock(neighborX, neighborY, neighborZ) === BLOCK_AIR) {
            // This face is visible.
            const [p1, p2, p3, p4] = corners;

            // Add two triangles for the quad.
            positions.push(
              p1[0] + x, p1[1] + y, p1[2] + z,
              p2[0] + x, p2[1] + y, p2[2] + z,
              p3[0] + x, p3[1] + y, p3[2] + z
            );
            positions.push(
              p1[0] + x, p1[1] + y, p1[2] + z,
              p3[0] + x, p3[1] + y, p3[2] + z,
              p4[0] + x, p4[1] + y, p4[2] + z
            );

            for (let i = 0; i < 6; i++) {
              normals.push(...dir);
              uvs.push(0, 0); // Placeholder UVs
              colors.push(r, g, b_col);
            }
          }
        }
      }
    }
  }

  return {
    posArr: new Float32Array(positions),
    normArr: new Float32Array(normals),
    uvArr: new Float32Array(uvs),
    colArr: new Float32Array(colors),
  };
}

self.onmessage = function (e) {
  const { chunkX, chunkZ, seed } = e.data;
  const data = generateChunkData(chunkX, chunkZ, seed);
  const geo = greedyMeshVoxel(data);

  self.postMessage(
    {
      posArr: geo.posArr.buffer,
      normArr: geo.normArr.buffer,
      uvArr: geo.uvArr.buffer,
      colArr: geo.colArr.buffer,
    },
    [
      geo.posArr.buffer,
      geo.normArr.buffer,
      geo.uvArr.buffer,
      geo.colArr.buffer,
    ]
  );
};
