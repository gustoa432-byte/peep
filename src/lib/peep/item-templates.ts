import {
  BLOCK_COLORS,
  CHEST,
  DIRT,
  GOLD,
  GRASS,
  LEAVES,
  SAND,
  STONE,
  WOOD as WOOD_ID,
} from "./constants";
import type { ItemVoxel } from "./item-voxels";

const WOOD = "#8b5a2b";
const METAL = "#808080";
const TERRA = "#b85c38";
const GEM = "#ccaaee";
const CLAY = "#c4b8ac";
const SKIN = "#e8c4a8";
const WHITE = "#f6efe6";
const IRIS = "#2a221c";
const LIP = "#6a3a36";
const BROW = "#3a332c";

function blockHex(id: number): string {
  return `#${(BLOCK_COLORS[id] ?? 0xc4b8ac).toString(16).padStart(6, "0")}`;
}

function cube16(color: string): ItemVoxel[] {
  const out: ItemVoxel[] = [];
  for (let y = 0; y < 16; y++) {
    for (let z = -8; z < 8; z++) {
      for (let x = -8; x < 8; x++) {
        out.push({ x, y, z, color });
      }
    }
  }
  return out;
}

function head(): ItemVoxel[] {
  const out: ItemVoxel[] = [];
  for (let y = 0; y < 8; y++) {
    for (let z = -3; z < 5; z++) {
      for (let x = -3; x < 5; x++) {
        let color = SKIN;
        if (z === -3) {
          if (y === 6 && (x === -2 || x === 2)) color = BROW;
          else if (y === 5 && (x === -2 || x === 2)) color = WHITE;
          else if (y === 5 && (x === -1 || x === 1)) color = IRIS;
          else if (y === 2 && x >= -1 && x <= 1) color = LIP;
        }
        out.push({ x, y, z, color });
      }
    }
  }
  return out;
}

/** Current in-world pickaxe, grip through (0,0,0). */
export const PICKAXE_CELLS: ItemVoxel[] = [
  ...[0, 1, 2, 3, 4, 5, 6].map((y) => ({ x: 0, y, z: 0, color: WOOD })),
  { x: 0, y: 7, z: 0, color: TERRA },
  { x: -3, y: 8, z: 0, color: GEM },
  { x: -2, y: 8, z: 0, color: METAL },
  { x: -1, y: 8, z: 0, color: METAL },
  { x: 0, y: 8, z: 0, color: METAL },
  { x: 1, y: 8, z: 0, color: METAL },
  { x: 2, y: 8, z: 0, color: METAL },
  { x: 3, y: 8, z: 0, color: GEM },
  { x: -1, y: 9, z: 0, color: METAL },
  { x: 0, y: 9, z: 0, color: METAL },
  { x: 1, y: 9, z: 0, color: METAL },
];

export type ForgeTemplateId =
  | "cube"
  | "grass"
  | "dirt"
  | "stone"
  | "wood"
  | "sand"
  | "leaves"
  | "chest"
  | "gold"
  | "head"
  | "pickaxe";

export const FORGE_TEMPLATES: { id: ForgeTemplateId; label: string; voxels: ItemVoxel[] }[] = [
  { id: "cube", label: "пустой блок", voxels: cube16(CLAY) },
  { id: "grass", label: "трава", voxels: cube16(blockHex(GRASS)) },
  { id: "dirt", label: "земля", voxels: cube16(blockHex(DIRT)) },
  { id: "stone", label: "камень", voxels: cube16(blockHex(STONE)) },
  { id: "wood", label: "дерево", voxels: cube16(blockHex(WOOD_ID)) },
  { id: "sand", label: "песок", voxels: cube16(blockHex(SAND)) },
  { id: "leaves", label: "листва", voxels: cube16(blockHex(LEAVES)) },
  { id: "chest", label: "сундук", voxels: cube16(blockHex(CHEST)) },
  { id: "gold", label: "золото", voxels: cube16(blockHex(GOLD)) },
  { id: "head", label: "голова", voxels: head() },
  { id: "pickaxe", label: "кирка", voxels: PICKAXE_CELLS },
];

export function templateById(id: string): ItemVoxel[] | null {
  return FORGE_TEMPLATES.find((t) => t.id === id)?.voxels ?? null;
}
